import {
  List,
  ShoppingCart,
  ArrowUp,
  CalendarClock,
  HandCoins,
  Repeat,
  PieChart,
  CreditCard,
  TrendingUp,
  Target,
  Wallet,
  Building2,
  Store,
  Contact,
  ClipboardList,
  Bell,
  Users,
  Crown,
  Settings2,
  Sparkles,
  BarChart3,
  Globe,
  Plug,
  Shield,
  LockKeyhole,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@/lib/plans";

export type NavLeaf = {
  to: string;
  labelKey: string;
  descKey?: string;
  icon: LucideIcon;
  feature?: FeatureKey;
};

export type NavGroup = {
  id: string;
  labelKey: string;
  items: NavLeaf[];
  /** Visível apenas para Admin Master */
  adminMasterOnly?: boolean;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "financeiro",
    labelKey: "groups.financeiro",
    items: [
      { to: "/gastos", labelKey: "gastos", descKey: "gastos", icon: List },
      { to: "/renda", labelKey: "renda", descKey: "renda", icon: ArrowUp },
      {
        to: "/contas-a-pagar",
        labelKey: "contasPagar",
        descKey: "contasPagar",
        icon: CalendarClock,
      },
      {
        to: "/contas-a-receber",
        labelKey: "contasReceber",
        descKey: "contasReceber",
        icon: HandCoins,
      },
      { to: "/assinaturas", labelKey: "assinaturas", descKey: "assinaturas", icon: Repeat },
      {
        to: "/orcamento",
        labelKey: "orcamento",
        descKey: "orcamento",
        icon: PieChart,
        feature: "orcamento_basico",
      },
      { to: "/mercado", labelKey: "mercado", descKey: "mercado", icon: ShoppingCart },
    ],
  },
  {
    id: "planejamento",
    labelKey: "groups.planejamento",
    items: [
      {
        to: "/cartoes",
        labelKey: "cartoes",
        descKey: "cartoes",
        icon: CreditCard,
        feature: "cartoes_basico",
      },
      {
        to: "/investimentos",
        labelKey: "investimentos",
        descKey: "investimentos",
        icon: TrendingUp,
        feature: "investimentos",
      },
      {
        to: "/bens",
        labelKey: "bens",
        descKey: "bens",
        icon: Landmark,
      },
      { to: "/metas", labelKey: "metas", descKey: "metas", icon: Target },
      { to: "/guardado", labelKey: "guardado", descKey: "guardado", icon: Wallet },
    ],
  },
  {
    id: "empresa",
    labelKey: "groups.empresa",
    items: [
      {
        to: "/empresa",
        labelKey: "empresa",
        descKey: "empresa",
        icon: Building2,
        feature: "empresa_inteligente",
      },
      {
        to: "/fornecedores",
        labelKey: "fornecedores",
        descKey: "fornecedores",
        icon: Store,
        feature: "empresa_inteligente",
      },
      {
        to: "/clientes",
        labelKey: "clientes",
        descKey: "clientes",
        icon: Contact,
        feature: "empresa_inteligente",
      },
      {
        to: "/contador",
        labelKey: "contador",
        descKey: "contador",
        icon: ClipboardList,
        feature: "empresa_inteligente",
      },
    ],
  },
  {
    id: "insights",
    labelKey: "groups.insights",
    items: [
      {
        to: "/relatorios",
        labelKey: "relatorios",
        descKey: "relatorios",
        icon: BarChart3,
        feature: "relatorios_avancados",
      },
      { to: "/alertas", labelKey: "alertas", descKey: "alertas", icon: Bell },
      { to: "/radar", labelKey: "radar", descKey: "radar", icon: Globe },
      {
        to: "/gasto-ai",
        labelKey: "gastoAi",
        descKey: "gastoAi",
        icon: Sparkles,
        feature: "gasto_ai",
      },
    ],
  },
  {
    id: "conexoes",
    labelKey: "groups.conexoes",
    items: [
      {
        to: "/whatsapp",
        labelKey: "whatsapp",
        descKey: "whatsapp",
        icon: Bell,
        feature: "whatsapp",
      },
      {
        to: "/contas-conectadas",
        labelKey: "contasConectadas",
        descKey: "contasConectadas",
        icon: Users,
        feature: "contas_conectadas",
      },
    ],
  },
  {
    id: "conta",
    labelKey: "groups.conta",
    items: [
      {
        to: "/app/cofre-pessoal",
        labelKey: "cofrePessoal",
        descKey: "cofrePessoal",
        icon: LockKeyhole,
        feature: "cofre_pessoal",
      },
      { to: "/meu-plano", labelKey: "meuPlano", descKey: "meuPlano", icon: Crown },
      { to: "/app/ajustes", labelKey: "categorias", descKey: "categorias", icon: Settings2 },
    ],
  },
  {
    id: "admin",
    labelKey: "groups.adminMaster",
    adminMasterOnly: true,
    items: [
      { to: "/app/integracoes", labelKey: "integracoes", descKey: "integracoes", icon: Plug },
      { to: "/admin", labelKey: "admin", descKey: "admin", icon: Shield },
    ],
  },
];

/**
 * Etapa 7 — Navegação dinâmica por plano.
 * Filtra os grupos do menu mantendo apenas itens que o usuário pode acessar.
 * Itens sem `feature` continuam visíveis. Admin Master vê tudo.
 */
export function filterVisibleGroups(
  groups: NavGroup[],
  can: (f: FeatureKey) => boolean,
  isAdminMaster: boolean,
  tipoCadastro?: TipoCadastro,
): NavGroup[] {
  if (isAdminMaster) return groups;
  return groups
    .filter((g) => {
      // Ocultar grupo "Empresa" para Pessoa Física
      if (g.id === "empresa" && tipoCadastro === "pessoa_fisica") return false;
      return true;
    })
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !it.feature || can(it.feature)),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Lista itens bloqueados (com `feature` indisponível no plano atual),
 * usados nos cards de upgrade em Dashboard / Meu Plano.
 *
 * WhatsApp é tratado como recurso futuro (whitelist vazia em plans.ts)
 * e NÃO deve aparecer em cards de upgrade comerciais. Filtramos aqui.
 */
const UPGRADE_CARD_FEATURE_BLOCKLIST: ReadonlyArray<FeatureKey> = ["whatsapp"];

export function getLockedNavItems(
  groups: NavGroup[],
  can: (f: FeatureKey) => boolean,
  isAdminMaster: boolean,
): NavLeaf[] {
  if (isAdminMaster) return [];
  return groups
    .filter((g) => !g.adminMasterOnly)
    .flatMap((g) =>
      g.items.filter(
        (it) =>
          !!it.feature && !UPGRADE_CARD_FEATURE_BLOCKLIST.includes(it.feature) && !can(it.feature),
      ),
    );
}
