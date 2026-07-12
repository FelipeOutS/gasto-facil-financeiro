/**
 * WA-C8.1 — Reagendamento seguro de notificações bloqueadas por quiet hours.
 *
 * Contrato validado:
 *  - quiet_hours NÃO produz `skipped` (que é terminal): a mesma linha
 *    volta a `pending` com `scheduled_at` no próximo horário permitido.
 *  - `attempt_count`, `dedupe_key`, `created_at`, `id` preservados.
 *  - `next_attempt_at` é sempre limpo no reagendamento.
 *  - Nenhuma linha nova criada.
 *  - Estados terminais (`sent`, `failed`, `cancelled`, `skipped`) NÃO são
 *    reabertos: o reagendamento exige `status = 'processing'`.
 *  - Retorno é união discriminada: `rescheduled | state_changed | error`
 *    (erro real de banco NUNCA é escondido como race).
 *  - Recuperação persistente após erro: mesma semântica, filtro
 *    `status='processing'`, nunca faz `markSkipped` nem envia.
 *  - Timezone respeitado; fallback `America/Sao_Paulo`.
 *  - DST spring-forward e fall-back reais de America/New_York cobertos.
 *  - Sem envio real, sem escrita em gastos/contas/receitas.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  rescheduleForQuietHours,
  recoverStuckReschedule,
  enqueueNotification,
  claimForProcessing,
  listDuePending,
  type NotificationRow,
} from "../src/server/whatsapp-notifications.server";
import {
  nextAllowedAfterQuietHours,
  hourInTimezone,
  isQuietHour,
  canDispatch,
} from "../src/server/whatsapp-notification-gates.server";

// ----------------------- Fake supabase (minimal) -----------------------
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = {
    whatsapp_notifications: [],
    whatsapp_notification_preferences: [],
    whatsapp_links: [],
    whatsapp_messages: [],
    profiles: [],
  };
  // WA-C8.1 — injeção one-shot de erro em UPDATE por tabela.
  const injectedUpdateErrors: Record<string, unknown> = {};

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
    } = {
      filters: [],
      updatePatch: null,
      orderBy: null,
      orderAsc: true,
      limitN: null,
    };
    function consumeError(): unknown | null {
      if (ctx.updatePatch != null && injectedUpdateErrors[table]) {
        const err = injectedUpdateErrors[table];
        delete injectedUpdateErrors[table];
        return err;
      }
      return null;
    }
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
        ctx.filters.push((r) => String(r[col]) <= String(val));
        return api;
      },
      gte(col: string, val: unknown) {
        ctx.filters.push((r) => String(r[col]) >= String(val));
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
        const err = consumeError();
        if (err) return { data: null, error: err };
        const rows = apply();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: unknown | null }) => unknown) {
        const err = consumeError();
        if (err) {
          return Promise.resolve(resolve({ data: [], error: err }));
        }
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
              created_at: new Date("2026-06-01T00:00:00Z").toISOString(),
              attempt_count: 0,
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
          updated.push(r);
        }
      }
      return updated;
    }
    return api;
  }
  return {
    client: { from } as unknown as Parameters<typeof enqueueNotification>[1]["client"],
    tables,
    injectUpdateError(table: string, err: unknown) {
      injectedUpdateErrors[table] = err;
    },
  };
}

// ----------------------- Helpers de teste -----------------------
const baseEnqueue = {
  userId: "u1",
  type: "conta_vence_amanha",
  category: "contas_a_pagar" as const,
  scheduledAt: new Date("2026-06-28T04:00:00Z"),
  dedupeKey: "conta_vence_amanha:conta-1:2026-06-28",
  entityType: "conta_a_pagar",
  entityId: "conta-1",
};

let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
});

/**
 * WA-C9.2 Fase B hardening — retorna o `claim_token` corrente da linha 0
 * do fake, ou "" quando não há claim. Passar "" ao contrato estrito de
 * `rescheduleForQuietHours` produz `state_changed` (validação de token),
 * o que casa com o cenário "sem claim" — sem bypass.
 */
