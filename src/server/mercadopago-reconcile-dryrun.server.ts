/**
 * Prompt 4A — Reconciliação em DRY-RUN (somente leitura).
 *
 * Nada é escrito: nenhum pagamento, nenhum evento, nenhum plano.
 * Nenhuma chamada é feita à API de produção do Mercado Pago nesta fase — o
 * estado do provedor é fornecido pelo chamador (mock nos testes).
 *
 * Classificação dos pagamentos históricos:
 *   LEGADO                 — sem ambiente/origem e anterior ao Prompt 4A;
 *   INCOMPLETO             — falta identificador ou vínculo determinístico;
 *   CONSISTENTE            — local e provedor coincidem;
 *   DIVERGENTE             — local e provedor discordam;
 *   NAO_FOI_POSSIVEL_VALIDAR — sem estado do provedor disponível.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canonicalMpStatus } from "./mercadopago-diagnostics.server";
import { maskIdentifier } from "./mercadopago-payload-sanitize.server";

export type ReconClassification =
  | "LEGADO"
  | "INCOMPLETO"
  | "CONSISTENTE"
  | "DIVERGENTE"
  | "NAO_FOI_POSSIVEL_VALIDAR";

export interface LocalPaymentSnapshot {
  id: string;
  user_id: string | null;
  plano: string | null;
  amount_cents: number | null;
  currency: string | null;
  method: string | null;
  status: string | null;
  provider_payment_id: string | null;
  checkout_session_id?: string | null;
  environment?: string | null;
  purchase_origin?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
}

export interface ProviderPaymentSnapshot {
  id: string | number;
  status?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  date_last_updated?: string | null;
}

export interface ReconRow {
  payment_id_masked: string;
  user_id_masked: string;
  provider_payment_id_masked: string;
  plano: string | null;
  local_status: string | null;
  provider_status: string | null;
  amount_cents_local: number | null;
  amount_cents_provider: number | null;
  environment: string;
  purchase_origin: string;
  classification: ReconClassification;
  findings: string[];
}

/** Classificador PURO — não toca banco nem rede. */
export function classifyHistoricalPayment(
  local: LocalPaymentSnapshot,
  provider: ProviderPaymentSnapshot | null,
): { classification: ReconClassification; findings: string[] } {
  const findings: string[] = [];
  const legacyEnv = !local.environment || local.environment === "legacy_unknown";
  const noLink = !local.checkout_session_id;

  if (!local.provider_payment_id) {
    findings.push("sem_provider_payment_id");
    return { classification: "INCOMPLETO", findings };
  }
  if (legacyEnv) findings.push("environment_legacy_unknown");
  if (noLink) findings.push("sem_checkout_session_vinculada");

  if (!provider) {
    findings.push("estado_do_provedor_indisponivel_nesta_fase");
    return {
      classification: legacyEnv ? "LEGADO" : "NAO_FOI_POSSIVEL_VALIDAR",
      findings,
    };
  }

  const localCanonical = canonicalMpStatus(local.status);
  const providerCanonical = canonicalMpStatus(provider.status);
  if (localCanonical !== providerCanonical) {
    findings.push(`status_divergente_local_${localCanonical}_provedor_${providerCanonical}`);
  }
  const providerCents =
    typeof provider.transaction_amount === "number"
      ? Math.round(provider.transaction_amount * 100)
      : null;
  if (
    providerCents !== null &&
    local.amount_cents !== null &&
    Math.abs(providerCents - local.amount_cents) > 1
  ) {
    findings.push("valor_divergente");
  }
  if (
    provider.currency_id &&
    local.currency &&
    provider.currency_id.toUpperCase() !== local.currency.toUpperCase()
  ) {
    findings.push("moeda_divergente");
  }

  const divergent = findings.some((f) => f.startsWith("status_divergente") || f.endsWith("divergente"));
  if (divergent) return { classification: "DIVERGENTE", findings };
  return { classification: legacyEnv ? "LEGADO" : "CONSISTENTE", findings };
}

export function buildReconRow(
  local: LocalPaymentSnapshot,
  provider: ProviderPaymentSnapshot | null,
): ReconRow {
  const { classification, findings } = classifyHistoricalPayment(local, provider);
  return {
    payment_id_masked: maskIdentifier(local.id),
    user_id_masked: maskIdentifier(local.user_id),
    provider_payment_id_masked: maskIdentifier(local.provider_payment_id),
    plano: local.plano,
    local_status: local.status,
    provider_status: provider?.status ?? null,
    amount_cents_local: local.amount_cents,
    amount_cents_provider:
      typeof provider?.transaction_amount === "number"
        ? Math.round(provider.transaction_amount * 100)
        : null,
    environment: local.environment ?? "legacy_unknown",
    purchase_origin: local.purchase_origin ?? "legacy_unknown",
    classification,
    findings,
  };
}

export interface DryRunReport {
  dry_run: true;
  writes_performed: 0;
  total: number;
  by_classification: Record<ReconClassification, number>;
  rows: ReconRow[];
}

/**
 * Relatório dry-run dos pagamentos locais. SOMENTE LEITURA.
 *
 * `providerLookup` é opcional e injetável: nesta fase os testes passam mocks
 * e a produção passa `undefined` (nenhuma chamada externa, nenhum efeito).
 */
export async function reconcileDryRun(options: {
  limit?: number;
  userId?: string | null;
  providerLookup?: (providerPaymentId: string) => Promise<ProviderPaymentSnapshot | null>;
} = {}): Promise<DryRunReport> {
  let query = supabaseAdmin
    .from("subscription_payments")
    .select(
      "id, user_id, plano, amount_cents, currency, method, status, provider_payment_id, checkout_session_id, environment, purchase_origin, created_at, paid_at",
    )
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 50);
  if (options.userId) query = query.eq("user_id", options.userId);

  const { data } = await query;
  const locals = (data ?? []) as unknown as LocalPaymentSnapshot[];

  const rows: ReconRow[] = [];
  for (const local of locals) {
    let provider: ProviderPaymentSnapshot | null = null;
    if (options.providerLookup && local.provider_payment_id) {
      provider = await options.providerLookup(local.provider_payment_id);
    }
    rows.push(buildReconRow(local, provider));
  }

  const by_classification: Record<ReconClassification, number> = {
    LEGADO: 0,
    INCOMPLETO: 0,
    CONSISTENTE: 0,
    DIVERGENTE: 0,
    NAO_FOI_POSSIVEL_VALIDAR: 0,
  };
  for (const r of rows) by_classification[r.classification] += 1;

  return { dry_run: true, writes_performed: 0, total: rows.length, by_classification, rows };
}
