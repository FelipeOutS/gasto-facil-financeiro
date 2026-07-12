/**
 * WA-C9.2 Fase C — testes de callbacks de status da Meta.
 *
 * Cobre: parser, event_key, redutor puro (ordem/duplicatas/out-of-order),
 * persistência idempotente, aplicação (terminal/pending/processing) e
 * reconciliação. O foco é a lógica pura; DB é mockado.
 */

import { describe, it, expect } from "vitest";
import {
  buildEventKey,
  classifyMetaError,
  parseStatusesFromChangeValue,
  reduceProviderStatusEvents,
  persistAndApplyEvents,
  applyProviderStatusAggregate,
  reconcileStatusEvents,
  type ParsedStatusEvent,
  type CurrentNotification,
  type SupabaseLike,
} from "@/server/whatsapp-meta-status-callbacks.server";

const T = (h: number, m = 0, s = 0) =>
  new Date(Date.UTC(2026, 6, 12, h, m, s)).toISOString();

const EV = (
  overrides: Partial<
    Pick<ParsedStatusEvent, "event_status" | "event_at" | "error_code">
  >,
): Pick<ParsedStatusEvent, "event_status" | "event_at" | "error_code"> => ({
  event_status: "sent",
  event_at: T(10),
  error_code: null,
  ...overrides,
});

