import type { FeatureKey } from "@/lib/plans";

/**
 * Mapeamento centralizado de rotas para a feature premium que protege
 * aquela tela. O componente `AuthGate` usa esta lista para:
 *  - bloquear a renderização de telas premium quando o plano do usuário
 *    NÃO inclui o recurso;
 *  - exibir o modal padrão de "recurso premium" (mesmo visual usado em
 *    Investimentos), mantendo a experiência consistente em todo o app.
 *
 * A lista é apenas a camada de UI/roteamento. A regra de fato é
 * `planAllowsFeature(plan, feature)` em `src/lib/plans.ts`. Admin Master
 * e usuários com role `owner`/`admin` ignoram este bloqueio.
 */
export type PremiumRouteRule = {
  /** Match exato OU prefixo (`/foo` casa `/foo` e `/foo/bar`). */
  path: string;
  feature: FeatureKey;
  /** Título exibido no modal de bloqueio. */
  title: string;
  /** Descrição opcional; cai num texto padrão se omitida. */
  description?: string;
};

const DEFAULT_DESCRIPTION =
  "Este recurso está disponível apenas em planos elegíveis. Escolha um plano para liberar esse recurso.";

export const PREMIUM_ROUTE_RULES: PremiumRouteRule[] = [
  { path: "/investimentos", feature: "investimentos", title: "Investimentos é um recurso premium" },
  { path: "/cartoes", feature: "cartoes", title: "Cartões e faturas é um recurso premium" },
  { path: "/assinaturas", feature: "assinaturas_recorrencias", title: "Assinaturas é um recurso premium" },
  { path: "/contas-a-pagar", feature: "contas_a_pagar", title: "Contas a pagar é um recurso premium" },
  { path: "/contas-a-receber", feature: "contas_a_receber", title: "Contas a receber é um recurso premium" },
  { path: "/orcamento", feature: "orcamento", title: "Orçamento é um recurso premium" },
  { path: "/relatorios", feature: "relatorios_avancados", title: "Relatórios avançados é um recurso premium" },
  { path: "/gasto-ai", feature: "gasto_ai", title: "Gasto Inteligente AI é um recurso premium", description: "Converse com uma IA sobre seus gastos, metas e organização financeira. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  // Etapa 66 — /metas é liberada para todos os planos pagos (metas básicas).
  // O gate de `metas_visuais` permanece DENTRO do MetaForm para proteger
  // upload de capa / galeria / visual personalizado. Não bloqueamos a rota
  // inteira para não barrar o Controle Simples Pessoal por URL direta.
  { path: "/whatsapp", feature: "whatsapp", title: "WhatsApp é um recurso premium" },
  { path: "/renda", feature: "lancamentos_ilimitados", title: "Receitas é um recurso premium" },
  { path: "/guardado", feature: "lancamentos_ilimitados", title: "Guardado é um recurso premium" },
  { path: "/contas-conectadas", feature: "contas_conectadas", title: "Contas conectadas é um recurso premium", description: "Convide outra pessoa por e-mail e acompanhe a conta dela com autorização. Disponível nos planos Controle Completo Pessoal, MEI e Empresa." },
  { path: "/empresa", feature: "empresa_inteligente", title: "Empresa Inteligente é um recurso para MEI e Empresa", description: "Consulte seu CNPJ e mantenha os dados da sua empresa organizados no Gasto Inteligente. Disponível nos planos Essencial para MEI, MEI Completo e Empresa." },
  { path: "/fornecedores", feature: "empresa_inteligente", title: "Fornecedores é um recurso para MEI e Empresa", description: "Cadastre fornecedores por CNPJ e organize melhor seus gastos empresariais. Disponível nos planos Essencial para MEI, MEI Completo e Empresa." },
  { path: "/clientes", feature: "empresa_inteligente", title: "Clientes é um recurso para MEI e Empresa", description: "Cadastre clientes por CNPJ e organize melhor suas receitas empresariais. Disponível nos planos Essencial para MEI, MEI Completo e Empresa." },
  { path: "/contador", feature: "empresa_inteligente", title: "Pacote para Contador é um recurso para MEI e Empresa", description: "Gere um resumo mensal organizado para enviar ao seu contador. Disponível nos planos Essencial para MEI, MEI Completo e Empresa." },
  // Etapa 16 — Mercado Inteligente avançado.
  { path: "/mercado/historico", feature: "mercado_avancado", title: "Histórico de compras é um recurso premium", description: "Acompanhe suas compras anteriores e a evolução dos gastos de mercado. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/precos", feature: "mercado_avancado", title: "Comparação de preços é um recurso premium", description: "Compare preços por mercado usando o seu histórico local. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/precos-historico", feature: "mercado_avancado", title: "Histórico de preços é um recurso premium", description: "Veja a evolução de preços dos itens que você compra com frequência. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/cesta", feature: "mercado_avancado", title: "Cesta padrão é um recurso premium", description: "Monte uma cesta recorrente com os itens que você compra todo mês. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/meus-mercados", feature: "mercado_avancado", title: "Meus mercados é um recurso premium", description: "Cadastre os mercados onde você costuma comprar e marque favoritos. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/mercados", feature: "mercado_avancado", title: "Comparativo por mercado é um recurso premium", description: "Descubra onde você costuma pagar melhores preços. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
  { path: "/mercado/importar-cupom", feature: "mercado_importar_cupom", title: "Importação de cupom é um recurso premium", description: "Importe informações de cupons fiscais por QR Code/NFC-e para reduzir lançamentos manuais. Disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa." },
];

export function findPremiumRule(pathname: string): PremiumRouteRule | null {
  for (const rule of PREMIUM_ROUTE_RULES) {
    if (pathname === rule.path || pathname.startsWith(rule.path + "/")) {
      return rule;
    }
  }
  return null;
}

export function premiumDescription(rule: PremiumRouteRule): string {
  return rule.description ?? DEFAULT_DESCRIPTION;
}

/**
 * Mapeia FeatureKey -> chave em `common.premium.routeLocks.*` (i18n).
 * Usado por AuthGate/PremiumLockModal para títulos/descrições amigáveis
 * e traduzidos quando o usuário acessa rota premium por URL direta.
 */
const FEATURE_TO_ROUTE_LOCK_KEY: Partial<Record<FeatureKey, string>> = {
  investimentos: "investimentos",
  cartoes: "cartoes",
  assinaturas_recorrencias: "assinaturas",
  contas_a_pagar: "contasAPagar",
  contas_a_receber: "contasAReceber",
  orcamento: "orcamento",
  relatorios_avancados: "relatorios",
  gasto_ai: "gastoAi",
  metas_visuais: "metas",
  whatsapp: "whatsapp",
  lancamentos_ilimitados: "renda",
  contas_conectadas: "contasConectadas",
  empresa_inteligente: "empresa",
  mercado_avancado: "mercadoAvancado",
  mercado_importar_cupom: "mercadoImportarCupom",
  importacoes: "importacoes",
};

export function routeLockI18nKey(feature: FeatureKey): string | null {
  return FEATURE_TO_ROUTE_LOCK_KEY[feature] ?? null;
}
