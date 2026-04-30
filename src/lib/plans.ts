// Definições de planos e checagem de permissões.
// Permissões NÃO dependem de CPF, e-mail visível ou texto da UI:
// são derivadas do plano efetivo, calculado de forma centralizada.

import type { TipoCadastro } from "./profile-utils";

/**
 * Tiers de plano. `free` permanece apenas para compatibilidade interna
 * (registros antigos), mas NÃO é exibido como plano comercial.
 */
export type PlanTier =
  | "free"
  | "sem_assinatura"
  | "pessoal_manual"
  | "pessoal_premium"
  | "mei"
  | "empresa"
  | "admin_master";

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
  free: "Sem assinatura",
  sem_assinatura: "Sem assinatura",
  pessoal_manual: "Pessoa Física Manual",
  pessoal_premium: "Pessoa Física Premium",
  mei: "MEI",
  empresa: "Empresa",
  admin_master: "Admin Master",
};

export const PLAN_ORDER: Record<PlanTier, number> = {
  sem_assinatura: 0,
  free: 0,
  pessoal_manual: 1,
  pessoal_premium: 2,
  mei: 3,
  empresa: 4,
  admin_master: 99,
};

// Plano mínimo necessário para cada recurso.
const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = {
  // Recursos básicos -> a partir do Pessoa Física Manual
  contas_a_pagar: "pessoal_manual",
  cartoes: "pessoal_manual",
  orcamento: "pessoal_manual",
  lancamentos_ilimitados: "pessoal_manual",
  // Recursos premium -> a partir do Pessoa Física Premium
  importar_extrato: "pessoal_premium",
  importar_fatura: "pessoal_premium",
  importar_conta: "pessoal_premium",
  relatorios_avancados: "pessoal_premium",
  metas_visuais: "pessoal_premium",
  // Recursos por tipo
  recursos_mei: "mei",
  perfil_empresarial: "empresa",
  recursos_empresa: "empresa",
  investimentos_futuro: "empresa",
};

export function planAllowsFeature(plan: PlanTier, feature: FeatureKey): boolean {
  if (plan === "admin_master") return true;
  const min = FEATURE_MIN_PLAN[feature];
  return PLAN_ORDER[plan] >= PLAN_ORDER[min];
}

export function minPlanFor(feature: FeatureKey): PlanTier {
  return FEATURE_MIN_PLAN[feature];
}

/* ===========================================================
 * Admin Master por e-mail (regra central)
 * =========================================================== */

const ADMIN_MASTER_EMAILS: ReadonlyArray<string> = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
];

export function isAdminMasterEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_MASTER_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Plano efetivo do usuário.
 * - Se o e-mail é Admin Master => `admin_master`, sempre.
 * - Caso contrário => o plano salvo, ou `sem_assinatura` se não houver.
 *
 * Mantém compatibilidade com tiers legados (`pessoal` => `pessoal_manual`).
 */
export function getEffectiveUserPlan(
  user: { email?: string | null } | null | undefined,
  storedPlan: string | null | undefined,
): PlanTier {
  if (isAdminMasterEmail(user?.email)) return "admin_master";
  const p = (storedPlan ?? "").toLowerCase();
  // Mapeamentos legados
  if (p === "pessoal") return "pessoal_manual";
  if (p === "admin_master") return "admin_master";
  if (
    p === "pessoal_manual" ||
    p === "pessoal_premium" ||
    p === "mei" ||
    p === "empresa"
  ) {
    return p as PlanTier;
  }
  if (p === "free" || p === "" || p === "sem_assinatura") return "sem_assinatura";
  return "sem_assinatura";
}

