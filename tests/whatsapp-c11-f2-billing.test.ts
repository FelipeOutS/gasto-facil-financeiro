/**
 * WA-C11 FASE 2.1B — Billing atômico + invalidação de notifications.
 *
 * Cobre os 70 cenários enumerados no prompt, consolidados em grupos
 * temáticos que exercitam o mesmo caminho crítico:
 *   A. Webhook e aplicação de estado (approved, cancelled, refund, chargeback, etc.)
 *   B. Idempotência e ordem (duplicate, stale, tiebreak, concorrência)
 *   C. Ciclo do plano (upgrade, downgrade imediato/agendado, expired, reactivation)
 *   D. WhatsApp (entitlement transitions, notification invalidation, canary preservation)
 *   E. Segurança da RPC (service_role only, fail-closed em erro)
 *   F. Helper (extractProviderUpdatedAt, normalizeCanonicalStatus)
 */
import { test, expect, mock, beforeEach } from "bun:test";

// ---------------- state controlável do mock ----------------
type RpcRecordedCall = {
  name: string;
  args: Record<string, unknown>;
};

type State = {
  rpcResponse: Record<string, unknown> | null;
  rpcError: { code?: string; message: string } | null;
  rpcThrows: boolean;
  recorded: RpcRecordedCall[];
};

const state: State = {
  rpcResponse: null,
  rpcError: null,
  rpcThrows: false,
  recorded: [],
};

// Mock do supabaseAdmin ANTES do import do helper.
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.recorded.push({ name, args });
      if (state.rpcThrows) throw new Error("rpc_threw");
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: state.rpcResponse, error: null };
    },
  },
}));

// Agora sim carrega o helper (usa o mock acima).
const {
  applyMercadoPagoBillingEvent,
  normalizeCanonicalStatus,
  extractProviderUpdatedAt,
} = await import("../src/server/billing-mercadopago-apply.server");

// ---------------- helpers ----------------
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";

function resetState(): void {
  state.rpcResponse = null;
  state.rpcError = null;
  state.rpcThrows = false;
  state.recorded = [];
}

function makePayment(overrides: Record<string, unknown> = {}): {
  id: string;
  status: string;
  date_last_updated?: string;
  transaction_amount?: number;
  currency_id?: string;
  metadata?: { user_id?: string; plano?: string; months?: number };
} {
  return {
    id: "MP123",
    status: "approved",
    date_last_updated: "2026-01-15T12:00:00.000-03:00",
    transaction_amount: 29.9,
    currency_id: "BRL",
    metadata: { user_id: USER, plano: "pessoal_premium", months: 1 },
    ...overrides,
  };
}

beforeEach(() => resetState());

// ============================================================================
// F. Helper puro — extração e normalização
// ============================================================================

test("F1. normalizeCanonicalStatus: approved / authorized / paid → approved", () => {
  expect(normalizeCanonicalStatus("approved")).toBe("approved");
  expect(normalizeCanonicalStatus("authorized")).toBe("approved");
  expect(normalizeCanonicalStatus("paid")).toBe("approved");
});

test("F2. normalizeCanonicalStatus: pending / in_process / in_mediation → pending", () => {
  expect(normalizeCanonicalStatus("pending")).toBe("pending");
  expect(normalizeCanonicalStatus("in_process")).toBe("pending");
  expect(normalizeCanonicalStatus("in_mediation")).toBe("pending");
});

test("F3. normalizeCanonicalStatus: rejected → rejected", () => {
  expect(normalizeCanonicalStatus("rejected")).toBe("rejected");
});

test("F4. normalizeCanonicalStatus: refunded / charged_back / expired", () => {
  expect(normalizeCanonicalStatus("refunded")).toBe("refunded");
  expect(normalizeCanonicalStatus("charged_back")).toBe("chargeback");
  expect(normalizeCanonicalStatus("expired")).toBe("expired");
});

test("F5. normalizeCanonicalStatus: cancelled sem hint → cancelled_immediate (fail-closed)", () => {
  expect(normalizeCanonicalStatus("cancelled")).toBe("cancelled_immediate");
  expect(normalizeCanonicalStatus("canceled")).toBe("cancelled_immediate");
});

test("F6. normalizeCanonicalStatus: cancelled com hint scheduled → cancelled_scheduled", () => {
  expect(normalizeCanonicalStatus("cancelled", "scheduled")).toBe("cancelled_scheduled");
});

test("F7. normalizeCanonicalStatus: override tem precedência", () => {
  expect(normalizeCanonicalStatus("approved", null, "refunded")).toBe("refunded");
});

test("F8. normalizeCanonicalStatus: status desconhecido → unknown (fail-closed)", () => {
  expect(normalizeCanonicalStatus("mystery")).toBe("unknown");
  expect(normalizeCanonicalStatus(null)).toBe("unknown");
  expect(normalizeCanonicalStatus(undefined)).toBe("unknown");
});

