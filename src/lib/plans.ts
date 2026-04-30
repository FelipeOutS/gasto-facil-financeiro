// Definições de planos e checagem de permissões.
// Permissões NÃO dependem de CPF, e-mail visível ou texto da UI:
// são derivadas do plano efetivo (`current_plan`) lido do banco.

import type { TipoCadastro } from "./profile-utils";

export type PlanTier = "free" | "pessoal" | "mei" | "empresa" | "admin_master";

export type SubscriptionStatus = "ativo" | "teste" | "expirado" | "cancelado";

export type FeatureKey =
  | "importar_extrato"
  | "importar_fatura"
  | "importar_conta"
  | "relatorios_avancados"
  | "contas_a_pagar"
  | "cartoes"
  | "metas_visuais"
  | "orcamento"
  | "perfil_empresarial"
  | "recursos_mei"
  | "recursos_empresa"
  | "investimentos_futuro"
  | "lancamentos_ilimitados";

export const PLAN_LABEL: Record<PlanTier, string> = {
  free: "Free",
  pessoal: "Pessoal",
  mei: "MEI",
  empresa: "Empresa",
  admin_master: "Admin Master",
};

export const PLAN_ORDER: Record<PlanTier, number> = {
  free: 0,
  pessoal: 1,
  mei: 2,
  empresa: 3,
  admin_master: 99,
};

/** Limite mensal de lançamentos no plano Free. */
export const FREE_MONTHLY_LIMIT = 30;

// Plano mínimo necessário para cada recurso.
const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = {
  importar_extrato: "pessoal",
  importar_fatura: "pessoal",
  importar_conta: "pessoal",
  relatorios_avancados: "pessoal",
  contas_a_pagar: "pessoal",
  cartoes: "pessoal",
  metas_visuais: "pessoal",
  orcamento: "pessoal",
  perfil_empresarial: "empresa",
  recursos_mei: "mei",
  recursos_empresa: "empresa",
  investimentos_futuro: "empresa",
  lancamentos_ilimitados: "pessoal",
};

export function planAllowsFeature(plan: PlanTier, feature: FeatureKey): boolean {
  if (plan === "admin_master") return true;
  const min = FEATURE_MIN_PLAN[feature];
  return PLAN_ORDER[plan] >= PLAN_ORDER[min];
}

export function minPlanFor(feature: FeatureKey): PlanTier {
  return FEATURE_MIN_PLAN[feature];
}

/** Plano sugerido para upgrade considerando o tipo de cadastro do usuário. */
export function suggestedUpgrade(
  current: PlanTier,
  tipo: TipoCadastro,
): PlanTier {
  if (current === "admin_master") return current;
  if (tipo === "empresa") return "empresa";
  if (tipo === "mei") return "mei";
  return "pessoal";
}

export type PlanFeature = {
  feature: FeatureKey;
  label: string;
  description: string;
};

export const PLAN_FEATURES: PlanFeature[] = [
  { feature: "lancamentos_ilimitados", label: "Lançamentos ilimitados", description: "Cadastre quantos gastos e receitas quiser." },
  { feature: "contas_a_pagar", label: "Contas a pagar", description: "Controle vencimentos e pagamentos do mês." },
  { feature: "cartoes", label: "Cartões e faturas", description: "Acompanhe limites e compras dos seus cartões." },
  { feature: "importar_extrato", label: "Importar extrato bancário", description: "Importe PDF/CSV do seu banco automaticamente." },
  { feature: "importar_fatura", label: "Importar fatura de cartão", description: "Importe a fatura em PDF ou imagem." },
  { feature: "importar_conta", label: "Importar boleto/Pix", description: "Identifique automaticamente boletos e Pix." },
  { feature: "metas_visuais", label: "Metas com imagens", description: "Capa visual real para cada meta." },
  { feature: "relatorios_avancados", label: "Relatórios avançados", description: "Comparativos, tendências e insights." },
  { feature: "orcamento", label: "Orçamento por categoria", description: "Defina limites mensais e acompanhe o uso." },
  { feature: "recursos_mei", label: "Recursos do MEI", description: "Linguagem e visão financeira do MEI." },
  { feature: "recursos_empresa", label: "Recursos empresariais", description: "Visão financeira e relatórios da empresa." },
  { feature: "investimentos_futuro", label: "Investimentos (em breve)", description: "Estrutura preparada para acompanhar investimentos." },
];

export function planSummary(plan: PlanTier): { highlights: string[] } {
  switch (plan) {
    case "admin_master":
      return { highlights: ["Acesso total", "Sem limites", "Todos os recursos atuais e futuros"] };
    case "empresa":
      return { highlights: ["Tudo do MEI", "Perfil empresarial CNPJ", "Mais relatórios e controles"] };
    case "mei":
      return { highlights: ["Tudo do Pessoal", "Visão de MEI", "Relatórios do negócio"] };
    case "pessoal":
      return { highlights: ["Lançamentos ilimitados", "Importações", "Relatórios e orçamento"] };
    default:
      return { highlights: [`Até ${FREE_MONTHLY_LIMIT} lançamentos/mês`, "Cadastro manual", "Metas e guardado simples"] };
  }
}
