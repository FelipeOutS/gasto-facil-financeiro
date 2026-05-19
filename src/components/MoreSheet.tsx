import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
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
  Lock,
  Sparkles,
  Bell,
  Shield,
  Users,
  Globe,
  Building2,
  Store,
  Contact,
  ClipboardList,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import { PLAN_LABEL, type FeatureKey } from "@/lib/plans";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail } from "@/lib/plans";
import { useRoles } from "@/lib/use-roles";
import { ConnectedAccountSwitcher } from "@/components/ConnectedAccountSwitcher";
import { UserAvatar } from "@/components/UserAvatar";

const ROUTE_RULE = Object.fromEntries(PREMIUM_ROUTE_RULES.map((r) => [r.path, r]));

type MoreItem = {
  to: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  feature?: FeatureKey;
};

const ADMIN_ITEM: MoreItem = { to: "/admin", labelKey: "admin", descKey: "admin", icon: Shield };

export const MORE_ITEMS: MoreItem[] = [
  { to: "/alertas", labelKey: "alertas", descKey: "alertas", icon: Bell },
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
  { to: "/assinaturas", labelKey: "assinaturas", descKey: "assinaturas", icon: Repeat },
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
  { to: "/landing", labelKey: "landing", descKey: "landing", icon: Sparkles },
];

/** Rotas que pertencem ao painel "Mais" — usado para destacar a aba ativa. */
export const MORE_PATHS = [...MORE_ITEMS.map((i) => i.to), "/admin"];

const MORE_MENU_BOTTOM_OFFSET = 84;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function MoreSheet({ open, onOpenChange }: Props) {
  const { t } = useTranslation("nav");
  const router = useRouter();
  const navigate = useNavigate();
  const { plan, can, isTrialActive, trialDaysLeft } = usePlan();
  const { user, profile } = useAuth();
  const { hasFullAccess } = useRoles();
  const isAdminMaster = isAdminMasterEmail(user?.email);
  const items: MoreItem[] = useMemo(
    () => (isAdminMaster ? [...MORE_ITEMS, ADMIN_ITEM] : MORE_ITEMS),
    [isAdminMaster],
  );
  const [lockState, setLockState] = useState<{ open: boolean; title: string }>({
    open: false,
    title: "",
  });
  const [navigating, setNavigating] = useState(false);
  const historyPushedRef = useRef(false);

  const closeMenu = useCallback(() => {
    if (typeof window !== "undefined" && historyPushedRef.current) {
      historyPushedRef.current = false;
      window.history.back();
    }
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    window.history.pushState(
      { ...(window.history.state ?? {}), moreMenuOpen: true },
      "",
      window.location.href,
    );
    historyPushedRef.current = true;

    const handlePopState = () => {
      if (!historyPushedRef.current) return;
      historyPushedRef.current = false;
      onOpenChange(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeMenu]);

  const getRule = useCallback(
    (item: MoreItem) => {
      return (
        ROUTE_RULE[item.to] ??
        (item.feature
          ? {
              feature: item.feature,
              title: `${t(`items.${item.labelKey}`)} ${t("more.premiumSuffix")}`,
              path: item.to,
            }
          : null)
      );
    },
    [t],
  );

  const isLocked = useCallback(
    (item: MoreItem) => {
      if (isAdminMaster || hasFullAccess) return false;
      const rule = getRule(item);
      return rule ? !can(rule.feature) : false;
    },
    [can, getRule, hasFullAccess, isAdminMaster],
  );

  useEffect(() => {
    if (!open) return;
    items.forEach((item) => {
      if (isLocked(item)) return;
      router.preloadRoute({ to: item.to }).catch(() => {
        // Prefetch é uma otimização: falhas não devem bloquear o menu.
      });
    });
  }, [open, items, router, isLocked]);

  function handleItem(item: MoreItem) {
    if (navigating) return;
    if (isLocked(item)) {
      const rule = getRule(item)!;
      closeMenu();
      setLockState({ open: true, title: rule.title });
      return;
    }
    setNavigating(true);
    closeMenu();
    window.setTimeout(() => {
      navigate({ to: item.to }).finally(() => setNavigating(false));
    }, 60);
  }

  return (
    <>
      {open && (
          <div
            className="fixed inset-0 isolate lg:hidden"
            data-more-menu-root="true"
            style={{ zIndex: 2147483000 }}
          >
            <div
              className="absolute inset-0 z-0 bg-black/65"
              onClick={closeMenu}
              aria-hidden="true"
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="more-menu-title"
              className="fixed inset-x-3 z-10 flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-popover text-popover-foreground shadow-2xl shadow-black/40 lg:hidden"
              style={{ bottom: MORE_MENU_BOTTOM_OFFSET }}
            >
              <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
                <div className="min-w-0">
                  <h2 id="more-menu-title" className="text-lg font-semibold text-foreground">
                    {t("more.title")}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t("more.description")}</p>
                </div>
                <button
                  type="button"
                  onClick={closeMenu}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border/60 bg-card/70 text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-95"
                  aria-label="Fechar menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    window.setTimeout(() => navigate({ to: "/conta" }), 60);
                  }}
                  className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 text-left transition-colors hover:bg-card/90 active:scale-[0.99]"
                >
                  <UserAvatar
                    url={profile?.avatar_url}
                    name={profile?.nome ?? profile?.responsavel_nome}
                    email={user?.email}
                    size={42}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {profile?.nome ||
                        profile?.responsavel_nome ||
                        user?.email?.split("@")[0] ||
                        t("header.fallbackUser")}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
                  </div>
                </button>
                <ConnectedAccountSwitcher className="mb-2" />
                <div className="rounded-2xl border border-border/60 bg-card/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("more.currentPlan")}
                  </p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{PLAN_LABEL[plan]}</p>
                    {isTrialActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                        <Sparkles className="h-3 w-3" />
                        {t("more.trial", { days: trialDaysLeft })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2"
                style={{ paddingBottom: 24 }}
              >
                <div className="grid grid-cols-2 gap-3">
                  {items.map((item) => {
                    const locked = isLocked(item);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.to}
                        type="button"
                        onClick={() => handleItem(item)}
                        className={cn(
                          "group relative flex min-h-[116px] flex-col items-start gap-2 rounded-2xl border border-border/60 bg-card/70 p-3 text-left transition-all hover:border-border hover:bg-card/90 active:scale-[0.98]",
                        )}
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft/60 text-brand-on-soft">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="flex w-full items-center gap-1">
                          <span className="text-sm font-semibold leading-tight">
                            {t(`items.${item.labelKey}`)}
                          </span>
                          {locked && (
                            <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground/70" />
                          )}
                        </span>
                        <span className="text-[11px] leading-snug text-muted-foreground">
                          {t(`descriptions.${item.descKey}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
      )}
      <PremiumLockModal
        open={lockState.open}
        onOpenChange={(v) => setLockState((s) => ({ ...s, open: v }))}
        title={lockState.title}
      />
    </>
  );
}
