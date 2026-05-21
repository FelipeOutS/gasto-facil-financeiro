import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Home, List, CreditCard, Target, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertaContas } from "@/lib/contas-alertas";

const TABS = [
  { to: "/", labelKey: "dashboard", icon: Home },
  { to: "/gastos", labelKey: "gastos", icon: List },
  { to: "/cartoes", labelKey: "cartoes", icon: CreditCard },
  { to: "/metas", labelKey: "metas", icon: Target },
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

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-background/95 safe-bottom lg:hidden"
      style={{ position: "fixed", transform: "translate3d(0,0,0)" }}
      aria-label={t("aria.primary")}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-2">
        {TABS.map(({ to, labelKey, icon: Icon }) => {
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
                  "relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-all duration-200 active:scale-95",
                  active ? "text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-brand"
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
                <span>{t(`items.${labelKey}`)}</span>
                {showDot && (
                  <span className="sr-only">
                    {alerta === "vermelho"
                      ? t("aria.overdueAccounts")
                      : t("aria.soonAccounts")}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
