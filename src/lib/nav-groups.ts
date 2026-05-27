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
      { to: "/contas-a-pagar", labelKey: "contasPagar", descKey: "contasPagar", icon: CalendarClock },
      { to: "/contas-a-receber", labelKey: "contasReceber", descKey: "contasReceber", icon: HandCoins },
      { to: "/assinaturas", labelKey: "assinaturas", descKey: "assinaturas", icon: Repeat, feature: "assinaturas_recorrencias" },
      { to: "/orcamento", labelKey: "orcamento", descKey: "orcamento", icon: PieChart, feature: "orcamento" },
      { to: "/mercado", labelKey: "mercado", descKey: "mercado", icon: ShoppingCart },
    ],
  },
  {
    id: "planejamento",
    labelKey: "groups.planejamento",
    items: [
      { to: "/cartoes", labelKey: "cartoes", descKey: "cartoes", icon: CreditCard, feature: "cartoes" },
      { to: "/investimentos", labelKey: "investimentos", descKey: "investimentos", icon: TrendingUp, feature: "investimentos" },
      { to: "/metas", labelKey: "metas", descKey: "metas", icon: Target, feature: "metas_visuais" },
      { to: "/guardado", labelKey: "guardado", descKey: "guardado", icon: Wallet },
    ],
  },
  {
    id: "empresa",
    labelKey: "groups.empresa",
    items: [
      { to: "/empresa", labelKey: "empresa", descKey: "empresa", icon: Building2, feature: "empresa_inteligente" },
      { to: "/fornecedores", labelKey: "fornecedores", descKey: "fornecedores", icon: Store, feature: "empresa_inteligente" },
      { to: "/clientes", labelKey: "clientes", descKey: "clientes", icon: Contact, feature: "empresa_inteligente" },
      { to: "/contador", labelKey: "contador", descKey: "contador", icon: ClipboardList, feature: "empresa_inteligente" },
    ],
  },
  {
    id: "insights",
    labelKey: "groups.insights",
    items: [
      { to: "/relatorios", labelKey: "relatorios", descKey: "relatorios", icon: BarChart3, feature: "relatorios_avancados" },
      { to: "/alertas", labelKey: "alertas", descKey: "alertas", icon: Bell },
      { to: "/radar", labelKey: "radar", descKey: "radar", icon: Globe },
      { to: "/gasto-ai", labelKey: "gastoAi", descKey: "gastoAi", icon: Sparkles, feature: "gasto_ai" },
    ],
  },
  {
    id: "conexoes",
    labelKey: "groups.conexoes",
    items: [
      { to: "/whatsapp", labelKey: "whatsapp", descKey: "whatsapp", icon: Bell, feature: "whatsapp" },
      { to: "/contas-conectadas", labelKey: "contasConectadas", descKey: "contasConectadas", icon: Users, feature: "contas_conectadas" },
    ],
  },
  {
    id: "conta",
    labelKey: "groups.conta",
    items: [
      { to: "/app/cofre-pessoal", labelKey: "cofrePessoal", descKey: "cofrePessoal", icon: LockKeyhole },
      { to: "/meu-plano", labelKey: "meuPlano", descKey: "meuPlano", icon: Crown },
      { to: "/categorias", labelKey: "categorias", descKey: "categorias", icon: Settings2 },
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
