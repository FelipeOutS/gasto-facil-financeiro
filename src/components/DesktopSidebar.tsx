import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import {
  Home,
  List,
  Wallet,
  Target,
  Settings2,
  CalendarClock,
  ArrowUp,
  Plus,
  Repeat,
  PieChart,
  CreditCard,
  BarChart3,
  Crown,
  TrendingUp,
  Lock,
  HandCoins,
  Bell,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { ConnectedAccountSwitcher } from "@/components/ConnectedAccountSwitcher";
import { useAlertaContas } from "@/lib/contas-alertas";
import { usePlan } from "@/lib/use-plan";

import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail, type FeatureKey } from "@/lib/plans";
import { Shield } from "lucide-react";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { UserAvatar } from "@/components/UserAvatar";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  feature?: FeatureKey;
};

const ROUTE_FEATURE: Record<string, { feature: FeatureKey; title: string }> = Object.fromEntries(
  PREMIUM_ROUTE_RULES.map((r) => [r.path, { feature: r.feature, title: r.title }]),
);

const ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: Home, exact: true },
  { to: "/gastos", label: "Gastos", icon: List },
  { to: "/alertas", label: "Alertas", icon: Bell },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/assinaturas", label: "Assinaturas", icon: Repeat },
  { to: "/investimentos", label: "Investimentos", icon: TrendingUp },
  { to: "/renda", label: "Minha renda", icon: ArrowUp },
  { to: "/contas-a-pagar", label: "Contas a pagar", icon: CalendarClock },
  { to: "/contas-a-receber", label: "Contas a receber", icon: HandCoins },
  { to: "/orcamento", label: "Orçamento", icon: PieChart },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/gasto-ai", label: "Gasto AI", icon: Sparkles, feature: "gasto_ai" },
  { to: "/guardado", label: "Guardado", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/contas-conectadas", label: "Contas conectadas", icon: Users, feature: "contas_conectadas" },
  { to: "/meu-plano", label: "Meu plano", icon: Crown },
  { to: "/categorias", label: "Ajustes", icon: Settings2 },
  { to: "/landing", label: "Conhecer o Gasto Inteligente", icon: Sparkles },
];

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const alerta = useAlertaContas();
  const { can } = usePlan();
  const [lockState, setLockState] = useState<{ open: boolean; title: string }>({ open: false, title: "" });
  const { user, profile } = useAuth();
  const isAdminMaster = isAdminMasterEmail(user?.email);
  const items: NavItem[] = isAdminMaster ? [...ITEMS, { to: "/admin", label: "Admin", icon: Shield }] : ITEMS;
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const currentPath = optimisticPath ?? location.pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  function handleNavClick(to: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOptimisticPath(to);
  }

  return (
    <aside
      className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border/60 lg:bg-card/40 lg:backdrop-blur-xl"
      aria-label="Navegação lateral"
    >
      <div className="px-5 pt-6 pb-4">
        <BrandMark className="h-10 w-auto" />
        <h2 className="mt-3 text-sm font-semibold tracking-tight text-muted-foreground">Controle financeiro</h2>
      </div>

      <div className="px-4 pb-3">
        <ConnectedAccountSwitcher />
      </div>

      <button
        type="button"
        onClick={() => {
          if (!canWrite) {
            requireSubscription("Para adicionar gastos, escolha um plano ativo.");
            return;
          }
          navigate({ to: "/adicionar" });
        }}
        className="card-press mx-4 mb-4 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-grad px-4 py-2.5 text-sm font-semibold shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        Adicionar gasto
      </button>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {items.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? currentPath === to
              : currentPath === to || currentPath.startsWith(to + "/");
            const showDot = to === "/contas-a-pagar" && alerta !== "nenhum";
            const routeRule = ROUTE_FEATURE[to];
            const locked = !isAdminMaster && !!routeRule && !can(routeRule.feature);
            const linkClasses = cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 hover-lift",
              active
                ? "bg-brand-soft text-brand-on-soft shadow-card"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            );
            const iconNode = (
              <span className="relative">
                <Icon
                  className={cn("h-4 w-4 shrink-0", active && "text-brand")}
                  strokeWidth={active ? 2.4 : 1.8}
                />
                {showDot && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-card",
                      alerta === "vermelho" ? "bg-destructive" : "bg-warning",
                    )}
                  />
                )}
              </span>
            );
            const labelNode = (
              <>
                <span className="truncate">{label}</span>
                {locked && <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground/70" />}
                {showDot && (
                  <span className="sr-only">
                    {alerta === "vermelho"
                      ? "Há contas atrasadas"
                      : "Há contas vencendo em breve"}
                  </span>
                )}
              </>
            );
            if (locked) {
              return (
                <li key={to}>
                  <button
                    type="button"
                    onClick={() => setLockState({ open: true, title: routeRule!.title })}
                    className={cn(linkClasses, "w-full text-left")}
                  >
                    {iconNode}
                    {labelNode}
                  </button>
                </li>
              );
            }
            return (
              <li key={to}>
                <Link
                  to={to}
                  preload="intent"
                  preloadDelay={0}
                  onClick={(event) => handleNavClick(to, event)}
                  className={linkClasses}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand"
                    />
                  )}
                  {iconNode}
                  {labelNode}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Link
        to="/conta"
        className="mx-3 mb-2 mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40"
      >
        <UserAvatar
          url={profile?.avatar_url}
          name={profile?.nome ?? profile?.responsavel_nome}
          email={user?.email}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {profile?.nome || profile?.responsavel_nome || user?.email?.split("@")[0] || "Usuário"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
        </div>
      </Link>
      <div className="px-5 pb-4 text-[10px] text-muted-foreground/70">
        © Gasto Inteligente
      </div>
      <PremiumLockModal
        open={lockState.open}
        onOpenChange={(v) => setLockState((s) => ({ ...s, open: v }))}
        title={lockState.title}
      />
    </aside>
  );
}
