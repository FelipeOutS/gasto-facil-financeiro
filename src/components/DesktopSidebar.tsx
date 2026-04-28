import { Link, useLocation } from "@tanstack/react-router";
import {
  Home,
  List,
  Wallet,
  Target,
  Settings2,
  CalendarClock,
  ArrowUp,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertaContas } from "@/lib/contas-alertas";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
};

const ITEMS: NavItem[] = [
  { to: "/", label: "Início", icon: Home, exact: true },
  { to: "/gastos", label: "Gastos", icon: List },
  { to: "/renda", label: "Minha renda", icon: ArrowUp },
  { to: "/contas-a-pagar", label: "Contas a pagar", icon: CalendarClock },
  { to: "/guardado", label: "Guardado", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/categorias", label: "Ajustes", icon: Settings2 },
];

export function DesktopSidebar() {
  const location = useLocation();

  return (
    <aside
      className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border/60 lg:bg-card/40 lg:backdrop-blur-xl"
      aria-label="Navegação lateral"
    >
      <div className="px-5 pt-6 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Gasto Fácil
        </p>
        <h2 className="mt-1 text-lg font-bold tracking-tight">Controle financeiro</h2>
      </div>

      <Link
        to="/adicionar"
        className="mx-4 mb-4 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-90 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        Adicionar gasto
      </Link>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {ITEMS.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? location.pathname === to
              : location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground shadow-card"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn("h-4 w-4 shrink-0", active && "text-foreground")}
                    strokeWidth={active ? 2.4 : 1.8}
                  />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-5 py-4 text-[10px] text-muted-foreground/70">
        © Gasto Fácil
      </div>
    </aside>
  );
}
