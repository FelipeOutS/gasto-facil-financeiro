import { Link, useLocation } from "@tanstack/react-router";
import { Home, List, Wallet, Target, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Início", icon: Home },
  { to: "/gastos", label: "Gastos", icon: List },
  { to: "/guardado", label: "Guardado", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/categorias", label: "Ajustes", icon: Settings2 },
] as const;

export function BottomNav() {
  const location = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 backdrop-blur-xl safe-bottom lg:hidden"
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-2">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]")}
                  strokeWidth={active ? 2.4 : 1.8}
                />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
