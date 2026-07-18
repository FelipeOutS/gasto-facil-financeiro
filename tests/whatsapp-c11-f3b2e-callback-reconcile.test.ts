/**
 * WA-C11 Fase 3B.2.E — Reconciliador de quota outbound por callback Meta.
 */
import { describe, it, expect, vi } from "vitest";
import { reconcileOutboundQuotaFromMetaStatus } from "@/server/whatsapp-callback-quota-reconcile.server";

const baseIds = {
  userId: "00000000-0000-0000-0000-000000000001",
  notificationId: "00000000-0000-0000-0000-000000000abc",
};

describe("WA-C11 3B.2.E — reconciler: correlação e PMID", () => {
  it("sem PMID: retorna no_correlation e não chama RPC", async () => {
    const reconcile = vi.fn();
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: null, status: "sent" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("no_correlation");
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("sem userId/notificationId: no_correlation", async () => {
    const reconcile = vi.fn();
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { userId: "", notificationId: "", providerMessageId: "wamid.x", status: "sent" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("no_correlation");
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("WA-C11 3B.2.E — reconciler: aceite promove commit", () => {
  for (const status of ["sent", "delivered", "read"] as const) {
    it(`status=${status} + reconciled → kind=reconciled`, async () => {
      const reconcile = vi.fn().mockResolvedValue({ outcome: "reconciled", state: "committed" });
      const r = await reconcileOutboundQuotaFromMetaStatus(
        { ...baseIds, providerMessageId: "wamid.abc", status },
        { reconcile: reconcile as never },
      );
      expect(r.kind).toBe("reconciled");
      expect(reconcile).toHaveBeenCalledOnce();
    });

    it(`status=${status} + noop/committed → already_committed`, async () => {
      const reconcile = vi.fn().mockResolvedValue({ outcome: "noop", state: "committed" });
      const r = await reconcileOutboundQuotaFromMetaStatus(
        { ...baseIds, providerMessageId: "wamid.abc", status },
        { reconcile: reconcile as never },
      );
      expect(r.kind).toBe("already_committed");
    });
  }

  it("conflict_pmid → error", async () => {
    const reconcile = vi.fn().mockResolvedValue({ outcome: "conflict_pmid", state: null });
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "sent" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("error");
  });

  it("not_found → not_applicable(reservation_missing)", async () => {
    const reconcile = vi.fn().mockResolvedValue({ outcome: "not_found", state: null });
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "delivered" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("not_applicable");
  });

  it("invalid_state (released tardio) → not_applicable, NÃO regressa", async () => {
    const reconcile = vi
      .fn()
      .mockResolvedValue({ outcome: "invalid_state", state: "released" });
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "sent" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("not_applicable");
  });
});

describe("WA-C11 3B.2.E — reconciler: failed pós-aceite NUNCA libera", () => {
  it("failed com PMID + reconciled → failed_post_accept_preserved", async () => {
    const reconcile = vi.fn().mockResolvedValue({ outcome: "reconciled", state: "committed" });
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "failed" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("failed_post_accept_preserved");
  });

  it("failed com PMID + já committed → failed_post_accept_preserved", async () => {
    const reconcile = vi.fn().mockResolvedValue({ outcome: "noop", state: "committed" });
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "failed" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("failed_post_accept_preserved");
  });

  it("failed SEM pmid → no_correlation (release cabe ao dispatcher pré-callback)", async () => {
    const reconcile = vi.fn();
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "", status: "failed" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("no_correlation");
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("WA-C11 3B.2.E — reconciler: status desconhecido", () => {
  it("status arbitrário → not_applicable", async () => {
    const reconcile = vi.fn();
    const r = await reconcileOutboundQuotaFromMetaStatus(
      { ...baseIds, providerMessageId: "wamid.abc", status: "queued" },
      { reconcile: reconcile as never },
    );
    expect(r.kind).toBe("not_applicable");
    expect(reconcile).not.toHaveBeenCalled();
  });
});
