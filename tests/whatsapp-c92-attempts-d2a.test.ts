/**
 * WA-C9.2 Fase D.2A — Testes unitários dos wrappers de attempts (RPC),
 * parser de `biz_opaque_callback_data`, persistência de `client_reference`,
 * reconciliação callback→attempt e recovery consciente.
 *
 * Foco em lógica pura: todas as RPCs são mockadas. NENHUM fetch, NENHUM
 * transport, NENHUMA Graph API, NENHUMA notification real.
 */

import { describe, it, expect } from "vitest";

import {
  finalizeAttemptAccepted,
  finalizeAttemptRejected,
  finalizeAttemptAmbiguous,
  reconcileAttemptFromCallback,
  recoverNotificationWithAttempt,
} from "@/server/whatsapp-notification-attempts.server";

import {
  parseStatusesFromChangeValue,
  persistAndApplyEvents,
  createLegacyNoopAttemptReconciler,
  type AttemptReconciler,
  type SupabaseLike,
} from "@/server/whatsapp-meta-status-callbacks.server";

import { recoverStuckProcessing } from "@/server/whatsapp-notifications.server";

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

type RpcCall = { fn: string; args: Record<string, unknown> };

function mkRpcClient(program: Array<{ data: unknown; error: unknown }>) {
  const calls: RpcCall[] = [];
  let i = 0;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const r = program[i] ?? { data: null, error: { message: "no program" } };
    i++;
    return r;
  };
  return {
    calls,
    // matches shape { from, rpc } used by wrappers
    client: { from: () => ({}), rpc } as unknown as SupabaseLike,
  };
}