const EMPTY: CurrentNotification = {
  status: "processing",
  sent_at: null,
  delivered_at: null,
  read_at: null,
  failed_at: null,
  last_error_code: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// event_key

describe("buildEventKey", () => {
  it("é determinística para o mesmo input", () => {
    const a = buildEventKey({
      provider_message_id: "wamid.abc",
      event_status: "delivered",
      event_at: T(10),
      error_code: null,
    });
    const b = buildEventKey({
      provider_message_id: "wamid.abc",
      event_status: "delivered",
      event_at: T(10),
      error_code: null,
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("muda quando qualquer campo muda", () => {
    const base = {
      provider_message_id: "wamid.abc",
      event_status: "delivered" as const,
      event_at: T(10),
      error_code: null,
    };
    const k = buildEventKey(base);
    expect(buildEventKey({ ...base, event_status: "read" })).not.toBe(k);
    expect(buildEventKey({ ...base, event_at: T(11) })).not.toBe(k);
    expect(buildEventKey({ ...base, error_code: "131047" })).not.toBe(k);
    expect(buildEventKey({ ...base, provider_message_id: "wamid.xyz" })).not.toBe(k);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyMetaError

describe("classifyMetaError", () => {
  it("classifica códigos conhecidos", () => {
    expect(classifyMetaError("190")).toBe("authentication");
    expect(classifyMetaError("131047")).toBe("authentication");
    expect(classifyMetaError("130472")).toBe("rate_limit");
    expect(classifyMetaError("131026")).toBe("permanent");
    expect(classifyMetaError("131016")).toBe("retryable");
    expect(classifyMetaError("999999")).toBe("unknown");
    expect(classifyMetaError(null)).toBeNull();
    expect(classifyMetaError("abc")).toBe("unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parser

describe("parseStatusesFromChangeValue", () => {
  it("extrai eventos válidos", () => {
    const out = parseStatusesFromChangeValue({
      statuses: [
        { id: "wamid.1", status: "sent", timestamp: "1752316200" },
        { id: "wamid.1", status: "delivered", timestamp: "1752316260" },
      ],
      metadata: { phone_number_id: "PID" },
    });
    expect(out.events).toHaveLength(2);
    expect(out.events[0].event_status).toBe("sent");
    expect(out.events[0].phone_number_id).toBe("PID");
    expect(out.events[0].event_key).toHaveLength(64);
    expect(out.invalid).toBe(0);
  });

  it("descarta status desconhecido", () => {
    const out = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.1", status: "clicked", timestamp: "1752316200" }],
    });
    expect(out.events).toHaveLength(0);
    expect(out.unknown_status).toBe(1);
  });

  it("descarta timestamp inválido / futuro absurdo / muito antigo", () => {
    const now = Math.floor(Date.now() / 1000);
    const future = now + 60 * 60 * 24 * 30; // 30 dias
    const out = parseStatusesFromChangeValue({
      statuses: [
        { id: "wamid.1", status: "sent", timestamp: "abc" },
        { id: "wamid.2", status: "sent", timestamp: String(future) },
        { id: "wamid.3", status: "sent", timestamp: "1000" },
      ],
    });
    expect(out.events).toHaveLength(0);
    expect(out.invalid).toBe(3);
  });

  it("rejeita lote quando phone_number_id não bate", () => {
    const out = parseStatusesFromChangeValue(
      {
        statuses: [{ id: "wamid.1", status: "sent", timestamp: "1752316200" }],
        metadata: { phone_number_id: "OUTRO" },
      },
      { expected_phone_number_id: "MEU" },
    );
    expect(out.events).toHaveLength(0);
    expect(out.wrong_phone_number).toBe(1);
  });

  it("sanitiza title/message do erro (sem controles, truncado)", () => {
    const out = parseStatusesFromChangeValue({
      statuses: [
        {
          id: "wamid.err",
          status: "failed",
          timestamp: "1752316200",
          errors: [
            {
              code: 131047,
              title: "Re-engagement message",
              message: "a".repeat(2000) + "\u0000",
            },
          ],
        },
      ],
    });
    expect(out.events[0].error_code).toBe("131047");
    expect(out.events[0].error_message?.length).toBeLessThanOrEqual(1000);
    expect(out.events[0].error_message).not.toContain("\u0000");
    expect(out.events[0].error_category).toBe("authentication");
  });

  it("normaliza epoch em ms também", () => {
    const out = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.1", status: "sent", timestamp: 1752316200000 }],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].event_at).toMatch(/^2025-07-|^2026-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// redutor puro — cenários canônicos

describe("reduceProviderStatusEvents", () => {
  it("caso feliz: sent → delivered → read", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "sent", event_at: T(10) }),
        EV({ event_status: "delivered", event_at: T(11) }),
        EV({ event_status: "read", event_at: T(12) }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("sent");
    expect(r.sent_at).toBe(T(10));
    expect(r.delivered_at).toBe(T(11));
    expect(r.read_at).toBe(T(12));
    expect(r.failed_at).toBeNull();
    expect(r.last_error_code).toBeNull();
  });

  it("out-of-order: read chega antes de delivered", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "read", event_at: T(12) }),
        EV({ event_status: "delivered", event_at: T(11) }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("sent");
    expect(r.delivered_at).toBe(T(11));
    expect(r.read_at).toBe(T(12));
  });

  it("duplicatas exatas: idempotente", () => {
    const one = EV({ event_status: "delivered", event_at: T(11) });
    const r1 = reduceProviderStatusEvents([one], EMPTY);
    const r2 = reduceProviderStatusEvents([one, one, one], EMPTY);
    expect(r1).toEqual(r2);
  });

  it("failed sozinho → status failed", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({
          event_status: "failed",
          event_at: T(10),
          error_code: "131047",
        }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("failed");
    expect(r.failed_at).toBe(T(10));
    expect(r.last_error_code).toBe("131047");
  });

  it("delivered chega depois de failed: promove para sent e limpa erro", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "failed", event_at: T(10), error_code: "131047" }),
        EV({ event_status: "delivered", event_at: T(11) }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("sent");
    expect(r.failed_at).toBeNull();
    expect(r.last_error_code).toBeNull();
    expect(r.delivered_at).toBe(T(11));
  });

  it("sent + failed sem delivered: o mais recente vence (failed)", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "sent", event_at: T(10) }),
        EV({ event_status: "failed", event_at: T(11), error_code: "500" }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("failed");
    expect(r.sent_at).toBe(T(10));
    expect(r.failed_at).toBe(T(11));
  });

  it("sent + failed sem delivered: sent mais recente que failed → sent", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "failed", event_at: T(10), error_code: "500" }),
        EV({ event_status: "sent", event_at: T(11) }),
      ],
      EMPTY,
    );
    expect(r.status).toBe("sent");
    expect(r.failed_at).toBeNull();
    expect(r.last_error_code).toBeNull();
  });

  it("preserva o menor timestamp de cada estágio", () => {
    const r = reduceProviderStatusEvents(
      [
        EV({ event_status: "delivered", event_at: T(13) }),
        EV({ event_status: "delivered", event_at: T(11) }),
        EV({ event_status: "delivered", event_at: T(12) }),
      ],
      EMPTY,
    );
    expect(r.delivered_at).toBe(T(11));
  });

  it("nunca rebaixa timestamps do current", () => {
    const cur: CurrentNotification = {
      status: "sent",
      sent_at: T(9),
      delivered_at: T(10),
      read_at: T(11),
      failed_at: null,
      last_error_code: null,
    };
    const r = reduceProviderStatusEvents(
      [EV({ event_status: "sent", event_at: T(20) })],
      cur,
    );
    expect(r.sent_at).toBe(T(9));
    expect(r.delivered_at).toBe(T(10));
    expect(r.read_at).toBe(T(11));
  });

  it("current com delivered + novo failed → segue sent", () => {
    const cur: CurrentNotification = {
      status: "sent",
      sent_at: T(9),
      delivered_at: T(10),
      read_at: null,
      failed_at: null,
      last_error_code: null,
    };
    const r = reduceProviderStatusEvents(
      [EV({ event_status: "failed", event_at: T(11), error_code: "500" })],
      cur,
    );
    expect(r.status).toBe("sent");
    expect(r.failed_at).toBeNull();
  });

  it("sem eventos e sem estado prévio → status null", () => {
    const r = reduceProviderStatusEvents([], EMPTY);
    expect(r.status).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase para persist/apply/reconcile

function fakeClient(initial: {
  notifs?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
}) {
  const notifs = initial.notifs ?? [];
  const events = initial.events ?? [];
  const client: SupabaseLike = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any {
      const rows =
        table === "whatsapp_notifications"
          ? notifs
          : table === "whatsapp_notification_status_events"
          ? events
          : [];
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        _pendingInsert: null as Record<string, unknown> | null,
        _pendingUpdate: null as Record<string, unknown> | null,
        select() {
          return q;
        },
        insert(row: Record<string, unknown>) {
          q._pendingInsert = row;
          return q;
        },
        update(patch: Record<string, unknown>) {
          q._pendingUpdate = patch;
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return q;
        },
        in(col: string, vals: unknown[]) {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        is(col: string, val: unknown) {
          filters.push((r) =>
            val === null ? r[col] == null : r[col] === val,
          );
          return q;
        },
        maybeSingle() {
          const found = rows.find((r) => filters.every((f) => f(r)));
          if (q._pendingInsert) {
            // Unique event_key
            if (
              table === "whatsapp_notification_status_events" &&
              events.some((e) => e.event_key === q._pendingInsert!.event_key)
            ) {
              return Promise.resolve({
                data: null,
                error: { code: "23505", message: "duplicate key event_key_uniq" },
              });
            }
            const inserted = { id: `id-${rows.length + 1}`, ...q._pendingInsert };
            rows.push(inserted);
            return Promise.resolve({ data: inserted, error: null });
          }
          return Promise.resolve({ data: found ?? null, error: null });
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          // Terminates chain for update() without maybeSingle
          if (q._pendingUpdate) {
            for (const r of rows) {
              if (filters.every((f) => f(r))) Object.assign(r, q._pendingUpdate);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: matched, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { client, notifs, events };
}

describe("persistAndApplyEvents", () => {
  it("insere evento novo, deduplica repetido e aplica ao notification", async () => {
    const { client, notifs, events } = fakeClient({
      notifs: [
        {
          id: "n1",
          provider_message_id: "wamid.a",
          status: "processing",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
          claim_token: "tok",
          claimed_at: T(9),
          lease_expires_at: T(19),
        },
      ],
    });

    const parsed = parseStatusesFromChangeValue({
      statuses: [
        { id: "wamid.a", status: "sent", timestamp: "1752316200" },
        { id: "wamid.a", status: "delivered", timestamp: "1752316260" },
      ],
    });
    const s1 = await persistAndApplyEvents(parsed.events, client);
    expect(s1.inserted).toBe(2);
    expect(s1.duplicates).toBe(0);
    expect(s1.matched).toBe(2);
    expect(s1.state_changed).toBe(1);

    // Replay do mesmo lote — 100% duplicatas, sem mudança de estado nova.
    const s2 = await persistAndApplyEvents(parsed.events, client);
    expect(s2.duplicates).toBe(2);
    expect(s2.inserted).toBe(0);

    const n = notifs.find((r) => r.id === "n1")!;
    expect(n.status).toBe("sent");
    expect(n.delivered_at).toBeTruthy();
    expect(n.claim_token).toBeNull();
    expect(n.lease_expires_at).toBeNull();
    expect(events.length).toBe(2);
  });

  it("unmatched: registra evento sem notification_id e não promove", async () => {
    const { client, notifs, events } = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.zz", status: "delivered", timestamp: "1752316200" }],
    });
    const s = await persistAndApplyEvents(parsed.events, client);
    expect(s.unmatched).toBe(1);
    expect(s.inserted).toBe(1);
    expect(notifs).toHaveLength(0);
    expect(events[0].notification_id).toBeNull();
  });

  it("terminal_state (cancelled) não reabre", async () => {
    const { client, notifs } = fakeClient({
      notifs: [
        {
          id: "n2",
          provider_message_id: "wamid.c",
          status: "cancelled",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
        },
      ],
    });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.c", status: "delivered", timestamp: "1752316200" }],
    });
    const s = await persistAndApplyEvents(parsed.events, client);
    expect(s.anomalies).toBe(1);
    expect(s.state_changed).toBe(0);
    expect(notifs[0].status).toBe("cancelled");
  });

  it("pending: preenche timestamps mas não promove status", async () => {
    const { client, notifs } = fakeClient({
      notifs: [
        {
          id: "n3",
          provider_message_id: "wamid.p",
          status: "pending",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
        },
      ],
    });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.p", status: "sent", timestamp: "1752316200" }],
    });
    await persistAndApplyEvents(parsed.events, client);
    expect(notifs[0].status).toBe("pending");
    expect(notifs[0].sent_at).toBeTruthy();
  });
});

describe("applyProviderStatusAggregate — regras finas", () => {
  it("limpa lease/claim ao promover processing → sent", async () => {
    const { client, notifs } = fakeClient({
      notifs: [
        {
          id: "n1",
          provider_message_id: "wamid.a",
          status: "processing",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
          claim_token: "tok",
          claimed_at: T(9),
          lease_expires_at: T(19),
        },
      ],
    });
    const r = await applyProviderStatusAggregate(
      "wamid.a",
      [EV({ event_status: "delivered", event_at: T(11) })],
      client,
    );
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(notifs[0].claim_token).toBeNull();
    expect(notifs[0].status).toBe("sent");
  });

  it("skipped não reabre", async () => {
    const { client, notifs } = fakeClient({
      notifs: [
        {
          id: "n1",
          provider_message_id: "wamid.a",
          status: "skipped",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
        },
      ],
    });
    const r = await applyProviderStatusAggregate(
      "wamid.a",
      [EV({ event_status: "delivered", event_at: T(11) })],
      client,
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("terminal_state");
    expect(notifs[0].status).toBe("skipped");
  });
});

describe("reconcileStatusEvents", () => {
  it("associa eventos unmatched anteriores ao aparecer a notificação", async () => {
    const { client, notifs, events } = fakeClient({
      notifs: [
        {
          id: "n1",
          provider_message_id: "wamid.z",
          status: "processing",
          sent_at: null,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          last_error_code: null,
          claim_token: "tok",
          claimed_at: T(9),
          lease_expires_at: T(19),
        },
      ],
      events: [
        {
          id: "e1",
          notification_id: null,
          provider_message_id: "wamid.z",
          event_status: "sent",
          event_at: T(10),
          error_code: null,
          event_key: "k1",
        },
        {
          id: "e2",
          notification_id: null,
          provider_message_id: "wamid.z",
          event_status: "delivered",
          event_at: T(11),
          error_code: null,
          event_key: "k2",
        },
      ],
    });
    const r = await reconcileStatusEvents("wamid.z", client);
    expect(r.associated).toBe(2);
    expect(events.every((e) => e.notification_id === "n1")).toBe(true);
    expect(notifs[0].status).toBe("sent");
    expect(notifs[0].delivered_at).toBe(T(11));
    expect(notifs[0].claim_token).toBeNull();
  });
});