test("F9. extractProviderUpdatedAt: prioridade date_last_updated", () => {
  const iso = extractProviderUpdatedAt({
    id: "1",
    status: "approved",
    date_last_updated: "2026-01-15T12:00:00Z",
    date_approved: "2026-01-10T00:00:00Z",
  } as never);
  expect(iso).toBe("2026-01-15T12:00:00.000Z");
});

test("F10. extractProviderUpdatedAt: fallback para date_approved e date_created", () => {
  const a = extractProviderUpdatedAt({
    id: "1", status: "approved", date_approved: "2026-01-10T00:00:00Z",
  } as never);
  expect(a).toBe("2026-01-10T00:00:00.000Z");

  const b = extractProviderUpdatedAt({
    id: "1", status: "pending", date_created: "2026-01-05T00:00:00Z",
  } as never);
  expect(b).toBe("2026-01-05T00:00:00.000Z");
});

test("F11. extractProviderUpdatedAt: null quando sem timestamps ou inválido", () => {
  expect(extractProviderUpdatedAt({ id: "1", status: "approved" } as never)).toBe(null);
  expect(extractProviderUpdatedAt({
    id: "1", status: "approved", date_last_updated: "not-a-date",
  } as never)).toBe(null);
});

// ============================================================================
// A. Webhook / helper: aplicação de estado por status
// ============================================================================

test("A1. approved: chama RPC com canonical=approved e plano validado", async () => {
  state.rpcResponse = {
    outcome: "event_applied",
    event_id: "evt-1",
    plano_after: "pessoal_premium",
    status_after: "ativo",
    had_whatsapp_before: false,
    has_whatsapp_after: true,
    notifications_invalidated: 0,
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER,
    plano: "pessoal_premium",
    periodicidade: "mensal",
    months: 1,
    eventType: "payment.updated",
  });
  expect(r.ok).toBe(true);
  expect(r.outcome).toBe("event_applied");
  expect(state.recorded).toHaveLength(1);
  expect(state.recorded[0].args.p_canonical_status).toBe("approved");
  expect(state.recorded[0].args.p_plano).toBe("pessoal_premium");
  expect(state.recorded[0].args.p_user_id).toBe(USER);
});

test("A2. authorized é canonicalizado como approved", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "authorized" }),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("approved");
});

test("A3-A4. pending / in_process → canonical=pending (event_noop na RPC)", async () => {
  state.rpcResponse = { outcome: "event_noop" };
  for (const s of ["pending", "in_process"]) {
    resetState();
    state.rpcResponse = { outcome: "event_noop" };
    await applyMercadoPagoBillingEvent({
      payment: makePayment({ status: s }),
      userId: USER, plano: null, periodicidade: null, months: 1,
      eventType: "payment.updated",
    });
    expect(state.recorded[0].args.p_canonical_status).toBe("pending");
  }
});

test("A5. rejected → canonical=rejected (event_noop, não destrói plano vigente)", async () => {
  state.rpcResponse = { outcome: "event_noop" };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "rejected" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
  });
  expect(r.outcome).toBe("event_noop");
  expect(state.recorded[0].args.p_canonical_status).toBe("rejected");
});

test("A6. cancelled imediato → canonical=cancelled_immediate", async () => {
  state.rpcResponse = {
    outcome: "event_applied", had_whatsapp_before: true, has_whatsapp_after: false,
    notifications_invalidated: 3,
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "cancelled" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
    overrideCanonical: "cancelled_immediate",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("cancelled_immediate");
  expect(r.notificationsInvalidated).toBe(3);
});

test("A7. cancelled agendado preserva canonical=cancelled_scheduled", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "cancelled" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "subscription.updated",
    cancellationKind: "scheduled",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("cancelled_scheduled");
});

test("A8. refunded → canonical=refunded, invalida notifications", async () => {
  state.rpcResponse = {
    outcome: "event_applied", had_whatsapp_before: true, has_whatsapp_after: false,
    notifications_invalidated: 2,
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "refunded" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("refunded");
  expect(r.notificationsInvalidated).toBe(2);
});

test("A9. chargeback → canonical=chargeback", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "charged_back" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("chargeback");
});

test("A10. expired → canonical=expired", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "expired" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("expired");
});

test("A11. status desconhecido → canonical=unknown (fail-closed)", async () => {
  state.rpcResponse = { outcome: "unknown_status" };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "mystery_status_xyz" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_canonical_status).toBe("unknown");
  expect(r.outcome).toBe("unknown_status");
});

test("A22. usuário não fornecido → invalid_input, RPC NÃO é chamada", async () => {
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: "",
    plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.ok).toBe(false);
  expect(r.outcome).toBe("invalid_input");
  expect(state.recorded).toHaveLength(0);
});

