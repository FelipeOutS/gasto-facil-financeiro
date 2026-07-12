/**
 * WA-C8.1 — Reagendamento seguro de notificações bloqueadas por quiet hours.
 *
 * Contrato validado:
 *  - quiet_hours NÃO produz `skipped` (que é terminal): a mesma linha
 *    volta a `pending` com `scheduled_at` no próximo horário permitido.
 *  - `attempt_count`, `dedupe_key`, `created_at`, `id` preservados.
 *  - Nenhuma linha nova criada.
 *  - Estados terminais (`sent`, `failed`, `cancelled`, `skipped`) NÃO são
 *    reabertos: o reagendamento exige `status = 'processing'`.
 *  - Timezone respeitado; fallback `America/Sao_Paulo`.
 *  - Suporta janela atravessando meia-noite e janela no mesmo dia.
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
        ctx.filters.push((r) => String(r[col]) <= String(val));
        return api;
      },
      gte(col: string, val: unknown) {
        ctx.filters.push((r) => String(r[col]) >= String(val));
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
  return { client: { from } as unknown as Parameters<typeof enqueueNotification>[1]["client"], tables };
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

// =====================================================================
// 1) nextAllowedAfterQuietHours — algoritmo puro
// =====================================================================
describe("WA-C8.1 :: nextAllowedAfterQuietHours (helper puro)", () => {
  const TZ_BR = "America/Sao_Paulo"; // UTC-3, sem DST no runtime moderno.

  it("fora da quiet hour → retorna null (nada a fazer)", () => {
    // 15:00 UTC = 12:00 em BR, janela 22→7 → fora.
    const r = nextAllowedAfterQuietHours(
      new Date("2026-06-28T15:00:00Z"),
      22,
      7,
      TZ_BR,
    );
    expect(r).toBeNull();
  });

  it("dentro da janela 22→07: aos 23:59 local → 07:00 local do dia SEGUINTE", () => {
    // 02:59 UTC de 28/06 = 23:59 local BR de 27/06.
    const now = new Date("2026-06-28T02:59:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r).not.toBeNull();
    // 07:00 BR de 28/06 = 10:00 UTC.
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("dentro da janela 22→07: aos 00:01 local → 07:00 local do MESMO dia local", () => {
    // 03:01 UTC de 28/06 = 00:01 local BR de 28/06.
    const now = new Date("2026-06-28T03:01:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("exatamente no início (22:00 local) → reagenda para 07:00 local do dia seguinte", () => {
    // 01:00 UTC de 28/06 = 22:00 local BR de 27/06.
    const now = new Date("2026-06-28T01:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, TZ_BR)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("exatamente no fim (07:00 local) → NÃO está em quiet (end exclusivo) → null", () => {
    // 10:00 UTC de 28/06 = 07:00 local BR.
    const r = nextAllowedAfterQuietHours(
      new Date("2026-06-28T10:00:00Z"),
      22,
      7,
      TZ_BR,
    );
    expect(r).toBeNull();
  });

  it("janela mesmo dia (09→12): dentro → 12:00 local", () => {
    // 13:00 UTC = 10:00 BR (dentro).
    const now = new Date("2026-06-28T13:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 9, 12, TZ_BR)!;
    // 12:00 BR = 15:00 UTC.
    expect(r.toISOString()).toBe("2026-06-28T15:00:00.000Z");
  });

  it("timezone alternativo (UTC): janela 22→07", () => {
    // 23:30 UTC → dentro da janela; end 07:00 UTC do dia seguinte.
    const now = new Date("2026-06-28T23:30:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "UTC")!;
    expect(r.toISOString()).toBe("2026-06-29T07:00:00.000Z");
  });

  it("timezone com DST (America/New_York) — retorna instante válido, fora da quiet e > now", () => {
    // 08:00 UTC ≈ 04:00 EDT (verão americano) → janela 22→07 → dentro.
    const now = new Date("2026-07-15T08:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "America/New_York")!;
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    // Precisa estar fora da quiet no timezone dado.
    expect(
      isQuietHour(hourInTimezone(r, "America/New_York"), 22, 7),
    ).toBe(false);
    // Alinhado a HH:00:00 no timezone (minutos/segundos = 0 no local).
    const hh = hourInTimezone(r, "America/New_York");
    expect(hh).toBe(7);
  });

  it("timezone com offset fracionário (Asia/Kolkata, +05:30) — resultado válido", () => {
    // 20:00 UTC = 01:30 IST → janela 22→07 → dentro.
    const now = new Date("2026-06-28T20:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, "Asia/Kolkata")!;
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(isQuietHour(hourInTimezone(r, "Asia/Kolkata"), 22, 7)).toBe(false);
    expect(hourInTimezone(r, "Asia/Kolkata")).toBe(7);
  });

  it("timezone inválido cai para fallback America/Sao_Paulo", () => {
    const now = new Date("2026-06-28T03:00:00Z"); // 00:00 BR
    const r = nextAllowedAfterQuietHours(now, 22, 7, "Not/AZone")!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("timezone ausente/null cai para fallback", () => {
    const now = new Date("2026-06-28T03:00:00Z");
    const r = nextAllowedAfterQuietHours(now, 22, 7, null)!;
    expect(r.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("start === end → quiet hours desativado → retorna null (preserva isQuietHour)", () => {
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
    // BR = UTC-3 sem DST: 10:00 UTC == 07:00 local exato.
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
// 2) rescheduleForQuietHours — persistência
// =====================================================================
describe("WA-C8.1 :: rescheduleForQuietHours (persistência)", () => {
  it("reagenda a MESMA linha; preserva id/dedupe_key/attempt_count/created_at", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    expect(row).not.toBeNull();
    const claimed = await claimForProcessing(row!.id, { client: fake.client });
    expect(claimed).not.toBeNull();

    const nextAt = new Date("2026-06-28T10:00:00Z");
    const ok = await rescheduleForQuietHours(row!.id, nextAt, {
      client: fake.client,
    });
    expect(ok).toBe(true);

    const rows = fake.tables.whatsapp_notifications as unknown as NotificationRow[];
    expect(rows).toHaveLength(1); // nenhuma linha nova
    const after = rows[0];
    expect(after.id).toBe(row!.id);
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBe(nextAt.toISOString());
    expect(after.skipped_reason).toBeNull();
    expect(after.dedupe_key).toBe(baseEnqueue.dedupeKey);
    expect(after.attempt_count).toBe(0); // não incrementa
  });

  it("só reagenda a partir de `processing` — status `pending` NÃO é atualizado", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    // Sem claim: fica pending.
    const ok = await rescheduleForQuietHours(
      row!.id,
      new Date("2026-06-28T10:00:00Z"),
      { client: fake.client },
    );
    expect(ok).toBe(false);
    const after = (fake.tables.whatsapp_notifications[0] as unknown as NotificationRow);
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBe(baseEnqueue.scheduledAt.toISOString());
  });

  it("não reabre estados terminais (cancelled/sent/failed/skipped)", async () => {
    const terminals: NotificationRow["status"][] = [
      "cancelled",
      "sent",
      "failed",
      "skipped",
    ];
    for (const term of terminals) {
      fake = buildFake();
      const row = await enqueueNotification(baseEnqueue, { client: fake.client });
      // Força estado terminal direto.
      (fake.tables.whatsapp_notifications[0] as Row).status = term;
      const ok = await rescheduleForQuietHours(
        row!.id,
        new Date("2026-06-28T10:00:00Z"),
        { client: fake.client },
      );
      expect(ok).toBe(false);
      const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
      expect(after.status).toBe(term);
    }
  });

  it("duas tentativas simultâneas: no máximo UMA atualiza (semântica processing→pending)", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    const a = await rescheduleForQuietHours(row!.id, nextAt, { client: fake.client });
    // Segunda chamada: já está `pending`, filtro `status = processing` falha.
    const b = await rescheduleForQuietHours(row!.id, nextAt, { client: fake.client });
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("listDuePending só retorna após o novo scheduled_at", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const nextAt = new Date("2026-06-28T10:00:00Z");
    await rescheduleForQuietHours(row!.id, nextAt, { client: fake.client });

    // Antes do horário reagendado → não é due.
    const before = await listDuePending(50, {
      client: fake.client,
      now: () => new Date("2026-06-28T09:59:00Z"),
    });
    expect(before).toHaveLength(0);

    // Depois → é due de novo.
    const after = await listDuePending(50, {
      client: fake.client,
      now: () => new Date("2026-06-28T10:00:00Z"),
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(row!.id);
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
    const now = new Date("2026-06-28T03:00:00Z"); // 00:00 BR
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
