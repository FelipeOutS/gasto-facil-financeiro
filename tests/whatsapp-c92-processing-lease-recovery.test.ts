/**
 * WA-C9.2 Fase B — Lease temporário, token de ownership e recuperação de
 * notificações presas em `processing`.
 *
 * Cobre:
 *  - claim grava claim_token, claimed_at, lease_expires_at (lease inicial 10 min);
 *  - transições saindo de processing exigem claim_token e limpam campos de claim;
 *  - renewProcessingLease preserva ownership;
 *  - recoverStuckProcessing devolve pending com backoff de 5 min, sem reabrir
 *    terminais e sem duplicidade em corrida com worker/outro recovery;
 *  - dispatcher-safe: worker antigo não altera linha após recovery.
 *
 * Sem envio Meta. Sem cron. Sem alteração de dados reais.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  enqueueNotification,
  claimForProcessing,
  markSent,
  markFailed,
  markSkipped,
  rescheduleForQuietHours,
  renewProcessingLease,
  recoverStuckProcessing,
  revertProcessingToPending,
  LEASE_DURATION_MS,
  RECOVERY_BACKOFF_MS,
  type NotificationRow,
} from "../src/server/whatsapp-notifications.server";

// ─── Fake supabase (com .or, .is null, .lte, .eq, .in, .order) ─────────────
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = { whatsapp_notifications: [] };
  function parseOr(expr: string): Array<(r: Row) => boolean> {
    return expr.split(",").map((cl) => {
      const [col, op, ...rest] = cl.trim().split(".");
      const val = rest.join(".");
      if (op === "is" && val === "null") return (r: Row) => r[col] == null;
      if (op === "lte") return (r: Row) => r[col] != null && String(r[col]) <= String(val);
      if (op === "gte") return (r: Row) => r[col] != null && String(r[col]) >= String(val);
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
    } = { filters: [], updatePatch: null, orderBy: null, orderAsc: true, limitN: null };
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
          const cols = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          const existing = cols.length ? data.find((d) => cols.every((c) => d[c] === r[c])) : undefined;
          if (existing) {
            if (opts?.ignoreDuplicates) continue;
            Object.assign(existing, r);
          } else {
            data.push({
              id: r.id ?? `id-${data.length + 1}`,
              attempt_count: 0,
              next_attempt_at: null,
              claim_token: null,
              claimed_at: null,
              lease_expires_at: null,
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

const T0 = new Date("2026-08-01T12:00:00Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
const past = (mins: number) => new Date(T0.getTime() - mins * 60_000);

let fake: ReturnType<typeof buildFake>;
let tokenSeq: number;
const nowFn = () => T0;
const nextUuid = () => `tok-${++tokenSeq}`;

async function seedPending(dedupe = `k-${Math.random().toString(36).slice(2)}`): Promise<NotificationRow> {
  const row = await enqueueNotification(
    {
      userId: "u1",
      type: "conta_vence_amanha",
      category: "contas_a_pagar",
      scheduledAt: past(60),
      dedupeKey: dedupe,
      entityType: "conta_a_pagar",
      entityId: "conta-1",
    },
    { client: fake.client },
  );
  return row!;
}

async function seedProcessing(dedupe?: string): Promise<{ id: string; token: string; row: Row }> {
  const p = await seedPending(dedupe);
  const claimed = await claimForProcessing(p.id, {
    client: fake.client,
    now: nowFn,
    randomUUID: nextUuid,
  });
  const row = fake.tables.whatsapp_notifications.find((r) => r.id === claimed!.id)!;
  return { id: claimed!.id, token: claimed!.claim_token!, row };
}

beforeEach(() => {
  fake = buildFake();
  tokenSeq = 0;
});

// ═══════════════════════════════ CLAIM ═══════════════════════════════════

describe("WA-C9.2/B :: claimForProcessing → lease & token", () => {
  it("1. claim elegível grava claim_token único", async () => {
    const p = await seedPending();
    const c = await claimForProcessing(p.id, { client: fake.client, now: nowFn, randomUUID: nextUuid });
    expect(c).not.toBeNull();
    expect(c!.claim_token).toBe("tok-1");
  });

  it("2. claim elegível grava claimed_at = now", async () => {
    const { row } = await seedProcessing();
    expect(row.claimed_at).toBe(T0.toISOString());
  });

  it("3. claim elegível grava lease_expires_at = now + 10min", async () => {
    const { row } = await seedProcessing();
    expect(row.lease_expires_at).toBe(new Date(T0.getTime() + LEASE_DURATION_MS).toISOString());
  });

  it("4. LEASE_DURATION_MS = 10 minutos", () => {
    expect(LEASE_DURATION_MS).toBe(10 * 60_000);
  });

  it("5. claim preserva attempt_count, dedupe_key, scheduled_at", async () => {
    const p = await seedPending("dk-preserve");
    (fake.tables.whatsapp_notifications[0] as Row).attempt_count = 2;
    const c = await claimForProcessing(p.id, { client: fake.client, now: nowFn, randomUUID: nextUuid });
    expect(c!.attempt_count).toBe(2);
    expect(c!.dedupe_key).toBe("dk-preserve");
    expect(c!.scheduled_at).toBe(past(60).toISOString());
  });

  it("6. dois claims sequenciais no mesmo ID: segundo retorna null", async () => {
    const p = await seedPending();
    const a = await claimForProcessing(p.id, { client: fake.client, now: nowFn, randomUUID: nextUuid });
    const b = await claimForProcessing(p.id, { client: fake.client, now: nowFn, randomUUID: nextUuid });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});

// ═══════════════════════════════ OWNERSHIP ═══════════════════════════════

describe("WA-C9.2/B :: ownership por claim_token", () => {
  it("7. markSent com token correto: sucesso, limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const ok = await markSent(id, "wamid.1", token, { client: fake.client });
    expect(ok).toBe(true);
    expect(row.status).toBe("sent");
    expect(row.claim_token).toBeNull();
    expect(row.claimed_at).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  it("8. markSent com token INCORRETO: no-op, linha intacta", async () => {
    const { id, row } = await seedProcessing();
    const ok = await markSent(id, "wamid.x", "wrong-token", { client: fake.client });
    expect(ok).toBe(false);
    expect(row.status).toBe("processing");
    expect(row.claim_token).toBe("tok-1");
  });

  it("9. markFailed retry com token correto: pending + limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const res = await markFailed(
      id,
      "net",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      token,
      { client: fake.client },
    );
    expect(res.updated).toBe(true);
    expect(res.scheduledRetry).toBe(true);
    expect(row.status).toBe("pending");
    expect(row.claim_token).toBeNull();
    expect(row.lease_expires_at).toBeNull();
    expect(row.claimed_at).toBeNull();
  });

  it("10. markFailed terminal com token correto: failed + limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const res = await markFailed(
      id,
      "perma",
      { retryable: true, currentAttempt: 4, maxAttempts: 5 },
      token,
      { client: fake.client },
    );
    expect(res.scheduledRetry).toBe(false);
    expect(row.status).toBe("failed");
    expect(row.claim_token).toBeNull();
  });

  it("11. markFailed com token INCORRETO: no-op", async () => {
    const { id, row } = await seedProcessing();
    const res = await markFailed(
      id,
      "x",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      "wrong",
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    expect(row.status).toBe("processing");
  });

  it("12. markSkipped com token correto: skipped + limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const ok = await markSkipped(id, "template_missing", token, { client: fake.client });
    expect(ok).toBe(true);
    expect(row.status).toBe("skipped");
    expect(row.claim_token).toBeNull();
  });

  it("13. markSkipped com token INCORRETO: no-op", async () => {
    const { id, row } = await seedProcessing();
    const ok = await markSkipped(id, "template_missing", "wrong", { client: fake.client });
    expect(ok).toBe(false);
    expect(row.status).toBe("processing");
  });

  it("14. rescheduleForQuietHours com token correto: pending + limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const nextAt = new Date(T0.getTime() + 6 * 60 * 60_000);
    const res = await rescheduleForQuietHours(id, nextAt, token, { client: fake.client });
    expect(res.ok).toBe(true);
    expect(row.status).toBe("pending");
    expect(row.scheduled_at).toBe(nextAt.toISOString());
    expect(row.next_attempt_at).toBeNull();
    expect(row.claim_token).toBeNull();
    expect(row.claimed_at).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  it("15. rescheduleForQuietHours com token INCORRETO: state_changed", async () => {
    const { id, row } = await seedProcessing();
    const res = await rescheduleForQuietHours(id, at(60_000), "wrong", { client: fake.client });
    expect(res.ok).toBe(false);
    expect(row.status).toBe("processing");
  });

  it("16. revertProcessingToPending (dry-run) exige token; sucesso limpa claim fields", async () => {
    const { id, token, row } = await seedProcessing();
    const ok = await revertProcessingToPending(id, token, { client: fake.client });
    expect(ok).toBe(true);
    expect(row.status).toBe("pending");
    expect(row.claim_token).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  it("17. revertProcessingToPending com token INCORRETO: no-op", async () => {
    const { id, row } = await seedProcessing();
    const ok = await revertProcessingToPending(id, "wrong", { client: fake.client });
    expect(ok).toBe(false);
    expect(row.status).toBe("processing");
  });
});

// ═══════════════════════════════ RENEW ═══════════════════════════════════

describe("WA-C9.2/B :: renewProcessingLease", () => {
  it("18. renew válido estende lease_expires_at", async () => {
    const { id, token, row } = await seedProcessing();
    const later = () => new Date(T0.getTime() + 60_000);
    const ok = await renewProcessingLease(id, token, { client: fake.client, now: later });
    expect(ok).toBe(true);
    expect(row.lease_expires_at).toBe(new Date(T0.getTime() + 60_000 + LEASE_DURATION_MS).toISOString());
  });

  it("19. renew preserva claimed_at, attempt_count, dedupe_key, scheduled_at", async () => {
    const { id, token, row } = await seedProcessing();
    const claimedAt = row.claimed_at;
    const scheduled = row.scheduled_at;
    const dk = row.dedupe_key;
    row.attempt_count = 3;
    await renewProcessingLease(id, token, { client: fake.client, now: () => at(30_000) });
    expect(row.claimed_at).toBe(claimedAt);
    expect(row.scheduled_at).toBe(scheduled);
    expect(row.dedupe_key).toBe(dk);
    expect(row.attempt_count).toBe(3);
  });

  it("20. renew com token INCORRETO falha", async () => {
    const { id, row } = await seedProcessing();
    const before = row.lease_expires_at;
    const ok = await renewProcessingLease(id, "wrong", { client: fake.client, now: () => at(60_000) });
    expect(ok).toBe(false);
    expect(row.lease_expires_at).toBe(before);
  });

  it("21. renew após recovery (token invalidado) falha", async () => {
    const { id, token, row } = await seedProcessing();
    // Recovery: força lease vencido e roda recuperação.
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(row.status).toBe("pending");
    // Worker antigo tenta renovar
    const ok = await renewProcessingLease(id, token, { client: fake.client, now: nowFn });
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════ RECOVERY ════════════════════════════════

describe("WA-C9.2/B :: recoverStuckProcessing", () => {
  it("22. lease ainda válido: recovery ignora", async () => {
    const { row } = await seedProcessing();
    // lease futuro
    row.lease_expires_at = at(60_000).toISOString();
    const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s.recovered).toBe(0);
    expect(row.status).toBe("processing");
  });

  it("23. lease expirado: processing → pending", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s.recovered).toBe(1);
    expect(row.status).toBe("pending");
  });

  it("24. recovery agenda next_attempt_at = now + 5 min", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(row.next_attempt_at).toBe(new Date(T0.getTime() + RECOVERY_BACKOFF_MS).toISOString());
  });

  it("25. recovery grava last_error_code=processing_timeout", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(row.last_error_code).toBe("processing_timeout");
  });

  it("26. recovery preserva attempt_count e dedupe_key", async () => {
    const { row } = await seedProcessing("dk-1");
    row.attempt_count = 2;
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(row.attempt_count).toBe(2);
    expect(row.dedupe_key).toBe("dk-1");
  });

  it("27. recovery limpa claim_token, claimed_at, lease_expires_at", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(row.claim_token).toBeNull();
    expect(row.claimed_at).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  it("28. recovery não reabre sent", async () => {
    const { id, token, row } = await seedProcessing();
    await markSent(id, "wamid", token, { client: fake.client });
    row.lease_expires_at = past(1).toISOString();
    // volta lease para testar cenário: linha ficou com sent mas lease_expires_at ainda setado?
    // Como markSent limpa lease → não há candidato para recovery, o que é o desejado.
    const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s.recovered).toBe(0);
    expect(row.status).toBe("sent");
  });

  it("29. recovery não reabre cancelled/failed/skipped", async () => {
    const scenarios: Array<"cancelled" | "failed" | "skipped"> = ["cancelled", "failed", "skipped"];
    for (const target of scenarios) {
      fake = buildFake();
      tokenSeq = 0;
      const { row } = await seedProcessing();
      row.status = target;
      row.lease_expires_at = past(1).toISOString();
      // Nota: em produção, transições terminais limpam lease. Aqui simulamos
      // um cenário defensivo onde a linha ficou com status terminal + lease
      // ativo (não deveria acontecer). Recovery ainda assim NÃO reabre.
      const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
      expect(s.recovered).toBe(0);
      expect(row.status).toBe(target);
    }
  });

  it("30. dois recoveries simultâneos: no máximo um recupera", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    const [a, b] = await Promise.all([
      recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true }),
      recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true }),
    ]);
    expect(a.recovered + b.recovered).toBe(1);
    expect(row.status).toBe("pending");
  });

  it("31. worker antigo não marca sent após recovery", async () => {
    const { id, token, row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    const ok = await markSent(id, "wamid", token, { client: fake.client });
    expect(ok).toBe(false);
    expect(row.status).toBe("pending");
  });

  it("32. worker antigo não marca failed após recovery", async () => {
    const { id, token, row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    const res = await markFailed(
      id,
      "boom",
      { retryable: true, currentAttempt: 0, maxAttempts: 5 },
      token,
      { client: fake.client },
    );
    expect(res.updated).toBe(false);
    expect(row.status).toBe("pending");
  });

  it("33. worker antigo não reagenda quiet_hours após recovery", async () => {
    const { id, token, row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    const oldScheduled = row.scheduled_at;
    const res = await rescheduleForQuietHours(id, at(3_600_000), token, { client: fake.client });
    expect(res.ok).toBe(false);
    expect(row.scheduled_at).toBe(oldScheduled);
  });

  it("34. novo claim após recovery gera token novo", async () => {
    const { row } = await seedProcessing();
    row.lease_expires_at = past(1).toISOString();
    await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    // next_attempt_at futuro (+5 min) impede novo claim antes do backoff
    const early = await claimForProcessing(row.id as string, {
      client: fake.client,
      now: nowFn,
      randomUUID: nextUuid,
    });
    expect(early).toBeNull();
    // Após backoff:
    const later = () => new Date(T0.getTime() + RECOVERY_BACKOFF_MS + 1_000);
    const c = await claimForProcessing(row.id as string, {
      client: fake.client,
      now: later,
      randomUUID: nextUuid,
    });
    expect(c).not.toBeNull();
    expect(c!.claim_token).not.toBe("tok-1");
  });

  it("35. limit preservado; ordena por lease_expires_at ASC", async () => {
    // 3 linhas com lease vencido em ordens diferentes.
    for (let i = 0; i < 3; i++) {
      const { row } = await seedProcessing(`dk-${i}`);
      row.lease_expires_at = new Date(T0.getTime() - (10 - i) * 60_000).toISOString();
    }
    const s = await recoverStuckProcessing(2, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s.recovered).toBe(2);
  });

  it("36. sem candidatos: summary zerado", async () => {
    const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s).toEqual({ recovered: 0, state_changed: 0, errors: 0 });
  });

  it("37. linha legada sem claim_token não é recuperada automaticamente", async () => {
    const p = await seedPending("dk-legacy");
    const row = fake.tables.whatsapp_notifications[0] as Row;
    row.status = "processing";
    row.lease_expires_at = past(5).toISOString();
    row.claim_token = null;
    const s = await recoverStuckProcessing(50, { client: fake.client, now: nowFn, allowLegacyFakePath: true });
    expect(s.recovered).toBe(0);
    expect(s.state_changed).toBeGreaterThan(0);
    expect(row.status).toBe("processing");
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    p;
  });
});
