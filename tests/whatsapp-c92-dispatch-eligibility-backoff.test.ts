/**
 * WA-C9.2 Fase A — Elegibilidade e backoff efetivo do dispatcher.
 *
 * Cobre o contrato unificado:
 *   status = 'pending'
 *   AND scheduled_at <= now
 *   AND (next_attempt_at IS NULL OR next_attempt_at <= now)
 *
 * aplicado por `listDuePending` e revalidado por `claimForProcessing`.
 *
 * Sem envio Meta, sem cron, sem alteração de dados reais.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  enqueueNotification,
  claimForProcessing,
  listDuePending,
  markFailed,
  type NotificationRow,
} from "../src/server/whatsapp-notifications.server";

// ----------------------- Fake supabase (com .or) -----------------------
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = {
    whatsapp_notifications: [],
  };
  function parseOr(expr: string): Array<(r: Row) => boolean> {
    return expr.split(",").map((cl) => {
      const [col, op, ...rest] = cl.trim().split(".");
      const val = rest.join(".");
      if (op === "is" && val === "null") return (r: Row) => r[col] == null;
      if (op === "lte")
        return (r: Row) => r[col] != null && String(r[col]) <= String(val);
      if (op === "gte")
        return (r: Row) => r[col] != null && String(r[col]) >= String(val);
      if (op === "eq") return (r: Row) => r[col] === val;
      return () => false;
    });
  }

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const data = tables[table];
    const ctx: {
      filters: Array<(r: Row) => boolean>;
      updatePatch: Row | null;
      orderBy: string | null;
      orderAsc: boolean;
      limitN: number | null;
    } = {
      filters: [],
      updatePatch: null,
      orderBy: null,
      orderAsc: true,
      limitN: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        ctx.filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        ctx.filters.push((r) => vals.includes(r[col]));
        return api;
      },
      lte(col: string, val: unknown) {
        ctx.filters.push((r) => r[col] != null && String(r[col]) <= String(val));
        return api;
      },
      gte(col: string, val: unknown) {
        ctx.filters.push((r) => r[col] != null && String(r[col]) >= String(val));
        return api;
      },
      or(expr: string) {
        const preds = parseOr(expr);
        ctx.filters.push((r) => preds.some((p) => p(r)));
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.orderBy = col;
        ctx.orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        ctx.limitN = n;
        return api;
      },
      async maybeSingle() {
        const rows = apply();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: apply(), error: null }));
      },
      upsert(row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          const cols = (opts?.onConflict ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const existing = cols.length
            ? data.find((d) => cols.every((c) => d[c] === r[c]))
            : undefined;
          if (existing) {
            if (opts?.ignoreDuplicates) continue;
            Object.assign(existing, r);
          } else {
            data.push({
              id: r.id ?? `id-${data.length + 1}`,
              attempt_count: 0,
              next_attempt_at: null,
              ...r,
            });
          }
        }
        return api;
      },
      update(patch: Row) {
        ctx.updatePatch = patch;
        return api;
      },
    };
    function apply(): Row[] {
      if (ctx.updatePatch == null) {
        let rows = data.filter((r) => ctx.filters.every((f) => f(r)));
        if (ctx.orderBy) {
          rows = [...rows].sort((a, b) => {
            const av = String(a[ctx.orderBy!]);
            const bv = String(b[ctx.orderBy!]);
            return ctx.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (ctx.limitN != null) rows = rows.slice(0, ctx.limitN);
        return rows;
      }
      const updated: Row[] = [];
      for (const r of data) {
        if (ctx.filters.every((f) => f(r))) {
          Object.assign(r, ctx.updatePatch);
          updated.push({ ...r });
        }
      }
      return updated;
    }
    return api;
  }
  return {
    client: { from } as unknown as Parameters<typeof enqueueNotification>[1]["client"],
    tables,
  };
}

const T0 = new Date("2026-07-15T12:00:00Z"); // referência de "agora" nos testes
const past = (mins: number) => new Date(T0.getTime() - mins * 60_000);
const future = (mins: number) => new Date(T0.getTime() + mins * 60_000);
const nowFn = () => T0;

async function seed(
  fake: ReturnType<typeof buildFake>,
  overrides: Partial<Row> & { id?: string },
): Promise<string> {
  const row = await enqueueNotification(
    {
      userId: "u1",
      type: "conta_vence_amanha",
      category: "contas_a_pagar",
      scheduledAt: past(60),
      dedupeKey: overrides.dedupe_key
        ? String(overrides.dedupe_key)
        : `k-${Math.random().toString(36).slice(2)}`,
      entityType: "conta_a_pagar",
      entityId: "conta-1",
    },
    { client: fake.client },
  );
  Object.assign(fake.tables.whatsapp_notifications.find((r) => r.id === row!.id)!, overrides);
  return row!.id;
}

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
});

// =========================================================================
// listDuePending — matriz de elegibilidade
// =========================================================================
describe("WA-C9.2 :: listDuePending elegibilidade", () => {
  it("1. scheduled_at passado + next_attempt_at NULL → elegível", async () => {
    await seed(fake, { scheduled_at: past(60).toISOString(), next_attempt_at: null });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(1);
  });

  it("2. backoff futuro (scheduled passado, next_attempt_at futuro) → NÃO listado", async () => {
    await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: future(30).toISOString(),
    });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(0);
  });

  it("3. backoff vencido (ambos no passado) → elegível", async () => {
    await seed(fake, {
      scheduled_at: past(120).toISOString(),
      next_attempt_at: past(5).toISOString(),
    });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(1);
  });

  it("4. scheduled_at futuro + next_attempt_at NULL (quiet hours reagendado) → NÃO listado", async () => {
    await seed(fake, {
      scheduled_at: future(30).toISOString(),
      next_attempt_at: null,
    });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(0);
  });

  it("5. scheduled_at futuro + next_attempt_at passado → NÃO listado", async () => {
    await seed(fake, {
      scheduled_at: future(30).toISOString(),
      next_attempt_at: past(10).toISOString(),
    });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(0);
  });

  for (const status of ["processing", "sent", "failed", "cancelled", "skipped"] as const) {
    it(`6. estado terminal '${status}' → nunca listado`, async () => {
      await seed(fake, {
        status,
        scheduled_at: past(60).toISOString(),
        next_attempt_at: null,
      });
      const out = await listDuePending(50, { client: fake.client, now: nowFn });
      expect(out).toHaveLength(0);
    });
  }

  it("7. quiet hours reagendado: NÃO listado antes; listado depois", async () => {
    const at = new Date("2026-07-15T10:00:00Z"); // futuro em relação a T0? T0=12:00 → passado.
    // Ajuste: usar T0 como referência.
    await seed(fake, {
      scheduled_at: future(10).toISOString(),
      next_attempt_at: null,
    });
    const before = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(before).toHaveLength(0);
    const after = await listDuePending(50, {
      client: fake.client,
      now: () => future(15),
    });
    expect(after).toHaveLength(1);
    void at;
  });

  it("8. limite de 50 preservado", async () => {
    for (let i = 0; i < 60; i++) {
      await seed(fake, {
        dedupe_key: `k-${i}`,
        scheduled_at: past(60 - i).toISOString(),
        next_attempt_at: null,
      });
    }
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(50);
  });

  it("9. ordenação por scheduled_at ASC", async () => {
    await seed(fake, { dedupe_key: "a", scheduled_at: past(10).toISOString() });
    await seed(fake, { dedupe_key: "b", scheduled_at: past(60).toISOString() });
    await seed(fake, { dedupe_key: "c", scheduled_at: past(30).toISOString() });
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    const times = out.map((r) => r.scheduled_at);
    expect(times).toEqual([...times].sort());
  });
});

// =========================================================================
// claimForProcessing — revalida elegibilidade
// =========================================================================
describe("WA-C9.2 :: claimForProcessing elegibilidade", () => {
  it("10. claim legítimo muda pending → processing", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).not.toBeNull();
    expect(out!.status).toBe("processing");
  });

  it("11. claim com backoff futuro retorna null e não muda status", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: future(30).toISOString(),
    });
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).toBeNull();
    const row = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(row.status).toBe("pending");
  });

  it("12. claim com scheduled_at futuro retorna null", async () => {
    const id = await seed(fake, {
      scheduled_at: future(30).toISOString(),
      next_attempt_at: null,
    });
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).toBeNull();
  });

  for (const status of ["processing", "sent", "failed", "cancelled", "skipped"] as const) {
    it(`13. claim em estado terminal '${status}' retorna null`, async () => {
      const id = await seed(fake, {
        status,
        scheduled_at: past(60).toISOString(),
        next_attempt_at: null,
      });
      const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
      expect(out).toBeNull();
      const row = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
      expect(row.status).toBe(status);
    });
  }

  it("14. dois claims simultâneos: exatamente um vence", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    const [a, b] = await Promise.all([
      claimForProcessing(id, { client: fake.client, now: nowFn }),
      claimForProcessing(id, { client: fake.client, now: nowFn }),
    ]);
    const wins = [a, b].filter((x) => x !== null).length;
    expect(wins).toBe(1);
  });

  it("15. claim preserva attempt_count, dedupe_key, scheduled_at, next_attempt_at", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: past(10).toISOString(),
      attempt_count: 2,
      dedupe_key: "keep-me",
    });
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).not.toBeNull();
    expect(out!.attempt_count).toBe(2);
    expect(out!.dedupe_key).toBe("keep-me");
    expect(out!.scheduled_at).toBe(past(60).toISOString());
    expect(out!.next_attempt_at).toBe(past(10).toISOString());
  });

  it("16. após listagem, cancel entre list e claim: claim não reabre terminal", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    const listed = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(listed).toHaveLength(1);
    // cancel via mutação direta simulando outro caminho
    (fake.tables.whatsapp_notifications[0] as Row).status = "cancelled";
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).toBeNull();
    const row = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(row.status).toBe("cancelled");
  });

  it("17. após listagem, novo backoff antes do claim: claim não antecipa", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    await listDuePending(50, { client: fake.client, now: nowFn });
    (fake.tables.whatsapp_notifications[0] as Row).next_attempt_at = future(45).toISOString();
    const out = await claimForProcessing(id, { client: fake.client, now: nowFn });
    expect(out).toBeNull();
  });
});

// =========================================================================
// Backoff + reciclagem
// =========================================================================
describe("WA-C9.2 :: backoff efetivo via markFailed", () => {
  it("18. markFailed retryable cria next_attempt_at futuro; item não reaparece imediatamente", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    await claimForProcessing(id, { client: fake.client, now: nowFn });
    const res = await markFailed(
      id,
      "network_error",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      { client: fake.client },
    );
    expect(res.scheduledRetry).toBe(true);
    const row = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(row.status).toBe("pending");
    expect(row.next_attempt_at).not.toBeNull();
    // next_attempt_at é ~1min no futuro em relação a Date.now(); nowFn=T0 é
    // no passado, então o item pode aparecer. Simulamos "next tick imediato"
    // usando o instante do próprio next_attempt_at menos 1s.
    const nextAt = new Date(row.next_attempt_at as string);
    const justBefore = new Date(nextAt.getTime() - 1000);
    const early = await listDuePending(50, {
      client: fake.client,
      now: () => justBefore,
    });
    expect(early).toHaveLength(0);
    const onTime = await listDuePending(50, {
      client: fake.client,
      now: () => nextAt,
    });
    expect(onTime).toHaveLength(1);
  });

  it("19. tentativa máxima → failed terminal, não reaparece", async () => {
    const id = await seed(fake, {
      scheduled_at: past(60).toISOString(),
      next_attempt_at: null,
    });
    await markFailed(
      id,
      "perma",
      { retryable: true, currentAttempt: 4, maxAttempts: 5 },
      { client: fake.client },
    );
    const row = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(row.status).toBe("failed");
    const out = await listDuePending(50, { client: fake.client, now: nowFn });
    expect(out).toHaveLength(0);
  });
});