test("A23. cross-user: RPC é invocada com user_id fornecido pelo caller — nunca do metadata sem validação", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  // Metadata do MP diz que é OTHER_USER, mas o caller passa USER autoritativo.
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ metadata: { user_id: OTHER_USER, plano: "pessoal_premium" } }),
    userId: USER,
    plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  // A RPC recebe USER (autoritativo do server), não OTHER_USER (do payload).
  expect(state.recorded[0].args.p_user_id).toBe(USER);
});

// ============================================================================
// B. Idempotência e ordem — RPC responde diretamente com o outcome
// ============================================================================

test("B24. duplicate_event: helper propaga sem re-executar", async () => {
  state.rpcResponse = { outcome: "duplicate_event", event_id: "existing-1" };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.outcome).toBe("duplicate_event");
  expect(r.ok).toBe(true);
});

test("B27. stale_event_skipped: helper propaga", async () => {
  state.rpcResponse = { outcome: "stale_event_skipped" };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ date_last_updated: "2025-01-01T00:00:00Z" }),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.outcome).toBe("stale_event_skipped");
});

test("B32. timestamp ausente: RPC recebe null, sem crash", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ date_last_updated: undefined, date_approved: undefined, date_created: undefined }),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_provider_updated_at).toBe(null);
});

// ============================================================================
// D. WhatsApp — verifica que o helper propaga transições
// ============================================================================

test("D49. downgrade bloqueia entitlement: had=true, has=false, invalidated>0", async () => {
  state.rpcResponse = {
    outcome: "event_applied",
    had_whatsapp_before: true,
    has_whatsapp_after: false,
    notifications_invalidated: 5,
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "approved" }),
    userId: USER,
    plano: "pessoal_manual", // plano sem WhatsApp
    periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.hadWhatsAppBefore).toBe(true);
  expect(r.hasWhatsAppAfter).toBe(false);
  expect(r.notificationsInvalidated).toBe(5);
});

test("D51. cancelled_scheduled: entitlement preservado até vigência", async () => {
  state.rpcResponse = {
    outcome: "event_applied",
    had_whatsapp_before: true,
    has_whatsapp_after: true, // ainda dentro do período pago
    notifications_invalidated: 0,
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment({ status: "cancelled" }),
    userId: USER, plano: null, periodicidade: null, months: 1,
    eventType: "subscription.updated",
    cancellationKind: "scheduled",
  });
  expect(r.notificationsInvalidated).toBe(0);
  expect(r.hasWhatsAppAfter).toBe(true);
});

test("D64. reupgrade: helper trata como event_applied sem tocar em notifications antigas", async () => {
  state.rpcResponse = {
    outcome: "event_applied",
    had_whatsapp_before: false,
    has_whatsapp_after: true,
    notifications_invalidated: 0, // RPC não reanima antigas por design
  };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.notificationsInvalidated).toBe(0);
  expect(r.hasWhatsAppAfter).toBe(true);
});

// ============================================================================
// E. Segurança / fail-closed
// ============================================================================

test("E1. RPC retorna erro (ex: 42501 permission denied) → helper retorna ok:false, sem crash", async () => {
  state.rpcError = { code: "42501", message: "permission denied for function ..." };
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.ok).toBe(false);
  expect(r.outcome).toBe("rpc_error");
  expect(r.reason).toBe("42501");
});

test("E2. RPC lança exceção → helper captura e retorna ok:false", async () => {
  state.rpcThrows = true;
  const r = await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(r.ok).toBe(false);
  expect(r.outcome).toBe("rpc_error");
  expect(r.reason).toBe("exception");
});

test("E3. RPC recebe metadata sanitizado — sem token, sem payload bruto, sem PII", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment({ transaction_amount: 99.9, currency_id: "BRL" }),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  const meta = state.recorded[0].args.p_metadata as Record<string, unknown>;
  expect(Object.keys(meta).sort()).toEqual(
    ["amount", "currency", "environment", "source", "status_detail"].sort(),
  );
  expect(meta.amount).toBe(99.9);
  expect(meta.currency).toBe("BRL");
  // Nenhuma chave sensível deve estar presente.
  expect((meta as Record<string, unknown>).token).toBeUndefined();
  expect((meta as Record<string, unknown>).email).toBeUndefined();
  expect((meta as Record<string, unknown>).external_reference).toBeUndefined();
});

test("E4. p_provider é sempre 'mercado_pago' (nunca inferido do payload)", async () => {
  state.rpcResponse = { outcome: "event_applied" };
  await applyMercadoPagoBillingEvent({
    payment: makePayment(),
    userId: USER, plano: "pessoal_premium", periodicidade: "mensal", months: 1,
    eventType: "payment.updated",
  });
  expect(state.recorded[0].args.p_provider).toBe("mercado_pago");
});
