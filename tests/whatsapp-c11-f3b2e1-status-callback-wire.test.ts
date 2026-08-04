/**
 * WA-C11 3B.2.E.1 — Wiring do reconciliador de quota outbound no handler
 * de status callbacks Meta (persistAndApplyEvents).
 *
 * Garante:
 *  - Um PMID correlacionado (notification + user_id) chama exatamente uma
 *    vez `reconcileOutboundQuotaFromMetaStatus` com o status mais
 *    autoritativo do lote.
 *  - PMID sem correlação NÃO invoca o reconciliador.
 *  - Falha do reconciliador NÃO derruba o processamento do lote.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const reconcileMock = vi.fn().mockResolvedValue({ kind: "reconciled" });

vi.mock("@/server/whatsapp-callback-quota-reconcile.server", () => ({
  reconcileOutboundQuotaFromMetaStatus: reconcileMock,
}));

const { persistAndApplyEvents } = await import("@/server/whatsapp-meta-status-callbacks.server");

type FakeClient = {
  from: (t: string) => unknown;
};

function makeClient(rows: Record<string, { id: string; user_id: string } | null>): FakeClient {
  return {
    from(table: string) {
      if (table === "whatsapp_notifications") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: rows[val] ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "whatsapp_notification_status_events") {
        return {
          insert: async () => ({ error: null }),
          update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseEvent = {
  provider_message_id: "wamid.ABC",
  event_status: "sent" as const,
  event_at: "2026-01-01T00:00:00Z",
  error_code: null,
  error_title: null,
  error_message: null,
  error_category: null,
  conversation_id: null,
  raw_status: {},
  client_reference: null,
};

describe("WA-C11 3B.2.E.1 — persistAndApplyEvents invoca reconciliador de quota", () => {
  beforeEach(() => reconcileMock.mockClear());

  it("PMID correlacionado (id+user_id) → reconciler chamado 1x", async () => {
    const client = makeClient({
      "wamid.ABC": { id: "n-1", user_id: "u-1" },
    });
    // Reconciler explícito (evita default fail-closed do lote).
    const rec = { reconcile: async () => ({ ok: true, outcome: "reconciled" as const }) };
    await persistAndApplyEvents([baseEvent], client as never, rec as never);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    const call = reconcileMock.mock.calls[0][0];
    expect(call.userId).toBe("u-1");
    expect(call.notificationId).toBe("n-1");
    expect(call.providerMessageId).toBe("wamid.ABC");
    expect(call.status).toBe("sent");
  });

  it("PMID sem correlação → reconciler NÃO chamado", async () => {
    const client = makeClient({});
    const rec = { reconcile: async () => ({ ok: true, outcome: "unmatched" as const }) };
    await persistAndApplyEvents([baseEvent], client as never, rec as never);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("falha do reconciliador NÃO derruba o lote", async () => {
    reconcileMock.mockRejectedValueOnce(new Error("boom"));
    const client = makeClient({ "wamid.ABC": { id: "n-1", user_id: "u-1" } });
    const rec = { reconcile: async () => ({ ok: true, outcome: "reconciled" as const }) };
    const out = await persistAndApplyEvents([baseEvent], client as never, rec as never);
    expect(out.received).toBe(1);
  });

  it("mais autoritativo do lote (sent > delivered > read > failed) é enviado", async () => {
    const client = makeClient({ "wamid.ABC": { id: "n-1", user_id: "u-1" } });
    const rec = { reconcile: async () => ({ ok: true, outcome: "reconciled" as const }) };
    await persistAndApplyEvents(
      [
        { ...baseEvent, event_status: "failed" },
        { ...baseEvent, event_status: "delivered" },
        { ...baseEvent, event_status: "sent" },
      ],
      client as never,
      rec as never,
    );
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock.mock.calls[0][0].status).toBe("sent");
  });
});
