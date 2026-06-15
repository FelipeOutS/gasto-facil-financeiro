import type { PlanTier } from "@/lib/plans";

export type AccountType = "pessoa_fisica" | "mei" | "empresa";

export type GoalKey =
  | "controlar_gastos"
  | "organizar_cartoes"
  | "contas_a_pagar"
  | "contas_a_receber"
  | "investimentos"
  | "orcamento"
  | "assinaturas"
  | "alertas";

export type ModuleKey =
  | "gastos"
  | "cartoes"
  | "contas_a_pagar"
  | "contas_a_receber"
  | "orcamento"
  | "assinaturas"
  | "investimentos"
  | "alertas"
  | "relatorios";

export type OnboardingState = {
  user_id: string;
  account_type: AccountType | null;
  goals: GoalKey[];
  enabled_modules: ModuleKey[];
  recommended_plan: PlanTier | null;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
};

export const GOALS: { key: GoalKey; label: string }[] = [
  { key: "controlar_gastos", label: "Controlar gastos do mês" },
  { key: "organizar_cartoes", label: "Organizar cartões e faturas" },
  { key: "contas_a_pagar", label: "Não esquecer contas a pagar" },
  { key: "contas_a_receber", label: "Controlar valores a receber" },
  { key: "investimentos", label: "Acompanhar investimentos" },
  { key: "orcamento", label: "Criar orçamento por categoria" },
  { key: "assinaturas", label: "Identificar assinaturas e recorrências" },
  { key: "alertas", label: "Ter alertas inteligentes" },
];

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "gastos", label: "Gastos" },
  { key: "cartoes", label: "Cartões" },
  { key: "contas_a_pagar", label: "Contas a pagar" },
  { key: "contas_a_receber", label: "Contas a receber" },
  { key: "orcamento", label: "Orçamento" },
  { key: "assinaturas", label: "Assinaturas" },
  { key: "investimentos", label: "Investimentos" },
  { key: "alertas", label: "Alertas" },
  { key: "relatorios", label: "Relatórios" },
];

export const ACCOUNT_TYPES: {
  key: AccountType;
  title: string;
  description: string;
}[] = [
  {
    key: "pessoa_fisica",
    title: "Pessoa física",
    description: "Para controlar minha vida financeira pessoal.",
  },
  {
    key: "mei",
    title: "MEI",
    description:
      "Para organizar meu dinheiro pessoal e o financeiro do meu negócio.",
  },
  {
    key: "empresa",
    title: "Empresa",
    description:
      "Para acompanhar receitas, despesas, contas e relatórios da empresa.",
  },
];

/** Sugere plano com base no tipo + objetivos + módulos. */
export function recommendPlan(
  accountType: AccountType | null,
  _goals: GoalKey[],
  _modules: ModuleKey[],
): PlanTier {
  if (accountType === "empresa") return "empresa";
  if (accountType === "mei") {
    return "mei_essencial";
  }
  // pessoa_fisica ou null
  return "pessoal_premium";
}
