/**
 * Limites centrais para valores de lançamentos financeiros.
 *
 * Fonte única da verdade — usada no cliente (formulários/store), no servidor
 * (server functions / WhatsApp) e espelhada no banco pela constraint
 * `receitas_valor_valid_range_check`.
 *
 * Motivo: em 05/05/2026 uma receita recorrente foi criada com
 * R$ 55.555.555.555,00 (erro de digitação), contaminando dashboards e somas.
 * Ver docs/CORRECAO_DADOS_FICTICIOS_GASTO_INTELIGENTE_2026-07-31.md
 */

/** Valor máximo permitido em um único lançamento financeiro: R$ 999.999.999,99 */
export const MAX_FINANCIAL_ENTRY_AMOUNT = 999999999.99;

/** Valor mínimo permitido (exclusivo em zero). */
export const MIN_FINANCIAL_ENTRY_AMOUNT = 0.01;

/** Número máximo de casas decimais aceitas. */
export const MAX_FINANCIAL_ENTRY_DECIMALS = 2;

export type FinancialAmountErrorCode =
  | "not_a_number"
  | "not_finite"
  | "too_small"
  | "too_many_decimals"
  | "too_large";

export type FinancialAmountValidation =
  | { ok: true; value: number }
  | { ok: false; code: FinancialAmountErrorCode };

const MESSAGES_PT: Record<FinancialAmountErrorCode, string> = {
  not_a_number: "Informe um valor numérico válido.",
  not_finite: "Informe um valor numérico válido.",
  too_small: "O valor precisa ser maior que zero.",
  too_many_decimals: "Use no máximo duas casas decimais.",
  too_large:
    "O valor informado ultrapassa o limite permitido para um lançamento financeiro (R$ 999.999.999,99).",
};

const MESSAGES_EN: Record<FinancialAmountErrorCode, string> = {
  not_a_number: "Enter a valid numeric amount.",
  not_finite: "Enter a valid numeric amount.",
  too_small: "The amount must be greater than zero.",
  too_many_decimals: "Use at most two decimal places.",
  too_large: "The amount exceeds the maximum allowed for a financial entry (999,999,999.99).",
};

/** Mensagem amigável (nunca expõe erro técnico do banco). */
export function financialAmountMessage(
  code: FinancialAmountErrorCode,
  locale: "pt" | "en" = "pt",
): string {
  return (locale === "en" ? MESSAGES_EN : MESSAGES_PT)[code];
}

/**
 * Valida um valor de lançamento financeiro.
 * Rejeita NaN, Infinity, <= 0, mais de 2 casas decimais e acima do teto.
 * Aceita apenas `number` — strings devem ser normalizadas antes (parseBRLInput).
 */
export function validateFinancialAmount(value: unknown): FinancialAmountValidation {
  if (typeof value !== "number") return { ok: false, code: "not_a_number" };
  if (Number.isNaN(value)) return { ok: false, code: "not_a_number" };
  if (!Number.isFinite(value)) return { ok: false, code: "not_finite" };
  if (value <= 0) return { ok: false, code: "too_small" };
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - value) > 1e-9) return { ok: false, code: "too_many_decimals" };
  if (rounded > MAX_FINANCIAL_ENTRY_AMOUNT) return { ok: false, code: "too_large" };
  return { ok: true, value: rounded };
}

/** Atalho booleano. */
export function isValidFinancialAmount(value: unknown): boolean {
  return validateFinancialAmount(value).ok;
}
