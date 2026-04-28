import { Link, useLocation } from "@tanstack/react-router";
import { Home, List, Wallet, Target, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertaContas } from "@/lib/contas-alertas";

const TABS = [
  { to: "/", label: "Início", icon: Home },
  { to: "/gastos", label: "Gastos", icon: List },
  { to: "/guardado", label: "Guardado", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/categorias", label: "Ajustes", icon: Settings2 },
] as const;

export function BottomNav() {
  const location = useLocation();
  const alerta = useAlertaContas();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 backdrop-blur-xl safe-bottom lg:hidden"
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-2">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          // O item "Início" mostra a bolinha porque é por lá que o usuário acessa
          // o card "Próximas contas" no dashboard.
          const showDot = to === "/" && alerta !== "nenhum";
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
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
      </ul>
    </nav>
  );
}