function currentToken(): string {
  const row = fake.tables.whatsapp_notifications[0] as Record<string, unknown> | undefined;
  const t = row?.claim_token;
  return typeof t === "string" ? t : "";
}

// =====================================================================
// 1) nextAllowedAfterQuietHours — algoritmo puro
// =====================================================================
describe("WA-C8.1 :: nextAllowedAfterQuietHours (helper puro)", () => {
  const TZ_BR = "America/Sao_Paulo"; // UTC-3, sem DST no runtime moderno.

  it("fora da quiet hour → retorna null (nada a fazer)", () => {
    const r = nextAllowedAfterQuietHours(new Date("2026-06-28T15:00:00Z"), 22, 7, TZ_BR);
    expect(r).toBeNull();
  });

  it("dentro da janela 22→07: aos 23:59 local → 07:00 local do dia SEGUINTE", () => {
    const now = new Date("2026-06-28T02:59:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r).not.toBeNull();
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("dentro da janela 22→07: aos 00:01 local → 07:00 local do MESMO dia local", () => {
    const now = new Date("2026-06-28T03:01:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("exatamente no início (22:00 local) → reagenda para 07:00 local do dia seguinte", () => {
    const now = new Date("2026-06-28T01:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("exatamente no fim (07:00 local) → NÃO está em quiet (end exclusivo) → null", () => {
    const r = nextAllowedAfterQuietHours(new Date("2026-06-28T10:00:00Z"), 22, 7, TZ_BR);
    expect(r).toBeNull();
  });

  it("janela mesmo dia (09→12): dentro → 12:00 local", () => {
    const now = new Date("2026-06-28T13:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 9, 12, TZ_BR)!;
    expect(r.toISOString()).toBe("2026-06-28T15:00:00.000Z");
  });

  it("timezone alternativo (UTC): janela 22→07", () => {
    const now = new Date("2026-06-28T23:30:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "UTC")!;
    expect(r.toISOString()).toBe("2026-06-29T07:00:00.000Z");
  });

  it("timezone com DST (America/New_York) — retorna instante válido, fora da quiet e > now", () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "America/New_York")!;
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(isQuietHour(hourInTimezone(r, "America/New_York"), 22, 7)).toBe(false);
    expect(hourInTimezone(r, "America/New_York")).toBe(7);
  });

  it("timezone com offset fracionário (Asia/Kolkata, +05:30) — resultado válido", () => {
    const now = new Date("2026-06-28T20:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "Asia/Kolkata")!;
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(isQuietHour(hourInTimezone(r, "Asia/Kolkata"), 22, 7)).toBe(false);
    expect(hourInTimezone(r, "Asia/Kolkata")).toBe(7);
  });

  it("timezone inválido cai para fallback America/Sao_Paulo", () => {
    const now = new Date("2026-06-28T03:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "Not/AZone")!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("timezone ausente/null cai para fallback", () => {
    const now = new Date("2026-06-28T03:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, null)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("start === end → quiet hours desativado → retorna null", () => {
    const now = new Date("2026-06-28T03:00:00Z");
    expect(nextAllowedAfterQuietHours(now, 7, 7, TZ_BR)).toBeNull();
  });

  it("start/end nulos → desativado → retorna null", () => {
    const now = new Date("2026-06-28T03:00:00Z");
    expect(nextAllowedAfterQuietHours(now, null, 7, TZ_BR)).toBeNull();
    expect(nextAllowedAfterQuietHours(now, 22, null, TZ_BR)).toBeNull();
  });

  it("resultado alinhado a HH:00:00 no timezone local", () => {
    const now = new Date("2026-06-28T03:30:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r.getUTCMinutes()).toBe(0);
    expect(r.getUTCSeconds()).toBe(0);
    expect(hourInTimezone(r, TZ_BR)).toBe(7);
  });

  it("resultado nunca fica dentro da quiet hour e é sempre posterior a now", () => {
    const cases: Array<[string, number, number, string]> = [
      ["2026-06-28T03:00:00Z", 22, 7, TZ_BR],
      ["2026-06-28T01:00:00Z", 22, 7, TZ_BR],
      ["2026-06-28T13:00:00Z", 9, 12, TZ_BR],
      ["2026-06-28T23:30:00Z", 22, 7, "UTC"],
    ];
    for (const [iso, s, e, tz] of cases) {
      const now = new Date(iso);
      const r = nextAllowedAfterQuietHours(now, s, e, tz)!;
      expect(r.getTime()).toBeGreaterThan(now.getTime());
      expect(isQuietHour(hourInTimezone(r, tz), s, e)).toBe(false);
    }
  });
});

// =====================================================================
// 1b) DST real de America/New_York (spring-forward + fall-back)
// =====================================================================
describe("WA-C8.1 :: DST real America/New_York (2026)", () => {
  const TZ_NY = "America/New_York";

  function offsetMinutes(instant: Date, tz: string): number {
    // offset local - UTC, em minutos.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(instant);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? "0"));
  }

  it("spring-forward 2026-03-08 — entrada antes do avanço → resultado válido, > now, fora da quiet", () => {
    // 08 mar 2026, 06:00 UTC = 01:00 EST (pré-salto). Quiet 22→7 → dentro.
    const now = new Date("2026-03-08T06:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_NY)!;
    expect(r).not.toBeNull();
    expect(Number.isNaN(r.getTime())).toBe(false);
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(isQuietHour(hourInTimezone(r, TZ_NY), 22, 7)).toBe(false);
    // 07:00 EDT = 11:00 UTC (offset -04:00 pós-salto).
    expect(r.toISOString()).toBe("2026-03-08T11:00:00.000Z");
    // Registro de offsets para auditoria.
    expect(offsetMinutes(now, TZ_NY)).toBe(-300); // EST
    expect(offsetMinutes(r, TZ_NY)).toBe(-240); // EDT
  });

  it("spring-forward 2026-03-08 — end no horário inexistente (02) converge para primeiro instante válido", () => {
    // 06:30 UTC = 01:30 EST (dentro da janela 22→2). end=02:00 local não existe.
    // O algoritmo deve convergir para o instante logo após o salto (03:00 EDT).
    const now = new Date("2026-03-08T06:30:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 2, TZ_NY)!;
    expect(r).not.toBeNull();
    expect(Number.isNaN(r.getTime())).toBe(false);
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(isQuietHour(hourInTimezone(r, TZ_NY), 22, 2)).toBe(false);
    // Guarda de sanidade: hora local não pode cair dentro do "buraco".
    const hh = hourInTimezone(r, TZ_NY);
    expect(hh).not.toBe(2);
  });

  it("fall-back 2026-11-01 — dentro da janela (01:00 EDT, repetição prestes a acontecer)", () => {
    // 01 nov 2026, 05:00 UTC = 01:00 EDT (primeira ocorrência do wall-clock 01:00).
    const before = new Date("2026-11-01T05:00:00Z");
    const r1 = nextAllowedAfterQuietHours(before, 22, 7, TZ_NY)!;
    expect(r1).not.toBeNull();
    expect(Number.isNaN(r1.getTime())).toBe(false);
    expect(r1.getTime()).toBeGreaterThan(before.getTime());
    expect(isQuietHour(hourInTimezone(r1, TZ_NY), 22, 7)).toBe(false);
    // 07:00 EST = 12:00 UTC (offset -05:00 pós-fall-back).
    expect(r1.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(offsetMinutes(before, TZ_NY)).toBe(-240); // EDT
    expect(offsetMinutes(r1, TZ_NY)).toBe(-300); // EST
  });

  it("fall-back 2026-11-01 — dentro da janela (01:00 EST, segunda ocorrência do mesmo wall-clock)", () => {
    // 06:30 UTC = 01:30 EST (segunda ocorrência). Ainda dentro da janela 22→7.
    const after = new Date("2026-11-01T06:30:00Z");
    const r2 = nextAllowedAfterQuietHours(after, 22, 7, TZ_NY)!;
    expect(r2).not.toBeNull();
    expect(Number.isNaN(r2.getTime())).toBe(false);
    expect(r2.getTime()).toBeGreaterThan(after.getTime());
    expect(isQuietHour(hourInTimezone(r2, TZ_NY), 22, 7)).toBe(false);
    // Deve reagendar para 07:00 EST = 12:00 UTC, mesmo instante determinístico
    // independentemente de qual das duas ocorrências foi a entrada.
    expect(r2.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(offsetMinutes(after, TZ_NY)).toBe(-300); // EST
  });
});

// =====================================================================
// 2) rescheduleForQuietHours — persistência (novo contrato)
// =====================================================================
describe("WA-C8.1 :: rescheduleForQuietHours (persistência)", () => {
  it("reagenda a MESMA linha; preserva id/dedupe_key/attempt_count/created_at; limpa next_attempt_at", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    expect(row).not.toBeNull();
    // Estado inicial com next_attempt_at antigo + attempt_count > 0.
    Object.assign(fake.tables.whatsapp_notifications[0] as Row, {
      next_attempt_at: new Date("2026-06-01T00:00:00Z").toISOString(),
      attempt_count: 3,
    });
    const claimed = await claimForProcessing(row!.id, { client: fake.client });
    expect(claimed).not.toBeNull();

    const nextAt = new Date("2026-06-28T10:00:00Z");
    const res = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.status).toBe("rescheduled");

    const rows = fake.tables.whatsapp_notifications as unknown as NotificationRow[];
    expect(rows).toHaveLength(1);
    const after = rows[0];
    expect(after.id).toBe(row!.id);
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBe(nextAt.toISOString());
    expect(after.skipped_reason).toBeNull();
    expect(after.next_attempt_at).toBeNull(); // WA-C8.1 hardening
    expect(after.dedupe_key).toBe(baseEnqueue.dedupeKey);
    expect(after.attempt_count).toBe(3); // preservado
  });

  it("status pending → resultado = state_changed (não é erro)", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    const res = await rescheduleForQuietHours(row!.id, new Date("2026-06-28T10:00:00Z"), currentToken(), {
      client: fake.client,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("state_changed");
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBe(baseEnqueue.scheduledAt.toISOString());
  });

  it("estados terminais (cancelled/sent/failed/skipped) NÃO são reabertos", async () => {
    const terminals: NotificationRow["status"][] = ["cancelled", "sent", "failed", "skipped"];
    for (const term of terminals) {
      fake = buildFake();
      const row = await enqueueNotification(baseEnqueue, {
        client: fake.client,
      });
      (fake.tables.whatsapp_notifications[0] as Row).status = term;
      const res = await rescheduleForQuietHours(row!.id, new Date("2026-06-28T10:00:00Z"), currentToken(), {
        client: fake.client,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe("state_changed");
      const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
      expect(after.status).toBe(term);
    }
  });

  it("duas tentativas simultâneas: exatamente UMA rescheduled, outra state_changed", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    const a = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    const b = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.status).toBe("state_changed");
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("listDuePending respeita o novo scheduled_at; next_attempt_at antigo não influencia", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    // next_attempt_at antigo no passado — não deve elegibilizar antes de scheduled_at.
    (fake.tables.whatsapp_notifications[0] as Row).next_attempt_at = new Date(
      "2026-06-01T00:00:00Z",
    ).toISOString();
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    const res = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(res.ok).toBe(true);

    const before = await listDuePending(50, {
      client: fake.client,
      now: () => new Date("2026-06-28T09:59:00Z"),
    });
    expect(before).toHaveLength(0);

    const after = await listDuePending(50, {
      client: fake.client,
      now: () => new Date("2026-06-28T10:00:00Z"),
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(row!.id);
  });
});

// =====================================================================
// 2b) Erro de banco — diferenciado de race
// =====================================================================
describe("WA-C8.1 :: erro de banco no UPDATE", () => {
  it("Supabase retorna error → resultado = error (nunca state_changed)", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    fake.injectUpdateError("whatsapp_notifications", {
      code: "PGRST000",
      message: "connection reset",
    });
    const res = await rescheduleForQuietHours(row!.id, new Date("2026-06-28T10:00:00Z"), currentToken(), {
      client: fake.client,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("error");
    // Linha permanece em processing — não vira sent/skipped/cancelled.
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("processing");
    // Nenhuma linha nova.
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("UPDATE sem erro + zero linhas afetadas → state_changed (não error)", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    // Sem claim: status permanece pending → filtro falha, 0 linhas, sem erro.
    const res = await rescheduleForQuietHours(row!.id, new Date("2026-06-28T10:00:00Z"), currentToken(), {
      client: fake.client,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("state_changed");
  });

  it("recuperação após erro: UPDATE inicial falha → recovery restabelece processing→pending", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    // Primeiro UPDATE erra (injeção one-shot); segunda chamada roda limpa.
    fake.injectUpdateError("whatsapp_notifications", {
      code: "PGRST000",
      message: "boom",
    });
    const r1 = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.status).toBe("error");
    // Recovery preserva filtro processing → sucesso.
    const r2 = await recoverStuckReschedule(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r2.ok).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBe(nextAt.toISOString());
    expect(after.next_attempt_at).toBeNull();
    expect(after.attempt_count).toBe(0);
    expect(after.dedupe_key).toBe(baseEnqueue.dedupeKey);
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("recuperação também falha: status permanece processing, sem envio, sem markSkipped", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    fake.injectUpdateError("whatsapp_notifications", { code: "1", message: "a" });
    const r1 = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r1.ok).toBe(false);
    fake.injectUpdateError("whatsapp_notifications", { code: "2", message: "b" });
    const r2 = await recoverStuckReschedule(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.status).toBe("error");
    // Estado preso, mas observável — nunca sent/skipped.
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("processing");
    expect(after.skipped_reason ?? null).toBeNull();
    expect(after.sent_at ?? null).toBeNull();
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("recuperação após estado terminal simultâneo: retorna state_changed sem reabrir", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    fake.injectUpdateError("whatsapp_notifications", { code: "x", message: "y" });
    const r1 = await rescheduleForQuietHours(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r1.ok).toBe(false);
    // Nesse intervalo, o pagamento cancela a notificação.
    (fake.tables.whatsapp_notifications[0] as Row).status = "cancelled";
    const r2 = await recoverStuckReschedule(row!.id, nextAt, currentToken(), {
      client: fake.client,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.status).toBe("state_changed");
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("cancelled");
  });
});

// =====================================================================
// 3) canDispatch — expõe nextAllowedAt em quiet_hours
// =====================================================================
describe("WA-C8.1 :: canDispatch expõe nextAllowedAt", () => {
  it("quiet_hours → decision inclui nextAllowedAt > now e alinhado a end local", async () => {
    fake.tables.whatsapp_links.push({
      user_id: "u1",
      ativo: true,
      opt_in_em: "2026-06-01T00:00:00Z",
      revogado_em: null,
    });
    fake.tables.profiles.push({ id: "u1", timezone: "America/Sao_Paulo" });
    fake.tables.whatsapp_messages.push({
      user_id: "u1",
      created_at: new Date().toISOString(),
    });
    fake.tables.whatsapp_notification_preferences.push({
      user_id: "u1",
      contas_a_pagar: true,
      recorrencias: true,
      metas: false,
      orcamento: false,
      ia_insights: false,
      mercado: false,
      avisos_sistema: true,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
    });
    const now = new Date("2026-06-28T03:00:00Z");
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: false,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => now },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.reason).toBe("quiet_hours");
      expect(r.nextAllowedAt?.toISOString()).toBe("2026-06-28T10:00:00.000Z");
    }
  });
});
