import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import { Home, Plus, Lock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { ConnectedAccountSwitcher } from "@/components/ConnectedAccountSwitcher";
import { useAlertaContas } from "@/lib/contas-alertas";
import { usePlan } from "@/lib/use-plan";
import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail } from "@/lib/plans";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { UserAvatar } from "@/components/UserAvatar";
import { NAV_GROUPS, type NavLeaf } from "@/lib/nav-groups";
import { ThemeToggle } from "@/components/ThemeToggle";

const ROUTE_FEATURE = Object.fromEntries(
  PREMIUM_ROUTE_RULES.map((r) => [r.path, { feature: r.feature, title: r.title }]),
);

const STORAGE_KEY = "gi-sidebar-groups-v1";

function readGroupState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeGroupState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function DesktopSidebar() {
  const { t } = useTranslation("nav");
  const location = useLocation();
  const navigate = useNavigate();
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const alerta = useAlertaContas();
  const { can } = usePlan();
  const [lockState, setLockState] = useState<{ open: boolean; title: string }>({ open: false, title: "" });
  const { user, profile } = useAuth();
  const isAdminMaster = isAdminMasterEmail(user?.email);

  const groups = useMemo(
    () => NAV_GROUPS.filter((g) => !g.adminMasterOnly || isAdminMaster),
    [isAdminMaster],
  );

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const currentPath = optimisticPath ?? location.pathname;

  // Group open state (persisted). Default open=true; group with active route stays open.
  const [openState, setOpenState] = useState<Record<string, boolean>>(() => readGroupState());

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  // Auto-open the group that contains the current route
  useEffect(() => {
    const activeGroup = groups.find((g) =>
      g.items.some((it) => currentPath === it.to || currentPath.startsWith(it.to + "/")),
    );
    if (activeGroup && openState[activeGroup.id] === false) {
      setOpenState((s) => {
        const next = { ...s, [activeGroup.id]: true };
        writeGroupState(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  function toggleGroup(id: string) {
    setOpenState((s) => {
      const next = { ...s, [id]: s[id] === undefined ? false : !s[id] };
      writeGroupState(next);
      return next;
    });
  }

  function isOpen(id: string): boolean {
    return openState[id] !== false;
  }

  function handleNavClick(to: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOptimisticPath(to);
  }

  function renderLeaf(item: NavLeaf) {
    const { to, labelKey, icon: Icon } = item;
    const active = currentPath === to || currentPath.startsWith(to + "/");
    const showDot = to === "/contas-a-pagar" && alerta !== "nenhum";
    const routeRule = ROUTE_FEATURE[to];
    const locked = !isAdminMaster && !!routeRule && !can(routeRule.feature);
    const label = t(`items.${labelKey}`);
    const linkClasses = cn(
      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
      active
        ? "bg-brand-soft text-brand-on-soft shadow-card"
        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
    );
    const iconNode = (
      <span className="relative">
        <Icon className={cn("h-4 w-4 shrink-0", active && "text-brand")} strokeWidth={active ? 2.4 : 1.8} />
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
          onClick={(e) => handleNavClick(to, e)}
          className={linkClasses}
        >
          {active && (
            <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />
          )}
          {iconNode}
          {labelNode}
        </Link>
      </li>
    );
  }

  const dashboardActive = currentPath === "/";

  return (
    <aside
      className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border/60 lg:bg-card/40 lg:backdrop-blur-xl"
      aria-label={t("aria.side")}
    >
      <div className="px-5 pt-6 pb-4">
        <BrandMark className="h-10 w-auto" />
        <h2 className="mt-3 text-sm font-semibold tracking-tight text-muted-foreground">{t("header.tagline")}</h2>
      </div>

      <div className="px-4 pb-3">
        <ConnectedAccountSwitcher />
      </div>

      <button
        type="button"
        onClick={() => {
          if (!canWrite) {
            requireSubscription(t("header.addExpenseRequiresPlan"));
            return;
          }
          navigate({ to: "/adicionar" });
        }}
        className="card-press mx-4 mb-4 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-grad px-4 py-2.5 text-sm font-semibold shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        {t("header.addExpense")}
      </button>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Dashboard fixo no topo */}
        <ul className="space-y-1">
          <li>
            <Link
              to="/"
              preload="intent"
              preloadDelay={0}
              onClick={(e) => handleNavClick("/", e)}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                dashboardActive
                  ? "bg-brand-soft text-brand-on-soft shadow-card"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {dashboardActive && (
                <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />
              )}
              <Home className={cn("h-4 w-4 shrink-0", dashboardActive && "text-brand")} strokeWidth={dashboardActive ? 2.4 : 1.8} />
              <span className="truncate">{t("items.dashboard")}</span>
            </Link>
          </li>
        </ul>

        <div className="mt-3 space-y-1">
          {groups.map((group) => {
            const open = isOpen(group.id);
            const hasActive = group.items.some(
              (it) => currentPath === it.to || currentPath.startsWith(it.to + "/"),
            );
            return (
              <div key={group.id} className="rounded-xl">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-widest transition-colors",
                    hasActive ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground",
                  )}
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      open ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </button>
                {open && <ul className="mt-1 space-y-1 pb-1">{group.items.map(renderLeaf)}</ul>}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="mx-3 mt-2">
        <ThemeToggle />
      </div>

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
            {profile?.nome || profile?.responsavel_nome || user?.email?.split("@")[0] || t("header.fallbackUser")}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
        </div>
      </Link>
      <div className="px-5 pb-4 text-[10px] text-muted-foreground/70">© Gasto Inteligente</div>
      <PremiumLockModal
        open={lockState.open}
        onOpenChange={(v) => setLockState((s) => ({ ...s, open: v }))}
        title={lockState.title}
      />
    </aside>
  );
}
