/**
 * App V3 — Tokens visuais de módulo (frontend-only).
 * Mapeia o nome do módulo para o token CSS definido em src/styles.css.
 * Mantém compatibilidade light/dark e não substitui o tema atual.
 */

export type AppModuleTone =
  | "gastos"
  | "receitas"
  | "cartoes"
  | "metas"
  | "contas"
  | "orcamento"
  | "relatorios"
  | "cofre"
  | "plano"
  | "investimentos"
  | "neutral";

export const MODULE_TONE_VAR: Record<AppModuleTone, string> = {
  gastos: "var(--module-gastos)",
  receitas: "var(--module-receitas)",
  cartoes: "var(--module-cartoes)",
  metas: "var(--module-metas)",
  contas: "var(--module-contas)",
  orcamento: "var(--module-orcamento)",
  relatorios: "var(--module-relatorios)",
  cofre: "var(--module-cofre)",
  plano: "var(--module-plano)",
  investimentos: "var(--module-investimentos)",
  neutral: "var(--primary)",
};
