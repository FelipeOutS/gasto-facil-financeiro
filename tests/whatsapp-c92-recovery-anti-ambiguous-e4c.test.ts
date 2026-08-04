/**
 * WA-C9.2 Fase E.4C — Guarda anti-retry para attempts ambiguous.
 *
 * Testa o wrapper `recoverNotificationWithAttempt` contra um fake que
 * simula o novo contrato da RPC (retorno 'ambiguous_skipped' sem UPDATE).
 * Também verifica que o wrapper aceita 'ambiguous_quarantined' legado
 * para retrocompatibilidade.
 *
 * Zero rede. Zero Supabase real. Zero envio Meta.
 */
import { describe, it, expect } from "bun:test";
import {
  recoverNotificationWithAttempt,
  type RecoverOutcome,
} from "../src/server/whatsapp-notification-attempts.server";

function fakeClient(outcome: string) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: [{ outcome }], error: null };
    },
  };
  return client;
}

const NOTIF_ID = "11111111-2222-3333-4444-555555555555";

describe("recovery guard anti-ambiguous (E.4C)", () => {
  it("ambiguous_skipped é outcome válido e propagado", async () => {
    const fake = fakeClient("ambiguous_skipped");
    const r = await recoverNotificationWithAttempt({ notificationId: NOTIF_ID }, fake as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outcome).toBe("ambiguous_skipped" as RecoverOutcome);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].fn).toBe("whatsapp_notification_recover_with_attempt_atomic");
  });

  it("ambiguous_quarantined legado ainda aceito (retrocompat)", async () => {
    const fake = fakeClient("ambiguous_quarantined");
    const r = await recoverNotificationWithAttempt({ notificationId: NOTIF_ID }, fake as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outcome).toBe("ambiguous_quarantined" as RecoverOutcome);
  });

  it("outcome desconhecido é fail-closed (unknown_outcome)", async () => {
    const fake = fakeClient("something_new");
    const r = await recoverNotificationWithAttempt({ notificationId: NOTIF_ID }, fake as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_outcome");
  });

  it("invalid notificationId nunca chama RPC", async () => {
    const fake = fakeClient("noop");
    const r = await recoverNotificationWithAttempt({ notificationId: "not-a-uuid" }, fake as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_input");
    expect(fake.calls).toHaveLength(0);
  });

  it("outcomes de terminação (rejected/accepted) inalterados no contrato", async () => {
    for (const o of ["rejected_preserved", "accepted_repaired", "recovered_without_attempt"]) {
      const fake = fakeClient(o);
      const r = await recoverNotificationWithAttempt({ notificationId: NOTIF_ID }, fake as never);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.outcome).toBe(o as RecoverOutcome);
    }
  });

  it("wrapper serializa notificationId sem PII e sem stack", async () => {
    const fake = fakeClient("ambiguous_skipped");
    await recoverNotificationWithAttempt({ notificationId: NOTIF_ID }, fake as never);
    // Somente args esperados: p_notification_id, p_now, p_backoff
    const args = fake.calls[0].args;
    expect(Object.keys(args).sort()).toEqual(["p_backoff", "p_notification_id", "p_now"]);
    expect(args.p_notification_id).toBe(NOTIF_ID);
    expect(typeof args.p_backoff).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guarda semântica: outcomesRepairedOrRequeued NÃO inclui ambiguous_*.
// Verifica que o pipeline superior classifica corretamente.
import { recoverStuckProcessing } from "../src/server/whatsapp-notifications.server";

function buildRecoverySupabase(outcomesByRow: Record<string, string>) {
  const rows = Object.keys(outcomesByRow).map((id) => ({
    id,
    claim_token: "tok-" + id,
    status: "processing",
    lease_expires_at: "1999-01-01T00:00:00Z",
  }));
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const client = {
    calls,
    from(_t: string) {
      let filtered = rows.slice();
      const api = {
        select() {
          return api;
        },
        eq(k: string, v: unknown) {
          filtered = filtered.filter((r: Record<string, unknown>) => r[k] === v);
          return api;
        },
        lte(_k: string, _v: unknown) {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        async then(res: (v: unknown) => unknown) {
          // Emula PostgREST: quando não chamamos update, retorna data
          return res({ data: filtered, error: null });
        },
      };
      return api;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", payload: { fn, args } });
      const id = args.p_notification_id as string;
      return { data: [{ outcome: outcomesByRow[id] ?? "noop" }], error: null };
    },
  };
  return client;
}

describe("recoverStuckProcessing classificação E.4C", () => {
  it("ambiguous_skipped conta como state_changed (não requeued)", async () => {
    const fake = buildRecoverySupabase({
      "aaaaaaaa-1111-1111-1111-111111111111": "ambiguous_skipped",
    });
    const s = await recoverStuckProcessing(50, {
      client: fake as never,
      now: () => new Date("2026-07-17T00:00:00Z"),
    });
    expect(s.recovered).toBe(0);
    expect(s.state_changed).toBe(1);
    expect(s.errors).toBe(0);
  });

  it("recovered_without_attempt continua como recovered", async () => {
    const fake = buildRecoverySupabase({
      "bbbbbbbb-2222-2222-2222-222222222222": "recovered_without_attempt",
    });
    const s = await recoverStuckProcessing(50, {
      client: fake as never,
      now: () => new Date("2026-07-17T00:00:00Z"),
    });
    expect(s.recovered).toBe(1);
    expect(s.state_changed).toBe(0);
  });

  it("ambiguous_quarantined legado conta como state_changed também", async () => {
    const fake = buildRecoverySupabase({
      "cccccccc-3333-3333-3333-333333333333": "ambiguous_quarantined",
    });
    const s = await recoverStuckProcessing(50, {
      client: fake as never,
      now: () => new Date("2026-07-17T00:00:00Z"),
    });
    expect(s.recovered).toBe(0);
    expect(s.state_changed).toBe(1);
  });
});
