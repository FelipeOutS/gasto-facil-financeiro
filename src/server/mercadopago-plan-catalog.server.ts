/**
 * Prompt 4A — Catálogo server-side de planos do Mercado Pago.
 *
 * FONTE DA VERDADE de preço, periodicidade, moeda e duração.
 * O cliente envia apenas `plan_key` + `periodicity`; nunca preço, nunca moeda,
 * nunca meses, nunca desconto.
 *
 * Funções puras — testáveis sem rede e sem banco.
 */

export type CatalogPlanKey =
  | "pessoal_manual"
  | "pessoal_premium"
  | "mei_essencial"
  | "mei_inteligente"
  | "empresa";

export type CatalogPeriodicity = "mensal" | "trimestral" | "semestral" | "anual";

export const CATALOG_CURRENCY = "BRL" as const;

const PLAN_BASE: Record<CatalogPlanKey, { cents: number; name: string; allowNew: boolean }> = {
  pessoal_manual: { cents: 2500, name: "Controle Simples Pessoal", allowNew: false },
  pessoal_premium: { cents: 5000, name: "Controle Completo Pessoal", allowNew: true },
  mei_essencial: { cents: 3990, name: "Essencial para MEI", allowNew: true },
  mei_inteligente: { cents: 9000, name: "MEI Completo", allowNew: true },
  empresa: { cents: 18000, name: "Empresa", allowNew: true },
};

const PERIOD_INFO: Record<CatalogPeriodicity, { months: number; discount: number; label: string }> =
  {
    mensal: { months: 1, discount: 0, label: "Mensal" },
    trimestral: { months: 3, discount: 5, label: "Trimestral" },
    semestral: { months: 6, discount: 10, label: "Semestral" },
    anual: { months: 12, discount: 20, label: "Anual" },
  };

export interface ResolvedCatalogOffer {
  planKey: CatalogPlanKey;
  planName: string;
  periodicity: CatalogPeriodicity;
  periodicityLabel: string;
  months: number;
  discountPercent: number;
  amountCents: number;
  currency: typeof CATALOG_CURRENCY;
  description: string;
}

export type CatalogResolveError = "invalid_plan" | "plan_unavailable" | "invalid_period";

export function isCatalogPlanKey(v: unknown): v is CatalogPlanKey {
  return typeof v === "string" && v in PLAN_BASE;
}

export function isCatalogPeriodicity(v: unknown): v is CatalogPeriodicity {
  return typeof v === "string" && v in PERIOD_INFO;
}

export function catalogPriceCents(plan: CatalogPlanKey, period: CatalogPeriodicity): number {
  const base = PLAN_BASE[plan].cents * PERIOD_INFO[period].months;
  return Math.round(base * (1 - PERIOD_INFO[period].discount / 100));
}

/**
 * Resolve a oferta oficial. Nunca aceita preço vindo do cliente.
 */
export function resolveCatalogOffer(input: {
  planKey: unknown;
  periodicity: unknown;
}): { ok: true; offer: ResolvedCatalogOffer } | { ok: false; error: CatalogResolveError } {
  if (!isCatalogPlanKey(input.planKey)) return { ok: false, error: "invalid_plan" };
  if (!isCatalogPeriodicity(input.periodicity)) return { ok: false, error: "invalid_period" };
  const plan = PLAN_BASE[input.planKey];
  if (!plan.allowNew) return { ok: false, error: "plan_unavailable" };
  const period = PERIOD_INFO[input.periodicity];
  const amountCents = catalogPriceCents(input.planKey, input.periodicity);
  return {
    ok: true,
    offer: {
      planKey: input.planKey,
      planName: plan.name,
      periodicity: input.periodicity,
      periodicityLabel: period.label,
      months: period.months,
      discountPercent: period.discount,
      amountCents,
      currency: CATALOG_CURRENCY,
      description: `Assinatura ${plan.name} — ${period.label}`,
    },
  };
}

export type OfferMismatch =
  | "plan_mismatch"
  | "periodicity_mismatch"
  | "amount_mismatch"
  | "currency_mismatch";

/**
 * Validação server-side aplicada no webhook: o que o provedor cobrou tem de
 * coincidir com a oferta oficial persistida na sessão de checkout.
 *
 * Tolerância de 1 centavo para arredondamento de ponto flutuante do provedor.
 */
export function validateOfferAgainstProvider(input: {
  expected: { planKey: string; periodicity: string; amountCents: number; currency: string };
  provider: {
    amountCents?: number | null;
    currency?: string | null;
    planKey?: string | null;
    periodicity?: string | null;
  };
}): { ok: true } | { ok: false; mismatches: OfferMismatch[] } {
  const mismatches: OfferMismatch[] = [];
  const p = input.provider;
  if (p.planKey && p.planKey !== input.expected.planKey) mismatches.push("plan_mismatch");
  if (p.periodicity && p.periodicity !== input.expected.periodicity) {
    mismatches.push("periodicity_mismatch");
  }
  if (typeof p.amountCents === "number") {
    if (Math.abs(p.amountCents - input.expected.amountCents) > 1)
      mismatches.push("amount_mismatch");
  }
  if (p.currency && p.currency.toUpperCase() !== input.expected.currency.toUpperCase()) {
    mismatches.push("currency_mismatch");
  }
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}
