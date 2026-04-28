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
  PieChart,
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
  { to: "/orcamento", label: "Orçamento", icon: PieChart },
  { to: "/guardado", label: "Guardado", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/categorias", label: "Ajustes", icon: Settings2 },
];

export function DesktopSidebar() {
  const location = useLocation();
  const alerta = useAlertaContas();

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
            const showDot = to === "/contas-a-pagar" && alerta !== "nenhum";
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 hover-lift",
                    active
                      ? "bg-brand-soft text-brand-on-soft shadow-card"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand"
                    />
                  )}
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
                  <span className="truncate">{label}</span>
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

      <div className="px-5 py-4 text-[10px] text-muted-foreground/70">
        © Gasto Fácil
      </div>
    </aside>
  );
}
