import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useRouter } from "@tanstack/react-router";
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
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import { PLAN_LABEL, type FeatureKey } from "@/lib/plans";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail } from "@/lib/plans";
import { useRoles } from "@/lib/use-roles";

const ROUTE_RULE = Object.fromEntries(
  PREMIUM_ROUTE_RULES.map((r) => [r.path, r]),
);

type MoreItem = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  feature?: FeatureKey;
};

const ADMIN_ITEM: MoreItem = { to: "/admin", label: "Admin", description: "Painel administrativo", icon: Shield };

export const MORE_ITEMS: MoreItem[] = [
  { to: "/alertas", label: "Alertas", description: "Avisos importantes do seu financeiro", icon: Bell },
  { to: "/renda", label: "Minha renda", description: "Receitas e fontes de renda", icon: ArrowUp },
  { to: "/contas-a-pagar", label: "Contas a pagar", description: "Despesas e vencimentos", icon: CalendarClock },
  { to: "/contas-a-receber", label: "Contas a receber", description: "Valores que você tem para receber", icon: HandCoins },
  { to: "/orcamento", label: "Orçamento", description: "Limites mensais por categoria", icon: PieChart },
  { to: "/relatorios", label: "Relatórios", description: "Análises e gráficos", icon: BarChart3 },
  { to: "/guardado", label: "Guardado", description: "Reserva e poupança", icon: Wallet },
  { to: "/assinaturas", label: "Assinaturas", description: "Serviços recorrentes", icon: Repeat },
  { to: "/investimentos", label: "Investimentos", description: "Carteira e rendimentos", icon: TrendingUp, feature: "investimentos" },
  { to: "/meu-plano", label: "Meu plano", description: "Assinatura e recursos", icon: Crown },
  { to: "/categorias", label: "Ajustes", description: "Preferências da conta", icon: Settings2 },
  { to: "/landing", label: "Conhecer o Gasto Inteligente", description: "Ver recursos, planos e novidades", icon: Sparkles },
];

/** Rotas que pertencem ao painel "Mais" — usado para destacar a aba ativa. */
export const MORE_PATHS = [...MORE_ITEMS.map((i) => i.to), "/admin"];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function MoreSheet({ open, onOpenChange }: Props) {
  const router = useRouter();
  const navigate = useNavigate();
  const { plan, can, isTrialActive, trialDaysLeft } = usePlan();
  const { user } = useAuth();
  const { hasFullAccess } = useRoles();
  const isAdminMaster = isAdminMasterEmail(user?.email);
  const items: MoreItem[] = useMemo(() => (isAdminMaster ? [...MORE_ITEMS, ADMIN_ITEM] : MORE_ITEMS), [isAdminMaster]);
  const [lockState, setLockState] = useState<{ open: boolean; title: string }>({ open: false, title: "" });
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    if (!open) return;
    items.forEach((item) => {
      if (isLocked(item)) return;
      router.preloadRoute({ to: item.to }).catch(() => {
        // Prefetch é uma otimização: falhas não devem bloquear o menu.
      });
    });
  }, [open, items, router, isAdminMaster, hasFullAccess, can]);

  function getRule(item: MoreItem) {
    return ROUTE_RULE[item.to] ?? (item.feature ? { feature: item.feature, title: `${item.label} é um recurso premium`, path: item.to } : null);
  }

  function isLocked(item: MoreItem) {
    if (isAdminMaster || hasFullAccess) return false;
    const rule = getRule(item);
    return rule ? !can(rule.feature) : false;
  }

  function handleItem(item: MoreItem) {
    if (navigating) return;
    if (isLocked(item)) {
      const rule = getRule(item)!;
      flushSync(() => onOpenChange(false));
      setLockState({ open: true, title: rule.title });
      return;
    }
    setNavigating(true);
    flushSync(() => onOpenChange(false));
    navigate({ to: item.to }).finally(() => setNavigating(false));
  }


  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          overlayClassName="data-[state=closed]:duration-0"
          className="h-[75vh] rounded-t-3xl border-t border-border/60 bg-background/95 backdrop-blur-xl p-0 lg:hidden data-[state=closed]:duration-0 data-[state=open]:duration-150"
        >
          <SheetHeader className="px-5 pt-5 pb-3 pr-12 text-left">
            <SheetTitle className="text-lg">Mais opções</SheetTitle>
            <SheetDescription className="text-xs">
              Acesse as outras áreas do seu controle financeiro.
            </SheetDescription>
          </SheetHeader>

          <div className="px-5 pb-2">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Plano atual
              </p>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{PLAN_LABEL[plan]}</p>
                {isTrialActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                    <Sparkles className="h-3 w-3" />
                    Teste grátis · {trialDaysLeft}d
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-y-auto px-5 pb-8 pt-2" style={{ maxHeight: "calc(75vh - 170px)" }}>
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
                      "group relative flex flex-col items-start gap-2 rounded-2xl border border-border/60 bg-card/60 p-3 text-left transition-all active:scale-[0.98] hover:border-border hover:bg-card/80",
                    )}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft/60 text-brand-on-soft">
                      <Icon className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <span className="flex w-full items-center gap-1">
                      <span className="text-sm font-semibold leading-tight">{item.label}</span>
                      {locked && <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground/70" />}
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <PremiumLockModal
        open={lockState.open}
        onOpenChange={(v) => setLockState((s) => ({ ...s, open: v }))}
        title={lockState.title}
      />
    </>
  );
}