function rpcRow(outcome: string, extra: Record<string, unknown> = {}) {
  return { data: [{ outcome, ...extra }], error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) finalizeAttemptAccepted

describe("D.2A :: finalizeAttemptAccepted", () => {
  it("entrada válida retorna accepted", async () => {
    const rc = mkRpcClient([rpcRow("accepted")]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.1", httpStatus: 200 },
      rc.client,
    );
    expect(r).toEqual({ ok: true, outcome: "accepted" });
    expect(rc.calls[0].fn).toBe("whatsapp_attempt_finalize_accepted_atomic");
    expect(rc.calls[0].args.p_provider_message_id).toBe("wamid.1");
    expect(rc.calls[0].args.p_http_status).toBe(200);
  });

  it("rejeita UUID inválido de attemptId", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: "not-uuid", attemptToken: UUID_B, providerMessageId: "wamid.x", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_input");
    expect(rc.calls.length).toBe(0);
  });

  it("rejeita attemptToken inválido", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: "bad", providerMessageId: "wamid.x", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("rejeita PMID vazio", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("rejeita PMID com caractere de controle", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "abc\u0001", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("rejeita PMID acima do limite", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "a".repeat(257), httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("rejeita HTTP não 2xx", async () => {
    const rc = mkRpcClient([]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.x", httpStatus: 400 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("mapeia accepted_idempotent, conflict_pmid, conflict_state, state_changed, not_found, notification_missing", async () => {
    for (const outcome of [
      "accepted_idempotent",
      "conflict_pmid",
      "conflict_state",
      "state_changed",
      "not_found",
      "notification_missing",
    ]) {
      const rc = mkRpcClient([rpcRow(outcome)]);
      const r = await finalizeAttemptAccepted(
        { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.x", httpStatus: 200 },
        rc.client,
      );
      expect(r).toEqual({ ok: true, outcome });
    }
  });

  it("outcome desconhecido → fail-closed", async () => {
    const rc = mkRpcClient([rpcRow("mystery_outcome")]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.x", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_outcome");
  });

  it("erro do banco → database_error", async () => {
    const rc = mkRpcClient([{ data: null, error: { code: "42P01" } }]);
    const r = await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.x", httpStatus: 200 },
      rc.client,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("database_error");
  });

  it("chama RPC exatamente uma vez (zero retry, zero UPDATE paralelo)", async () => {
    const rc = mkRpcClient([rpcRow("accepted")]);
    await finalizeAttemptAccepted(
      { attemptId: UUID_A, attemptToken: UUID_B, providerMessageId: "wamid.1", httpStatus: 200 },
      rc.client,
    );
    expect(rc.calls.length).toBe(1);
    expect(rc.calls[0].fn).toBe("whatsapp_attempt_finalize_accepted_atomic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) finalizeAttemptRejected

describe("D.2A :: finalizeAttemptRejected", () => {
  it("entrada válida retorna rejected e não persiste body/headers/stack", async () => {
    const rc = mkRpcClient([rpcRow("rejected")]);
    const r = await finalizeAttemptRejected(
      {
        attemptId: UUID_A,
        attemptToken: UUID_B,
        httpStatus: 400,
        errorCode: "bad_request",
        errorCategory: "permanent",
        retryable: false,
      },
      rc.client,
    );
    expect(r).toEqual({ ok: true, outcome: "rejected" });
    const args = rc.calls[0].args;
    expect(args.p_http_status).toBe(400);
    expect(args.p_retryable).toBe(false);
    // Nenhuma chave de body/headers/stack presente:
    for (const k of Object.keys(args)) {
      expect(k).not.toMatch(/body|headers|stack|raw/i);
    }
  });

  it("sanitiza error_code e error_category", async () => {
    const rc = mkRpcClient([rpcRow("rejected")]);
    await finalizeAttemptRejected(
      {
        attemptId: UUID_A,
        attemptToken: UUID_B,
        httpStatus: 400,
        errorCode: "bad\u0001code",
        errorCategory: "cat\u0002x",
        retryable: false,
      },
      rc.client,
    );
    expect(rc.calls[0].args.p_error_code).toBe("badcode");
    expect(rc.calls[0].args.p_error_category).toBe("catx");
  });

  it("retryable true registrado mas SEM retry TypeScript", async () => {
    const rc = mkRpcClient([rpcRow("rejected")]);
    await finalizeAttemptRejected(
      {
        attemptId: UUID_A,
        attemptToken: UUID_B,
        httpStatus: 500,
        errorCode: "server_err",
        errorCategory: "retryable",
        retryable: true,
      },
      rc.client,
    );
    expect(rc.calls.length).toBe(1); // não repete
    expect(rc.calls[0].args.p_retryable).toBe(true);
  });

  it("mapeia idempotência, conflict, state_changed, not_found; unknown fail-closed", async () => {
    for (const outcome of ["rejected_idempotent", "state_changed", "not_found"]) {
      const rc = mkRpcClient([rpcRow(outcome)]);
      const r = await finalizeAttemptRejected(
        {
          attemptId: UUID_A,
          attemptToken: UUID_B,
          httpStatus: 400,
          errorCode: "e",
          errorCategory: "permanent",
          retryable: false,
        },
        rc.client,
      );
      expect(r).toEqual({ ok: true, outcome });
    }
    const rc2 = mkRpcClient([rpcRow("ufo")]);
    const r2 = await finalizeAttemptRejected(
      {
        attemptId: UUID_A,
        attemptToken: UUID_B,
        httpStatus: 400,
        errorCode: "e",
        errorCategory: "permanent",
        retryable: false,
      },
      rc2.client,
    );
    expect(r2.ok).toBe(false);
  });

  it("rejeita retryable não booleano e attemptId inválido", async () => {
    const rc = mkRpcClient([]);
    const r1 = await finalizeAttemptRejected(
      {
        attemptId: UUID_A,
        attemptToken: UUID_B,
        httpStatus: 400,
        errorCode: "e",
        errorCategory: "c",
        retryable: "yes" as unknown as boolean,
      },
      rc.client,
    );
    expect(r1.ok).toBe(false);
    const r2 = await finalizeAttemptRejected(
      { attemptId: "bad", attemptToken: UUID_B, httpStatus: 400, errorCode: "e", errorCategory: "c", retryable: false },
      rc.client,
    );
    expect(r2.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) finalizeAttemptAmbiguous

describe("D.2A :: finalizeAttemptAmbiguous", () => {
  it("entrada válida retorna ambiguous; sem retornar para pending", async () => {
    const rc = mkRpcClient([rpcRow("ambiguous")]);
    const r = await finalizeAttemptAmbiguous(
      { attemptId: UUID_A, attemptToken: UUID_B, errorCode: "send_ambiguous" },
      rc.client,
    );
    expect(r).toEqual({ ok: true, outcome: "ambiguous" });
    expect(rc.calls[0].fn).toBe("whatsapp_attempt_finalize_ambiguous_atomic");
    // p_error_code sanitizado com default seguro
    expect(rc.calls[0].args.p_error_code).toBe("send_ambiguous");
  });

  it("HTTP opcional preenchido com 0 default", async () => {
    const rc = mkRpcClient([rpcRow("ambiguous")]);
    await finalizeAttemptAmbiguous(
      { attemptId: UUID_A, attemptToken: UUID_B, errorCode: "ambig" },
      rc.client,
    );
    expect(rc.calls[0].args.p_http_status).toBe(0);
  });

  it("mapeia idempotência/state_changed/not_found; unknown fail-closed", async () => {
    for (const outcome of ["ambiguous_idempotent", "state_changed", "not_found"]) {
      const rc = mkRpcClient([rpcRow(outcome)]);
      const r = await finalizeAttemptAmbiguous(
        { attemptId: UUID_A, attemptToken: UUID_B, errorCode: "e" },
        rc.client,
      );
      expect(r).toEqual({ ok: true, outcome });
    }
    const rc2 = mkRpcClient([rpcRow("weird")]);
    const r = await finalizeAttemptAmbiguous(
      { attemptId: UUID_A, attemptToken: UUID_B, errorCode: "e" },
      rc2.client,
    );
    expect(r.ok).toBe(false);
  });

  it("uma única chamada RPC; nenhum retry", async () => {
    const rc = mkRpcClient([rpcRow("ambiguous")]);
    await finalizeAttemptAmbiguous(
      { attemptId: UUID_A, attemptToken: UUID_B, errorCode: "e" },
      rc.client,
    );
    expect(rc.calls.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) reconcileAttemptFromCallback

describe("D.2A :: reconcileAttemptFromCallback", () => {
  it("reconciliação por PMID (client_reference vazio)", async () => {
    const rc = mkRpcClient([rpcRow("reconciled", { attempt_id: UUID_A, notification_id: UUID_B })]);
    const r = await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.p", eventStatus: "delivered", clientReference: null },
      rc.client,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("reconciled");
      expect(r.attemptId).toBe(UUID_A);
      expect(r.notificationId).toBe(UUID_B);
    }
    expect(rc.calls[0].args.p_client_reference).toBe("");
    expect(rc.calls[0].args.p_provider_message_id).toBe("wamid.p");
    expect(rc.calls[0].args.p_event_status).toBe("delivered");
  });

  it("cliente_reference válido é encaminhado", async () => {
    const rc = mkRpcClient([rpcRow("reconciled")]);
    await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.p", eventStatus: "sent", clientReference: "abc-123" },
      rc.client,
    );
    expect(rc.calls[0].args.p_client_reference).toBe("abc-123");
  });

  it("client_reference inválido vira string vazia (rejeição silenciosa)", async () => {
    const rc = mkRpcClient([rpcRow("unmatched")]);
    await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.p", eventStatus: "read", clientReference: "bad\u0001" },
      rc.client,
    );
    expect(rc.calls[0].args.p_client_reference).toBe("");
  });

  it("mapeia unmatched, conflict_pmid, conflict_state, notification_missing", async () => {
    for (const outcome of ["unmatched", "conflict_pmid", "conflict_state", "notification_missing"]) {
      const rc = mkRpcClient([rpcRow(outcome)]);
      const r = await reconcileAttemptFromCallback(
        { providerMessageId: "wamid.x", eventStatus: "failed" },
        rc.client,
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.outcome).toBe(outcome);
    }
  });

  it("event_status inválido → invalid_input", async () => {
    const rc = mkRpcClient([]);
    const r = await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.x", eventStatus: "queued" as unknown as "sent" },
      rc.client,
    );
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });

  it("erro DB → database_error; outcome desconhecido → fail-closed", async () => {
    const rc = mkRpcClient([{ data: null, error: { message: "boom" } }]);
    const r1 = await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.x", eventStatus: "sent" },
      rc.client,
    );
    expect(r1.ok).toBe(false);
    const rc2 = mkRpcClient([rpcRow("nope")]);
    const r2 = await reconcileAttemptFromCallback(
      { providerMessageId: "wamid.x", eventStatus: "sent" },
      rc2.client,
    );
    expect(r2.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) recoverNotificationWithAttempt

describe("D.2A :: recoverNotificationWithAttempt", () => {
  it("delega à RPC com backoff default 00:05:00", async () => {
    const rc = mkRpcClient([rpcRow("recovered_without_attempt")]);
    const r = await recoverNotificationWithAttempt(
      { notificationId: UUID_A },
      rc.client,
    );
    expect(r).toEqual({ ok: true, outcome: "recovered_without_attempt" });
    expect(rc.calls[0].fn).toBe("whatsapp_notification_recover_with_attempt_atomic");
    expect(rc.calls[0].args.p_notification_id).toBe(UUID_A);
    expect(rc.calls[0].args.p_backoff).toBe("00:05:00");
  });

  it("mapeia todos os outcomes válidos e falha-fecha desconhecido", async () => {
    const known = [
      "not_found",
      "noop",
      "lease_valid",
      "recovered_without_attempt",
      "planned_cancelled",
      "sending_ambiguous",
      "ambiguous_quarantined",
      "accepted_repaired",
      "rejected_preserved",
      "cancelled_repending",
    ];
    for (const outcome of known) {
      const rc = mkRpcClient([rpcRow(outcome)]);
      const r = await recoverNotificationWithAttempt({ notificationId: UUID_A }, rc.client);
      expect(r).toEqual({ ok: true, outcome });
    }
    const rc = mkRpcClient([rpcRow("alien_state")]);
    const r = await recoverNotificationWithAttempt({ notificationId: UUID_A }, rc.client);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_outcome");
  });

  it("erro do banco → database_error; jamais cria attempt ou fetch", async () => {
    const rc = mkRpcClient([{ data: null, error: { code: "40001" } }]);
    const r = await recoverNotificationWithAttempt({ notificationId: UUID_A }, rc.client);
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(1); // apenas a RPC de recovery, nada mais
  });

  it("UUID inválido bloqueia sem chamar RPC", async () => {
    const rc = mkRpcClient([]);
    const r = await recoverNotificationWithAttempt({ notificationId: "bad" }, rc.client);
    expect(r.ok).toBe(false);
    expect(rc.calls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) Parser de biz_opaque_callback_data + client_reference

describe("D.2A :: parser biz_opaque_callback_data", () => {
  const base = (biz?: unknown) => ({
    metadata: { phone_number_id: "9999" },
    statuses: [
      {
        id: "wamid.z",
        status: "sent",
        timestamp: "1752316200",
        ...(biz !== undefined ? { biz_opaque_callback_data: biz } : {}),
      },
    ],
  });

  it("string válida → client_reference presente", () => {
    const out = parseStatusesFromChangeValue(base("cref-xyz-1"));
    expect(out.events.length).toBe(1);
    expect(out.events[0].client_reference).toBe("cref-xyz-1");
  });

  it("ausência → null", () => {
    const out = parseStatusesFromChangeValue(base());
    expect(out.events[0].client_reference).toBe(null);
  });

  it("string vazia → null", () => {
    const out = parseStatusesFromChangeValue(base(""));
    expect(out.events[0].client_reference).toBe(null);
  });

  it("caractere de controle → null (nenhum trim permissivo)", () => {
    const out = parseStatusesFromChangeValue(base("abc\u0001def"));
    expect(out.events[0].client_reference).toBe(null);
  });

  it("tamanho > 256 → null", () => {
    const out = parseStatusesFromChangeValue(base("x".repeat(257)));
    expect(out.events[0].client_reference).toBe(null);
  });

  it("objeto/array/número/boolean → null", () => {
    for (const bad of [{ x: 1 }, [1, 2], 123, true, false]) {
      const out = parseStatusesFromChangeValue(base(bad));
      expect(out.events[0].client_reference).toBe(null);
    }
  });

  it("client_reference não altera event_key (mesma PMID+status+at+error_code produz mesma key)", () => {
    const withRef = parseStatusesFromChangeValue(base("cref-1"));
    const withoutRef = parseStatusesFromChangeValue(base());
    expect(withRef.events[0].event_key).toBe(withoutRef.events[0].event_key);
  });

  it("lote inteiro processado mesmo com referência inválida", () => {
    const out = parseStatusesFromChangeValue({
      metadata: { phone_number_id: "9999" },
      statuses: [
        { id: "wamid.a", status: "sent", timestamp: "1752316200", biz_opaque_callback_data: { bad: 1 } },
        { id: "wamid.b", status: "delivered", timestamp: "1752316260", biz_opaque_callback_data: "ok" },
      ],
    });
    expect(out.events.length).toBe(2);
    expect(out.events[0].client_reference).toBe(null);
    expect(out.events[1].client_reference).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7) persistAndApplyEvents — persistência de client_reference + reconciliação

describe("D.2A :: persistAndApplyEvents wiring", () => {
  function fakeClient(initial: {
    notifs?: Array<Record<string, unknown>>;
  }) {
    const notifs = initial.notifs ?? [];
    const events: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      from(table: string): unknown {
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
    return { client, events, notifs };
  }

  const T = (h: number) =>
    new Date(Date.UTC(2026, 6, 12, h, 0, 0)).toISOString();

  function makeReconciler(program: Array<{ ok: boolean; outcome: string | null }>) {
    const calls: Array<{ providerMessageId: string; clientReference: string | null; eventStatus: string }> = [];
    let i = 0;
    const rec: AttemptReconciler = {
      async reconcile(input) {
        calls.push({
          providerMessageId: input.providerMessageId,
          clientReference: input.clientReference,
          eventStatus: input.eventStatus,
        });
        return program[i++] ?? { ok: true, outcome: "unmatched" };
      },
    };
    return { rec, calls };
  }

  it("persiste client_reference no INSERT do status event", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.a", status: "sent", timestamp: "1752316200", biz_opaque_callback_data: "ref-1" }],
    });
    const { rec, calls } = makeReconciler([{ ok: true, outcome: "reconciled" }]);
    const s = await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(s.inserted).toBe(1);
    expect(fc.events[0].client_reference).toBe("ref-1");
    expect(s.callback_attempts_reconciled).toBe(1);
    expect(calls[0].providerMessageId).toBe("wamid.a");
    expect(calls[0].clientReference).toBe("ref-1");
  });

  it("referência inválida persiste como null e reconcile é invocado com null", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.b", status: "sent", timestamp: "1752316200", biz_opaque_callback_data: { bad: 1 } }],
    });
    const { rec, calls } = makeReconciler([{ ok: true, outcome: "unmatched" }]);
    const s = await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(fc.events[0].client_reference).toBe(null);
    expect(calls[0].clientReference).toBe(null);
    expect(s.callback_attempts_unmatched).toBe(1);
  });

  it("callback duplicado (event_key existente) mantém idempotência e reconciliação self-heal roda", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.d", status: "sent", timestamp: "1752316200" }],
    });
    const { rec } = makeReconciler([{ ok: true, outcome: "reconciled" }]);
    await persistAndApplyEvents(parsed.events, fc.client, rec);
    // Replay
    const { rec: rec2 } = makeReconciler([{ ok: true, outcome: "reconciled" }]);
    const s2 = await persistAndApplyEvents(parsed.events, fc.client, rec2);
    expect(s2.duplicates).toBe(1);
    expect(s2.inserted).toBe(0);
    // reconciler roda uma vez por PMID mesmo em duplicata
    expect(s2.callback_attempts_reconciled).toBe(1);
  });

  it("falha da RPC de reconcile marca requiresWebhookRetry sem derrubar lote", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.e", status: "sent", timestamp: "1752316200" }],
    });
    const rec: AttemptReconciler = {
      async reconcile() {
        return { ok: false, outcome: null, reason: "database_error" };
      },
    };
    const s = await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(s.inserted).toBe(1);
    expect(s.requiresWebhookRetry).toBe(true);
    expect(s.retryableErrors).toBeGreaterThanOrEqual(1);
  });

  it("callback failed é encaminhado ao reconciler com event_status='failed'", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.f", status: "failed", timestamp: "1752316200", errors: [{ code: 131047 }] }],
    });
    const { rec, calls } = makeReconciler([{ ok: true, outcome: "reconciled" }]);
    const s = await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(s.inserted).toBe(1);
    expect(calls[0].eventStatus).toBe("failed");
  });

  it("PMID diferente → conflict_pmid é contabilizado como conflict", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [{ id: "wamid.g", status: "sent", timestamp: "1752316200", biz_opaque_callback_data: "ref-g" }],
    });
    const { rec } = makeReconciler([{ ok: true, outcome: "conflict_pmid" }]);
    const s = await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(s.callback_attempts_conflict).toBe(1);
  });

  it("uma única chamada de reconcile por PMID mesmo com múltiplos eventos do mesmo PMID", async () => {
    const fc = fakeClient({ notifs: [] });
    const parsed = parseStatusesFromChangeValue({
      statuses: [
        { id: "wamid.m", status: "sent", timestamp: "1752316200" },
        { id: "wamid.m", status: "delivered", timestamp: "1752316260" },
        { id: "wamid.m", status: "read", timestamp: "1752316320" },
      ],
    });
    const { rec, calls } = makeReconciler([{ ok: true, outcome: "reconciled" }]);
    await persistAndApplyEvents(parsed.events, fc.client, rec);
    expect(calls.length).toBe(1);
    // Representative deve ser o de maior prioridade (sent)
    expect(calls[0].eventStatus).toBe("sent");
  });
});
