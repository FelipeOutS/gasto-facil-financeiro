// Definições de planos e checagem de permissões.
// Permissões NÃO dependem de CPF, e-mail visível ou texto da UI:
// são derivadas do plano efetivo, calculado de forma centralizada.

import type { TipoCadastro } from "./profile-utils";

/**
 * Tiers de plano. `free` permanece apenas para compatibilidade interna
 * (registros antigos), mas NÃO é exibido como plano comercial.
 *
 * `mei` é mantido como alias legado e mapeado para `mei_essencial`.
 */
export type PlanTier =
  | "free"
  | "sem_assinatura"
  | "free_ads"
  | "pessoal_manual"
  | "pessoal_premium"
  | "mei_essencial"
  | "mei_inteligente"
  | "empresa"
  | "admin_master";

/** Estados de assinatura visíveis na UI e usados na lógica de bloqueio. */
export type SubscriptionStatus =
  | "ativo"
  | "teste"
  | "aguardando_pagamento"
  | "expirado"
  | "cancelado"
  | "sem_assinatura";

export type FeatureKey =
  | "importar_extrato"
  | "importar_fatura"
  | "importar_conta"
  | "importacoes"
  | "relatorios_avancados"
  | "contas_a_pagar"
  | "contas_a_receber"
  | "contas_a_receber_avancado"
  | "cartoes"
  | "metas_visuais"
  | "orcamento"
  | "perfil_empresarial"
  | "perfil_cnpj"
  | "centro_de_custo"
  | "recursos_mei"
  | "recursos_empresa"
  | "investimentos"
  | "investimentos_futuro"
  | "assinaturas_recorrencias"
  | "whatsapp"
  | "lancamentos_ilimitados"
  | "contas_conectadas"
  | "gasto_ai"
  | "empresa_inteligente"
  | "cofre_pessoal"
  | "mercado_avancado"
  | "mercado_importar_cupom"
  // Fase 1E-B2B — features básicas para free_ads (também liberadas em planos pagos).
  // NÃO confundir com as features pagas equivalentes (cartoes, orcamento, etc.):
  // estas são versões limitadas, sujeitas a quota server-side em free_ads.
  | "gastos_basico"
  | "receitas_basico"
  | "mercado_basico"
  | "cartoes_basico"
  | "orcamento_basico"
  | "metas_basico";

/** Lista de features básicas (free_ads + planos pagos). */
export const BASIC_FEATURES: ReadonlyArray<FeatureKey> = [
  "gastos_basico",
  "receitas_basico",
  "mercado_basico",
  "cartoes_basico",
  "orcamento_basico",
  "metas_basico",
] as const;

export function isBasicFeature(feature: FeatureKey): boolean {
  return (BASIC_FEATURES as ReadonlyArray<FeatureKey>).includes(feature);
}

export const PLAN_LABEL: Record<PlanTier, string> = {
  free: "Sem assinatura",
  sem_assinatura: "Sem assinatura",
  free_ads: "Gratuito com anúncios",
  pessoal_manual: "Controle Simples Pessoal",
  pessoal_premium: "Controle Completo Pessoal",
  mei_essencial: "Essencial para MEI",
  mei_inteligente: "MEI Completo",
  empresa: "Empresa",
  admin_master: "Admin Master",
};

export const PLAN_ORDER: Record<PlanTier, number> = {
  sem_assinatura: 0,
  free: 0,
  // free_ads fica acima de sem_assinatura, mas abaixo de qualquer plano pago,
  // de forma que `planAllowsFeature` por escala linear continue NÃO liberando
  // features pagas (todas têm min >= pessoal_manual = 1).
  free_ads: 0.5,
  pessoal_manual: 1,
  pessoal_premium: 2,
  mei_essencial: 3,
  mei_inteligente: 4,
  empresa: 5,
  admin_master: 99,
};