/** Plano sugerido para upgrade considerando o tipo de cadastro do usuário. */
export function suggestedUpgrade(
  current: PlanTier,
  tipo: TipoCadastro,
): PlanTier {
  if (current === "admin_master") return current;
  if (tipo === "empresa") return "empresa";
  if (tipo === "mei") return "mei";
  // Pessoa física: sugere o premium como upgrade padrão
  return current === "pessoal_manual" ? "pessoal_premium" : "pessoal_manual";
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
  { feature: "orcamento", label: "Orçamento por categoria", description: "Defina limites mensais e acompanhe o uso." },
  { feature: "importar_extrato", label: "Importar extrato bancário", description: "Importe PDF/CSV do seu banco automaticamente." },
  { feature: "importar_fatura", label: "Importar fatura de cartão", description: "Importe a fatura em PDF ou imagem." },
  { feature: "importar_conta", label: "Importar boleto/Pix", description: "Identifique automaticamente boletos e Pix." },
  { feature: "metas_visuais", label: "Metas com imagens", description: "Capa visual real para cada meta." },
  { feature: "relatorios_avancados", label: "Relatórios avançados", description: "Comparativos, tendências e insights." },
  { feature: "recursos_mei", label: "Recursos do MEI", description: "Linguagem e visão financeira do MEI." },
  { feature: "recursos_empresa", label: "Recursos empresariais", description: "Visão financeira e relatórios da empresa." },
  { feature: "investimentos_futuro", label: "Investimentos (em breve)", description: "Estrutura preparada para acompanhar investimentos." },
];

/* ===========================================================
 * Catálogo comercial (sem plano Free)
 * =========================================================== */

export type CommercialPlan = {
  tier: PlanTier;
  name: string;
  priceLabel: string;
  tagline: string;
  highlights: string[];
};

export const COMMERCIAL_PLANS: CommercialPlan[] = [
  {
    tier: "pessoal_manual",
    name: "Pessoa Física Manual",
    priceLabel: "R$ 25,00/mês",
    tagline: "Para quem quer organizar tudo manualmente.",
    highlights: [
      "Lançamentos manuais ilimitados",
      "Gastos, receitas e contas a pagar",
      "Metas, guardado e orçamento",
      "Relatórios básicos",
      "Sem importações automáticas",
    ],
  },
  {
    tier: "pessoal_premium",
    name: "Pessoa Física Premium",
    priceLabel: "R$ 50,00/mês",
    tagline: "Mais automação para o seu dia a dia.",
    highlights: [
      "Tudo do Pessoa Física Manual",
      "Importar extrato, fatura e boleto/Pix",
      "Metas com imagens",
      "Relatórios avançados e insights",
      "Investimentos em breve",
    ],
  },
  {
    tier: "mei",
    name: "MEI",
    priceLabel: "a partir de R$ 39,90/mês",
    tagline: "Para o seu negócio como MEI.",
    highlights: [
      "Tudo do Pessoa Física Premium",
      "Perfil e linguagem para MEI",
      "Contas e relatórios do negócio",
      "Separação pessoal × negócio",
      "Investimentos em breve",
    ],
  },
  {
    tier: "empresa",
    name: "Empresa",
    priceLabel: "R$ 150,00/mês",
    tagline: "Visão financeira completa para a sua empresa.",
    highlights: [
      "Tudo do MEI",
      "Perfil empresarial com CNPJ",
      "Controle financeiro empresarial",
      "Relatórios completos",
      "Investimentos em breve",
    ],
  },
];

export function planSummary(plan: PlanTier): { highlights: string[] } {
  switch (plan) {
    case "admin_master":
      return { highlights: ["Acesso total", "Sem limites", "Todos os recursos atuais e futuros"] };
    case "empresa":
      return COMMERCIAL_PLANS[3] ? { highlights: COMMERCIAL_PLANS[3].highlights } : { highlights: [] };
    case "mei":
      return { highlights: COMMERCIAL_PLANS[2].highlights };
    case "pessoal_premium":
      return { highlights: COMMERCIAL_PLANS[1].highlights };
    case "pessoal_manual":
      return { highlights: COMMERCIAL_PLANS[0].highlights };
    default:
      return {
        highlights: [
          "Sem assinatura ativa",
          "Escolha um plano para liberar recursos",
        ],
      };
  }
}
