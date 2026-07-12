/**
 * WA-C8 — Testes da infra de notificações outbound (sem envio real).
 *
 * Cobre:
 *  1) enqueue cria pending
 *  2) deduplicação por (user_id, dedupe_key)
 *  3) claim atômico — só um vence
 *  4) retry com backoff exponencial; estoura max_attempts → failed terminal
 *  5) cancelByEntity filtra user_id (não toca outro user)
 *  6) gate canal não optado → skip channel_not_optedin
 *  7) gate categoria desligada → skip category_opt_out
 *  8) quiet hours respeita timezone (cross-midnight)
 *  9) janela 24h ausente + template sem HSM → skip no_session_window
 *  10) hour-in-timezone básico
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  enqueueNotification,
  claimForProcessing,
  markFailed,
  cancelByEntity,
  type NotificationRow,
} from "../src/server/whatsapp-notifications.server";
import {
  canDispatch,
  hourInTimezone,
  isQuietHour,
} from "../src/server/whatsapp-notification-gates.server";

// ----------------------- Fake supabase client -----------------------
type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = {
    whatsapp_notifications: [],
    whatsapp_notification_preferences: [],
    whatsapp_notification_templates: [],
    whatsapp_links: [],
    whatsapp_messages: [],
    profiles: [],
  };

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
      inFilter: { col: string; vals: unknown[] } | null;
      updatePatch: Row | null;
      selectAfter: boolean;
      single: boolean;
      orderBy: string | null;
      orderAsc: boolean;
      limitN: number | null;
      upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | null;
    } = {
      filters: [],
      inFilter: null,
      updatePatch: null,
      selectAfter: false,
      single: false,
      orderBy: null,
      orderAsc: true,
      limitN: null,
      upsertOpts: null,
    };

    const api: {
      select: (...args: unknown[]) => typeof api;
      eq: (col: string, val: unknown) => typeof api;
      in: (col: string, vals: unknown[]) => typeof api;
      lte: (col: string, val: unknown) => typeof api;
      gte: (col: string, val: unknown) => typeof api;
      or: (expr: string) => typeof api;
      order: (col: string, opts?: { ascending?: boolean }) => typeof api;
      limit: (n: number) => typeof api;
      maybeSingle: () => Promise<{ data: Row | null; error: null }>;
      then: (
        resolve: (v: { data: Row[] | Row | null; error: null }) => unknown,
      ) => Promise<unknown>;
      upsert: (
        row: Row | Row[],
        opts?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) => typeof api;
      update: (patch: Row) => typeof api;
      insert: (row: Row | Row[]) => typeof api;
    } = {
      select() {
        ctx.selectAfter = true;
        return api;
      },
      eq(col, val) {
        ctx.filters.push((r) => r[col] === val);
        return api;
      },
      in(col, vals) {
        ctx.inFilter = { col, vals };
        ctx.filters.push((r) => vals.includes(r[col]));
        return api;
      },
      lte(col, val) {
        ctx.filters.push((r) => String(r[col]) <= String(val));
        return api;
      },
      or(expr) {
        const preds = parseOr(expr);
        ctx.filters.push((r) => preds.some((p) => p(r)));
        return api;
      },
      gte(col, val) {
        ctx.filters.push((r) => String(r[col]) >= String(val));
        return api;
      },
      order(col, opts) {
        ctx.orderBy = col;
        ctx.orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n) {
        ctx.limitN = n;
        return api;
      },
      async maybeSingle() {
        ctx.single = true;
        const rows = applyAll();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve) {
        // SELECT terminal sem maybeSingle
        const rows = applyAll();
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
      upsert(row, opts) {
        ctx.upsertOpts = opts ?? null;
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          const conflictCols = (opts?.onConflict ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const existing = conflictCols.length
            ? data.find((d) => conflictCols.every((c) => d[c] === r[c]))
            : undefined;
          if (existing) {
            if (opts?.ignoreDuplicates) continue;
            Object.assign(existing, r);
          } else {
            data.push({ id: r.id ?? `id-${data.length + 1}`, ...r });
          }
        }
        return api;
      },
      update(patch) {
        ctx.updatePatch = patch;
        return api;
      },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) data.push({ id: `id-${data.length + 1}`, ...r });
        return api;
      },
    };

    function applyAll(): Row[] {
      // SELECT path
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
      // UPDATE path
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
  };
}

// ----------------------- Tests -----------------------
let fake: ReturnType<typeof buildFake>;
beforeEach(() => {
  fake = buildFake();
});

const baseEnqueue = {
  userId: "u1",
  type: "conta_vence_amanha",
  category: "contas_a_pagar" as const,
  scheduledAt: new Date("2026-06-28T10:00:00Z"),
  dedupeKey: "conta_vence_amanha:conta-1:2026-06-28",
  entityType: "conta_a_pagar",
  entityId: "conta-1",
};

describe("WA-C8 :: enqueue/dedup", () => {
  it("enqueueNotification cria uma linha pending", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });

  it("mesma dedupe_key não cria duplicata", async () => {
    await enqueueNotification(baseEnqueue, { client: fake.client });
    await enqueueNotification(baseEnqueue, { client: fake.client });
    expect(fake.tables.whatsapp_notifications).toHaveLength(1);
  });
});

describe("WA-C8 :: claim atômico", () => {
  it("primeiro claim vence, segundo retorna null", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    const a = await claimForProcessing(row!.id, { client: fake.client });
    const b = await claimForProcessing(row!.id, { client: fake.client });
    expect(a).not.toBeNull();
    expect(a!.status).toBe("processing");
    expect(b).toBeNull();
  });
});

describe("WA-C8 :: retry/backoff", () => {
  it("markFailed retryable agenda nova tentativa e volta a pending", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    await claimForProcessing(row!.id, { client: fake.client });
    const res = await markFailed(
      row!.id,
      "network_error",
      { retryable: true, currentAttempt: 0, maxAttempts: 3 },
      { client: fake.client },
    );
    expect(res.scheduledRetry).toBe(true);
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("pending");
    expect(after.attempt_count).toBe(1);
    expect(after.next_attempt_at).not.toBeNull();
  });

  it("estoura max_attempts → terminal failed", async () => {
    const row = await enqueueNotification(baseEnqueue, { client: fake.client });
    const res = await markFailed(
      row!.id,
      "perma",
      { retryable: true, currentAttempt: 4, maxAttempts: 5 },
      { client: fake.client },
    );
    expect(res.scheduledRetry).toBe(false);
    const after = fake.tables.whatsapp_notifications[0] as unknown as NotificationRow;
    expect(after.status).toBe("failed");
    expect(after.failed_at).not.toBeNull();
  });
});

describe("WA-C8 :: cancelByEntity filtra user_id", () => {
  it("não cancela notificação de outro usuário", async () => {
    await enqueueNotification(baseEnqueue, { client: fake.client });
    await enqueueNotification(
      { ...baseEnqueue, userId: "u2", dedupeKey: "outro-user" },
      { client: fake.client },
    );
    const n = await cancelByEntity("u1", "conta_a_pagar", "conta-1", {
      client: fake.client,
    });
    expect(n).toBe(1);
    const rows = fake.tables.whatsapp_notifications as unknown as NotificationRow[];
    const u1 = rows.find((r) => r.user_id === "u1")!;
    const u2 = rows.find((r) => r.user_id === "u2")!;
    expect(u1.status).toBe("cancelled");
    expect(u2.status).toBe("pending");
  });
});

describe("WA-C8 :: quiet hours + timezone", () => {
  it("isQuietHour cobre janela contínua", () => {
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(3, 22, 7)).toBe(true);
    expect(isQuietHour(12, 22, 7)).toBe(false);
    expect(isQuietHour(10, 9, 12)).toBe(true);
    expect(isQuietHour(8, 9, 12)).toBe(false);
  });

  it("hourInTimezone converte UTC → America/Sao_Paulo (UTC-3)", () => {
    const utcMidnight = new Date("2026-06-28T00:00:00Z");
    expect(hourInTimezone(utcMidnight, "America/Sao_Paulo")).toBe(21);
  });
});

describe("WA-C8 :: gates", () => {
  function seedHappyPath() {
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
  }

  it("canal sem opt_in → channel_not_optedin", async () => {
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: false,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T15:00:00Z") },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe("channel_not_optedin");
  });

  it("canal revogado → channel_revoked", async () => {
    fake.tables.whatsapp_links.push({
      user_id: "u1",
      ativo: true,
      opt_in_em: "2026-06-01T00:00:00Z",
      revogado_em: "2026-06-20T00:00:00Z",
    });
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: false,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T15:00:00Z") },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe("channel_revoked");
  });

  it("categoria desligada → category_opt_out", async () => {
    seedHappyPath();
    fake.tables.whatsapp_notification_preferences.push({
      user_id: "u1",
      contas_a_pagar: true,
      recorrencias: true,
      metas: false,
      orcamento: false,
      ia_insights: false,
      mercado: false,
      avisos_sistema: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
    const r = await canDispatch(
      {
        userId: "u1",
        category: "metas",
        requiresTemplateWindow: false,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T15:00:00Z") },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe("category_opt_out");
  });

  it("quiet hours respeitadas no TZ do usuário", async () => {
    seedHappyPath();
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
    // 03:00 UTC = 00:00 em America/Sao_Paulo → dentro do quiet hours (22→7)
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: false,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T03:00:00Z") },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.reason).toBe("quiet_hours");
      // WA-C8.1 — quiet_hours agora inclui nextAllowedAt (bloqueio temporário).
      expect(r.nextAllowedAt).toBeDefined();
      expect(r.nextAllowedAt!.getTime()).toBeGreaterThan(
        new Date("2026-06-28T03:00:00Z").getTime(),
      );
    }
  });

  it("janela 24h ausente + sem HSM → no_session_window", async () => {
    fake.tables.whatsapp_links.push({
      user_id: "u1",
      ativo: true,
      opt_in_em: "2026-06-01T00:00:00Z",
      revogado_em: null,
    });
    fake.tables.profiles.push({ id: "u1", timezone: "America/Sao_Paulo" });
    // NÃO há whatsapp_messages recentes
    fake.tables.whatsapp_notification_preferences.push({
      user_id: "u1",
      contas_a_pagar: true,
      recorrencias: true,
      metas: false,
      orcamento: false,
      ia_insights: false,
      mercado: false,
      avisos_sistema: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: true,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T15:00:00Z") },
    );
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe("no_session_window");
  });

  it("happy path: tudo verde → allow", async () => {
    seedHappyPath();
    fake.tables.whatsapp_notification_preferences.push({
      user_id: "u1",
      contas_a_pagar: true,
      recorrencias: true,
      metas: false,
      orcamento: false,
      ia_insights: false,
      mercado: false,
      avisos_sistema: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
    const r = await canDispatch(
      {
        userId: "u1",
        category: "contas_a_pagar",
        requiresTemplateWindow: true,
        hasMetaTemplate: false,
      },
      { client: fake.client, now: () => new Date("2026-06-28T15:00:00Z") },
    );
    expect(r.allow).toBe(true);
  });
});