// Plano mínimo necessário para cada recurso.
const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = {
  // Recursos básicos -> a partir do Controle Simples Pessoal
  contas_a_pagar: "pessoal_manual",
  contas_a_receber: "pessoal_manual",
  cartoes: "pessoal_manual",
  orcamento: "pessoal_manual",
  lancamentos_ilimitados: "pessoal_manual",
  // Recursos premium -> a partir do Controle Completo Pessoal
  importar_extrato: "pessoal_premium",
  importar_fatura: "pessoal_premium",
  importar_conta: "pessoal_premium",
  importacoes: "pessoal_premium",
  relatorios_avancados: "pessoal_premium",
  metas_visuais: "pessoal_premium",
  investimentos: "pessoal_premium",
  investimentos_futuro: "pessoal_premium",
  assinaturas_recorrencias: "pessoal_premium",
  contas_a_receber_avancado: "pessoal_premium",
  whatsapp: "pessoal_premium",
  // Recursos por tipo
  recursos_mei: "mei_essencial",
  perfil_empresarial: "empresa",
  perfil_cnpj: "empresa",
  recursos_empresa: "empresa",
  centro_de_custo: "empresa",
  contas_conectadas: "pessoal_premium",
  gasto_ai: "pessoal_premium",
  empresa_inteligente: "mei_essencial",
  // Etapa 14 — Cofre Pessoal vira recurso premium.
  cofre_pessoal: "pessoal_premium",
  // Etapa 16 — Mercado Inteligente avançado e importação de cupom.
  mercado_avancado: "pessoal_premium",
  mercado_importar_cupom: "pessoal_premium",
  // Fase 1E-B2B — features básicas. min = free_ads (whitelist abaixo fixa
  // os planos exatos; o min é só fallback para a escala linear).
  gastos_basico: "free_ads",
  receitas_basico: "free_ads",
  mercado_basico: "free_ads",
  cartoes_basico: "free_ads",
  orcamento_basico: "free_ads",
  metas_basico: "free_ads",
};

/**
 * Whitelist explícita de planos por feature, quando a regra não é uma
 * escala linear. Se a feature está aqui, só os planos listados liberam.
 */
const FEATURE_PLAN_WHITELIST: Partial<Record<FeatureKey, PlanTier[]>> = {
  // Investimentos: somente planos premium específicos
  investimentos: ["pessoal_premium", "mei_inteligente", "empresa"],
  investimentos_futuro: ["pessoal_premium", "mei_inteligente", "empresa"],
  // Importações automáticas: só nos premium e MEI Completo / Empresa
  importacoes: ["pessoal_premium", "mei_inteligente", "empresa"],
  importar_extrato: ["pessoal_premium", "mei_inteligente", "empresa"],
  importar_fatura: ["pessoal_premium", "mei_inteligente", "empresa"],
  importar_conta: ["pessoal_premium", "mei_inteligente", "empresa"],
  // Centro de custo e CNPJ: só Empresa
  centro_de_custo: ["empresa"],
  perfil_cnpj: ["empresa"],
  perfil_empresarial: ["empresa"],
  recursos_empresa: ["empresa"],
  // MEI: somente planos MEI
  recursos_mei: ["mei_essencial", "mei_inteligente"],
  // Contas a receber avançado: premium e MEI Completo / Empresa
  contas_a_receber_avancado: ["pessoal_premium", "mei_inteligente", "empresa"],
  // Contas conectadas: somente planos premium e MEI / Empresa
  contas_conectadas: ["pessoal_premium", "mei_essencial", "mei_inteligente", "empresa"],
  gasto_ai: ["pessoal_premium", "mei_inteligente", "empresa"],
  // Etapa 7.1 — WhatsApp ainda não está ativo comercialmente.
  // Mantido como recurso futuro: nenhum plano comercial libera no menu.
  // Apenas Admin Master (tratado fora da whitelist) consegue acessar para QA.
  whatsapp: [],

  // Empresa Inteligente (consulta de CNPJ e Minha Empresa): MEI e Empresa
  empresa_inteligente: ["mei_essencial", "mei_inteligente", "empresa"],

  // Etapa 14 — Cofre Pessoal: planos pagos exceto Controle Simples.
  cofre_pessoal: ["pessoal_premium", "mei_essencial", "mei_inteligente", "empresa"],

  // Etapa 16 — Mercado Inteligente avançado (histórico, preços, cesta padrão,
  // mercados favoritos, comparação de preços). MEI Essencial fica de fora
  // para não canibalizar o MEI Completo.
  mercado_avancado: ["pessoal_premium", "mei_inteligente", "empresa"],
  // Etapa 16 — Importação de cupom fiscal / NFC-e / QR Code.
  mercado_importar_cupom: ["pessoal_premium", "mei_inteligente", "empresa"],
};

