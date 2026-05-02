import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { Home, List, CreditCard, Target, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertaContas } from "@/lib/contas-alertas";
import { MoreSheet, MORE_PATHS } from "@/components/MoreSheet";

const TABS = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/gastos", label: "Gastos", icon: List },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/metas", label: "Metas", icon: Target },
] as const;

export function BottomNav() {
  const location = useLocation();
  const alerta = useAlertaContas();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const currentPath = optimisticPath ?? location.pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  function handleNavClick(to: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOptimisticPath(to);
  }

  const moreActive = MORE_PATHS.some(
    (p) => currentPath === p || currentPath.startsWith(p + "/"),
  );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 backdrop-blur-xl safe-bottom lg:hidden"
        aria-label="Navegação principal"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-2">
          {TABS.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/" ? currentPath === "/" : currentPath.startsWith(to);
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
                  <span>{label}</span>
                  {showDot && (
                    <span className="sr-only">
                      {alerta === "vermelho"
                        ? "Há contas atrasadas"
                        : "Há contas vencendo em breve"}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-all duration-200 active:scale-95",
                moreActive ? "text-brand" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Abrir mais opções"
            >
              {moreActive && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-brand"
                />
              )}
              <LayoutGrid
                className={cn("h-5 w-5 transition-transform", moreActive && "scale-110")}
                strokeWidth={moreActive ? 2.4 : 1.8}
              />
              <span>Mais</span>
            </button>
          </li>
        </ul>
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
