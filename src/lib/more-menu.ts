import {
  ArrowUp,
  CalendarClock,
  HandCoins,
  PieChart,
  BarChart3,
  Wallet,
  Repeat,
  TrendingUp,
  Crown,
  Settings2,
  Sparkles,
  Bell,
  Shield,
  Users,
  Globe,
  Building2,
  Store,
  Contact,
  ClipboardList,
  Plug,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@/lib/plans";

export type MoreItem = {
  to: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  feature?: FeatureKey;
};

export const ADMIN_ITEM: MoreItem = {
  to: "/admin",
  labelKey: "admin",
  descKey: "admin",
  icon: Shield,
};
export const INTEGRACOES_ITEM: MoreItem = {
  to: "/app/integracoes",
  labelKey: "integracoes",
  descKey: "integracoes",
  icon: Plug,
};

export const MORE_ITEMS: MoreItem[] = [
  { to: "/alertas", labelKey: "alertas", descKey: "alertas", icon: Bell },
  { to: "/mercado", labelKey: "mercado", descKey: "mercado", icon: ShoppingCart },
  { to: "/renda", labelKey: "renda", descKey: "renda", icon: ArrowUp },
  { to: "/contas-a-pagar", labelKey: "contasPagar", descKey: "contasPagar", icon: CalendarClock },
  { to: "/contas-a-receber", labelKey: "contasReceber", descKey: "contasReceber", icon: HandCoins },
  { to: "/orcamento", labelKey: "orcamento", descKey: "orcamento", icon: PieChart },
  { to: "/relatorios", labelKey: "relatorios", descKey: "relatorios", icon: BarChart3 },
  { to: "/radar", labelKey: "radar", descKey: "radar", icon: Globe },
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
  { to: "/gasto-ai", labelKey: "gastoAi", descKey: "gastoAi", icon: Sparkles, feature: "gasto_ai" },
  { to: "/guardado", labelKey: "guardado", descKey: "guardado", icon: Wallet },
  {
    to: "/assinaturas",
    labelKey: "assinaturas",
    descKey: "assinaturas",
    icon: Repeat,
    feature: "assinaturas_recorrencias",
  },
  {
    to: "/investimentos",
    labelKey: "investimentos",
    descKey: "investimentos",
    icon: TrendingUp,
    feature: "investimentos",
  },
  {
    to: "/contas-conectadas",
    labelKey: "contasConectadas",
    descKey: "contasConectadas",
    icon: Users,
    feature: "contas_conectadas",
  },
  { to: "/meu-plano", labelKey: "meuPlano", descKey: "meuPlano", icon: Crown },
  { to: "/categorias", labelKey: "categorias", descKey: "categorias", icon: Settings2 },
];

export const MORE_PATHS = [...MORE_ITEMS.map((i) => i.to), ADMIN_ITEM.to, "/app/mais"];
