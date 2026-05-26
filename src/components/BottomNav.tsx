import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Home, List, CreditCard, Menu, Plus, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertaContas } from "@/lib/contas-alertas";
import { MobileQuickActionsSheet } from "@/components/MobileQuickActionsSheet";

const LEFT_TABS = [
  { to: "/", labelKey: "dashboard", icon: Home },
  { to: "/gastos", labelKey: "gastos", icon: List },
] as const;

const RIGHT_TABS = [
  { to: "/cartoes", labelKey: "cartoes", icon: CreditCard },
  { to: "/app/mais", labelKey: "more", icon: Menu },
] as const;

// Substituto opcional para Relatórios — usuário pediu "Metas ou Relatórios".
// Mantemos Cartões (mais usado) à esquerda do FAB e Relatórios à direita.
const RIGHT_TABS_WITH_REPORTS = [
  { to: "/relatorios", labelKey: "relatorios", icon: BarChart3 },
  { to: "/app/mais", labelKey: "more", icon: Menu },
] as const;

export function BottomNav() {
  const { t } = useTranslation("nav");
  const location = useLocation();
  const alerta = useAlertaContas();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const currentPath = optimisticPath ?? location.pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  function handleNavClick(to: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const isActive = to === "/" ? currentPath === "/" : currentPath.startsWith(to);
    if (isActive) {
      event.preventDefault();
      return;
    }
    setOptimisticPath(to);
  }

  function renderTab({ to, labelKey, icon: Icon }: { to: string; labelKey: string; icon: typeof Home }) {
    const active =
      to === "/" ? currentPath === "/" : currentPath === to || currentPath.startsWith(to + "/");
    const showDot = to === "/" && alerta !== "nenhum";
    return (
      <li key={to} className="flex-1">
        <Link
          to={to}
          preload="intent"
          preloadDelay={0}
          onClick={(event) => handleNavClick(to, event)}
          className={cn(
            "relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-medium transition-all duration-200 active:scale-95",
            active ? "text-brand" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute -top-0.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-brand"
            />
          )}
          <span className="relative">
            <Icon
              className={cn("h-5 w-5 transition-transform", active && "scale-110")}
              strokeWidth={active ? 2.4 : 1.8}
            />
            {showDot && (
              <span
                aria-hidden
                className={cn(
                  "absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                  alerta === "vermelho" ? "bg-destructive" : "bg-warning",
                )}
              />
            )}
          </span>
          <span className="leading-none">{t(`items.${labelKey}`)}</span>
          {showDot && (
            <span className="sr-only">
              {alerta === "vermelho" ? t("aria.overdueAccounts") : t("aria.soonAccounts")}
            </span>
          )}
        </Link>
      </li>
    );
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur safe-bottom lg:hidden"
      style={{ position: "fixed", transform: "translate3d(0,0,0)" }}
      aria-label={t("aria.primary")}
    >
      <ul className="relative mx-auto flex max-w-md items-stretch justify-around px-1 pt-2">
        {LEFT_TABS.map(renderTab)}

        {/* FAB central — abre ações rápidas */}
        <li className="flex w-16 shrink-0 items-start justify-center">
          <MobileQuickActionsSheet
            trigger={
              <button
                type="button"
                aria-label="Ações rápidas"
                className="-mt-5 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95"
              >
                <Plus className="h-6 w-6" strokeWidth={2.6} />
              </button>
            }
          />
        </li>

        {RIGHT_TABS_WITH_REPORTS.map(renderTab)}
      </ul>
    </nav>
  );
}
