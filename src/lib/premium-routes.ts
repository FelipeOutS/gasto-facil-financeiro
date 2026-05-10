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
  { path: "/gasto-ai", feature: "gasto_ai", title: "Gasto Inteligente AI é um recurso premium", description: "Converse com uma IA sobre seus gastos, metas e organização financeira. Disponível nos planos Pessoa Física Premium, MEI Inteligente e Empresa." },
  { path: "/metas", feature: "metas_visuais", title: "Metas é um recurso premium" },
  { path: "/whatsapp", feature: "whatsapp", title: "WhatsApp é um recurso premium" },
  { path: "/renda", feature: "lancamentos_ilimitados", title: "Minha renda é um recurso premium" },
  { path: "/guardado", feature: "lancamentos_ilimitados", title: "Guardado é um recurso premium" },
  { path: "/contas-conectadas", feature: "contas_conectadas", title: "Contas conectadas é um recurso premium", description: "Convide outra pessoa por e-mail e acompanhe a conta dela com autorização. Disponível nos planos Pessoa Física Premium, MEI e Empresa." },
  { path: "/gasto-ai", feature: "gasto_ai", title: "Gasto Inteligente AI é um recurso premium", description: "Converse com uma IA sobre seus gastos, receitas, metas, contas e organização financeira. Este recurso está disponível nos planos Pessoa Física Premium, MEI Inteligente e Empresa." },
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
