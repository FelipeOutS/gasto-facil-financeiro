/**
 * WA-C11 FASE 2.2 — Testes do resolver autoritativo de cancelamento MP.
 *
 * Regras:
 *   - immediate: refund, chargeback, expired, ou cancelled após vigência.
 *   - scheduled: cancelled com vigência pagas ainda futura.
 *   - not_cancelled: status ativo.
 *   - unknown: dados insuficientes ou status não reconhecido.
 *   - unknown NÃO amplia vigência e NÃO corta período pago.
 */
import { describe, expect, it } from "bun:test";
import {
  deriveEffectiveUntil,
  resolveMercadoPagoCancellationKind,
} from "../src/server/mercadopago-cancellation-resolver.server";

const NOW = new Date("2026-07-17T12:00:00Z");
const APPROVED_LAST_MONTH = "2026-06-20T10:00:00Z"; // dentro do período de 1 mês
const APPROVED_MONTHS_AGO = "2026-03-01T10:00:00Z"; // fora do período de 1 mês

describe("resolveMercadoPagoCancellationKind — fonte autoritativa", () => {
  it("refunded → immediate", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "refunded",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("immediate");
  });

  it("charged_back → immediate", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "charged_back",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("immediate");
  });

  it("expired → immediate", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "expired",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("immediate");
  });

  it("cancelled dentro do período pago → scheduled (preserva acesso)", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("scheduled");
    expect(r.effectiveUntil).toBeTruthy();
    expect(new Date(r.effectiveUntil!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("canceled (grafia MP) dentro do período pago → scheduled", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "canceled",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("scheduled");
  });

  it("cancelled com current_period_end futuro → scheduled (fonte primária)", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: APPROVED_MONTHS_AGO, // date_approved é antigo
      months: 12,
      currentPeriodEnd: "2026-08-15T00:00:00Z", // mas period_end é futuro
      now: NOW,
    });
    expect(r.kind).toBe("scheduled");
  });

  it("cancelled após fim do período pago → immediate", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: APPROVED_MONTHS_AGO,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("immediate");
  });

  it("cancelled com current_period_end passado → immediate", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      currentPeriodEnd: "2026-07-01T00:00:00Z", // já passou
      now: NOW,
    });
    expect(r.kind).toBe("immediate");
  });

  it("cancelled sem months e sem currentPeriodEnd → unknown", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: APPROVED_LAST_MONTH,
      months: 0,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
    expect(r.effectiveUntil).toBeNull();
  });

  it("cancelled sem date_approved e sem currentPeriodEnd → unknown", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: null,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
  });

  it("approved → not_cancelled", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "approved",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("not_cancelled");
  });

  it("pending → not_cancelled", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "pending",
      dateApproved: null,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("not_cancelled");
  });

  it("rejected → not_cancelled (não é cancelamento; helper trata como rejected)", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "rejected",
      dateApproved: null,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("not_cancelled");
  });

  it("status desconhecido → unknown", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "gremlin",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
  });

  it("status vazio → unknown", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "",
      dateApproved: null,
      months: null,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
    expect(r.reason).toBe("empty_raw_status");
  });

  it("unknown NÃO amplia vigência (effectiveUntil sempre null quando ausente evidência)", () => {
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "cancelled",
      dateApproved: null,
      months: null,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
    expect(r.effectiveUntil).toBeNull();
  });

  it("unknown NÃO corta período pago — retorna vigência conhecida quando derivável", () => {
    // Status desconhecido, mas há evidência de vigência: expõe effectiveUntil
    // para que o chamador não corte o período pago vigente.
    const r = resolveMercadoPagoCancellationKind({
      rawStatus: "gremlin",
      dateApproved: APPROVED_LAST_MONTH,
      months: 1,
      now: NOW,
    });
    expect(r.kind).toBe("unknown");
    expect(r.effectiveUntil).toBeTruthy();
    expect(new Date(r.effectiveUntil!).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("deriveEffectiveUntil", () => {
  it("prioriza currentPeriodEnd persistido sobre date_approved+months", () => {
    const d = deriveEffectiveUntil({
      dateApproved: "2026-01-01T00:00:00Z",
      months: 1,
      currentPeriodEnd: "2027-01-01T00:00:00Z",
    });
    expect(d?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("cai para date_approved+months quando currentPeriodEnd ausente", () => {
    const d = deriveEffectiveUntil({
      dateApproved: "2026-06-01T00:00:00Z",
      months: 3,
      currentPeriodEnd: null,
    });
    expect(d).toBeTruthy();
    // 3 meses × 30 dias = 90 dias após 2026-06-01
    expect(d!.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  it("retorna null sem dados", () => {
    const d = deriveEffectiveUntil({
      dateApproved: null,
      months: 0,
      currentPeriodEnd: null,
    });
    expect(d).toBeNull();
  });
});