export function planAllowsFeature(plan: PlanTier, feature: FeatureKey): boolean {
  if (plan === "admin_master") return true;
  const whitelist = FEATURE_PLAN_WHITELIST[feature];
  if (whitelist) return whitelist.includes(plan);
  const min = FEATURE_MIN_PLAN[feature];
  return PLAN_ORDER[plan] >= PLAN_ORDER[min];
}

export function minPlanFor(feature: FeatureKey): PlanTier {
  return FEATURE_MIN_PLAN[feature];
}

export function plansAllowingFeature(feature: FeatureKey): PlanTier[] {
  const whitelist = FEATURE_PLAN_WHITELIST[feature];
  if (whitelist) return whitelist;
  const min = FEATURE_MIN_PLAN[feature];
  return (Object.keys(PLAN_ORDER) as PlanTier[]).filter(
    (p) =>
      p !== "free" &&
      p !== "sem_assinatura" &&
      p !== "free_ads" &&
      PLAN_ORDER[p] >= PLAN_ORDER[min],
  );
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
 * - Admin Master por e-mail vence sempre.
 * - `mei` legado => `mei_essencial`.
 * - Sem registro válido => `sem_assinatura`.
 */
export function getEffectiveUserPlan(
  user: { email?: string | null } | null | undefined,
  storedPlan: string | null | undefined,
): PlanTier {
  if (isAdminMasterEmail(user?.email)) return "admin_master";
  const p = (storedPlan ?? "").toLowerCase();
  if (p === "pessoal") return "pessoal_manual";
  if (p === "mei") return "mei_essencial";
  if (p === "admin_master") return "admin_master";
  if (
    p === "pessoal_manual" ||
    p === "pessoal_premium" ||
    p === "mei_essencial" ||
    p === "mei_inteligente" ||
    p === "empresa"
  ) {
    return p as PlanTier;
  }
  return "sem_assinatura";
}

/** Plano sugerido para upgrade considerando o tipo de cadastro. */
export function suggestedUpgrade(
  current: PlanTier,
  tipo: TipoCadastro,
): PlanTier {
  if (current === "admin_master") return current;
  if (tipo === "empresa") return "empresa";
  if (tipo === "mei") return current === "mei_essencial" ? "mei_inteligente" : "mei_essencial";
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
  { feature: "contas_conectadas", label: "Contas conectadas", description: "Convide outra pessoa por e-mail e acompanhe a conta dela com autorização." },
];

/* ===========================================================
 * Catálogo comercial (sem plano Free)
 * =========================================================== */

export type CommercialPlan = {
  tier: PlanTier;
  name: string;
  /** Em centavos para uso no gateway. */
  priceCents: number;
  priceLabel: string;
  tagline: string;
  highlights: string[];
};

export const COMMERCIAL_PLANS: CommercialPlan[] = [
  {
    tier: "pessoal_manual",
    name: "Controle Simples Pessoal",
    priceCents: 2500,
    priceLabel: "R$ 25,00/mês",
    tagline: "Para quem quer organizar tudo manualmente.",
    highlights: [
      "Lançamentos manuais ilimitados",
      "Gastos, receitas e contas a pagar",
      "Contas a receber simples",
      "Metas, guardado e orçamento",
      "Relatórios básicos",
      "Sem importações automáticas",
    ],
  },
  {
    tier: "pessoal_premium",
    name: "Controle Completo Pessoal",
    priceCents: 5000,
    priceLabel: "R$ 50,00/mês",
    tagline: "Mais automação para o seu dia a dia.",
    highlights: [
      "Tudo do Controle Simples Pessoal",
      "Importar extrato, fatura e boleto/Pix",
      "Contas a receber completas",
      "Metas com imagens",
      "Relatórios avançados e insights",
      "Investimentos liberados",
      "Assinaturas e recorrências",
      "Contas conectadas por convite",
      "Histórico de importações",
    ],
  },
  {
    tier: "mei_essencial",
    name: "Essencial para MEI",
    priceCents: 3990,
    priceLabel: "R$ 39,90/mês",
    tagline: "O essencial para o seu MEI.",
    highlights: [
      "Tudo do Controle Simples Pessoal",
      "Empresa Inteligente: Minha Empresa, clientes e fornecedores",
      "Contas a pagar com fornecedor e a receber com cliente",
      "Relatórios por cliente e por fornecedor",
      "Pacote para Contador (resumo mensal)",
      "Radar Econômico: dólar, euro, Selic e IPCA",
      "Separação pessoal × negócio",
      "Contas conectadas por convite",
      "Sem importações automáticas",
    ],
  },
  {
    tier: "mei_inteligente",
    name: "MEI Completo",
    priceCents: 9000,
    priceLabel: "R$ 90,00/mês",
    tagline: "MEI com automação completa.",
    highlights: [
      "Tudo do Essencial para MEI",
      "Importar extrato, fatura e boleto/Pix",
      "Contas a receber avançadas",
      "Relatórios avançados do negócio",
      "Pacote para Contador com comparativo do mês anterior",
      "Radar Econômico: dólar, euro, Selic e IPCA",
      "Metas com imagens",
      "Investimentos liberados",
      "Histórico de importações",
      "Insights do negócio",
    ],
  },
  {
    tier: "empresa",
    name: "Empresa",
    priceCents: 18000,
    priceLabel: "R$ 180,00/mês",
    tagline: "Visão financeira completa para a sua empresa.",
    highlights: [
      "Tudo do MEI Completo",
      "Perfil empresarial com CNPJ",
      "Cadastro de clientes e fornecedores por CNPJ",
      "Relatórios completos por cliente e por fornecedor",
      "Pacote para Contador com comparativo do mês anterior",
      "Radar Econômico: dólar, euro, Selic e IPCA",
      "Controle por centro de custo",
      "Fluxo de caixa empresarial",
      "Usuários e contas conectadas",
      "Controle de acessos por permissão",
      "Exportação de relatórios",
    ],
  },
];

export function commercialPlanByTier(tier: PlanTier): CommercialPlan | undefined {
  return COMMERCIAL_PLANS.find((p) => p.tier === tier);
}

/* ===========================================================
 * Periodicidade de pagamento (Mensal / Trimestral / Semestral / Anual)
 * - Pagamento único do período total (sem renovação automática).
 * - Descontos padrão: 0% / 5% / 10% / 20%.
 * =========================================================== */

export type Periodicidade = "mensal" | "trimestral" | "semestral" | "anual";

export type PeriodicidadeInfo = {
  key: Periodicidade;
  label: string;
  months: number;
  discountPercent: number;
  /** Texto curto exibido em badges/destaques. */
  badge?: string;
  /** Sufixo exibido junto ao preço total. */
  suffix: string;
};

export const PERIODICIDADES: PeriodicidadeInfo[] = [
  { key: "mensal", label: "Mensal", months: 1, discountPercent: 0, suffix: "/mês" },
  { key: "trimestral", label: "Trimestral", months: 3, discountPercent: 5, suffix: "a cada 3 meses" },
  { key: "semestral", label: "Semestral", months: 6, discountPercent: 10, badge: "Mais economia", suffix: "a cada 6 meses" },
  { key: "anual", label: "Anual", months: 12, discountPercent: 20, badge: "Melhor custo-benefício", suffix: "por ano" },
];

export function getPeriodicidade(key: Periodicidade): PeriodicidadeInfo {
  return PERIODICIDADES.find((p) => p.key === key) ?? PERIODICIDADES[0];
}

/** Retorna preço total (em centavos) para o plano com o período escolhido. */
export function priceForPeriod(plan: CommercialPlan, period: Periodicidade): {
  totalCents: number;
  baseCents: number;
  discountCents: number;
  discountPercent: number;
  months: number;
} {
  const info = getPeriodicidade(period);
  const baseCents = plan.priceCents * info.months;
  const totalCents = Math.round(baseCents * (1 - info.discountPercent / 100));
  return {
    totalCents,
    baseCents,
    discountCents: baseCents - totalCents,
    discountPercent: info.discountPercent,
    months: info.months,
  };
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function planSummary(plan: PlanTier): { highlights: string[] } {
  if (plan === "admin_master") {
    return { highlights: ["Acesso total", "Sem limites", "Todos os recursos atuais e futuros"] };
  }
  const c = commercialPlanByTier(plan);
  if (c) return { highlights: c.highlights };
  return {
    highlights: ["Sem assinatura ativa", "Escolha um plano para liberar recursos"],
  };
}
