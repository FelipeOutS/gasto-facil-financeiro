/**
 * WA-C11 FASE 2.2 — Resolver server-side de tipo de cancelamento do Mercado Pago.
 *
 * Único ponto de verdade para classificar cancelamento como:
 *   - "immediate"     → encerra acesso agora (refund, chargeback, expirado, ou
 *                       cancelled sem período pago vigente);
 *   - "scheduled"     → cancelamento com período pago ainda vigente
 *                       (não corta acesso antes de current_period_end);
 *   - "not_cancelled" → recurso não indica cancelamento;
 *   - "unknown"       → dados insuficientes; fail-closed sem estender nem
 *                       encurtar acesso pago.
 *
 * Fonte AUTORITATIVA: apenas campos vindos do recurso consultado no MP.
 * NÃO confia em hints do frontend, tópico resumido do webhook, nem metadata
 * fabricada pelo client. `overrideCanonical` a partir do tópico (refund,
 * chargeback) é aplicado pelo chamador ANTES do resolver — o resolver só
 * decide o modo de cancelamento quando o próprio status raw for cancelled.
 */

export type MercadoPagoCancellationKind = "immediate" | "scheduled" | "not_cancelled" | "unknown";

export interface CancellationResolverInput {
  /** raw status vindo do recurso MP (`payment.status`). */
  rawStatus: string | null | undefined;
  /** ISO string, autoritativo (`payment.date_approved`). */
  dateApproved: string | null | undefined;
  /** ISO string, autoritativo (`payment.date_last_updated`). */
  dateLastUpdated?: string | null | undefined;
  /** meses de vigência já cobrados por esse pagamento (server-side, mapeado do plano). */
  months: number | null | undefined;
  /** current_period_end autoritativo já persistido em user_plans, se conhecido (ISO). */
  currentPeriodEnd?: string | null | undefined;
  /** Momento de referência para o cálculo (default: agora). */
  now?: Date;
}

export interface CancellationResolverResult {
  kind: MercadoPagoCancellationKind;
  /** Motivo estruturado (para logs/auditoria; nunca contém PII). */
  reason: string;
  /** Vigência efetiva calculada, quando derivável (ISO). */
  effectiveUntil: string | null;
}

const CANCEL_STATUS = new Set(["cancelled", "canceled"]);
const IMMEDIATE_STATUS = new Set(["refunded", "charged_back", "expired"]);
const ACTIVE_STATUS = new Set([
  "approved",
  "authorized",
  "paid",
  "pending",
  "in_process",
  "in_mediation",
  "rejected",
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

function parseIso(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Deriva o fim de vigência autoritativo:
 *   1. `currentPeriodEnd` persistido em user_plans (fonte da verdade primária);
 *   2. `date_approved + months*30d` (derivação server-side de fallback).
 */
export function deriveEffectiveUntil(
  input: Pick<CancellationResolverInput, "dateApproved" | "months" | "currentPeriodEnd">,
): Date | null {
  const persisted = parseIso(input.currentPeriodEnd);
  if (persisted) return persisted;
  const approved = parseIso(input.dateApproved);
  const months = Number(input.months);
  if (!approved || !Number.isFinite(months) || months <= 0) return null;
  const days = Math.round(months * DAYS_PER_MONTH);
  return new Date(approved.getTime() + days * MS_PER_DAY);
}

/**
 * Classifica o cancelamento usando apenas campos autoritativos.
 * Não infere cancelamento a partir de topic — chamador aplica override antes.
 */
export function resolveMercadoPagoCancellationKind(
  input: CancellationResolverInput,
): CancellationResolverResult {
  const raw = (input.rawStatus ?? "").toLowerCase().trim();
  const now = input.now ?? new Date();

  if (IMMEDIATE_STATUS.has(raw)) {
    return {
      kind: "immediate",
      reason: `raw_status_${raw}`,
      effectiveUntil: null,
    };
  }

  if (ACTIVE_STATUS.has(raw)) {
    return {
      kind: "not_cancelled",
      reason: `raw_status_${raw}`,
      effectiveUntil: deriveEffectiveUntil(input)?.toISOString() ?? null,
    };
  }

  if (!CANCEL_STATUS.has(raw)) {
    // Status não reconhecido: unknown. Chamador deve preservar estado.
    return {
      kind: "unknown",
      reason: raw ? `unknown_raw_status_${raw}` : "empty_raw_status",
      effectiveUntil: deriveEffectiveUntil(input)?.toISOString() ?? null,
    };
  }

  // raw === "cancelled" — decide entre scheduled e immediate por vigência
  // autoritativa. Sem hint do frontend.
  const effective = deriveEffectiveUntil(input);
  if (!effective) {
    // Sem evidência de vigência: unknown. NÃO cortar acesso pago já conhecido;
    // NÃO estender além do conhecido. Chamador preserva estado anterior.
    return {
      kind: "unknown",
      reason: "cancelled_without_period_evidence",
      effectiveUntil: null,
    };
  }

  if (effective.getTime() > now.getTime()) {
    return {
      kind: "scheduled",
      reason: "cancelled_within_paid_period",
      effectiveUntil: effective.toISOString(),
    };
  }

  return {
    kind: "immediate",
    reason: "cancelled_after_paid_period",
    effectiveUntil: effective.toISOString(),
  };
}
