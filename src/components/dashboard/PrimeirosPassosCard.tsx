import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, Plus, ArrowUp, Wallet, Target, ChevronRight, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { TipoCadastro } from "@/lib/profile-utils";
import { tipoEfetivo } from "@/lib/profile-utils";
import { usePlan } from "@/lib/use-plan";

/**
 * Onboarding leve do Dashboard — orienta usuários novos a fazerem o primeiro
 * lançamento. Não bloqueia o usuário, é apenas guia visual. Persiste a dispensa
 * em localStorage (sem alterar banco). Esconde automaticamente quando o
 * checklist está completo.
 */
export interface PrimeirosPassosCardProps {
  gastosCount: number;
  receitasCount: number;
  cartoesCount: number;
  metasCount: number;
  className?: string;
}

const DISMISS_PREFIX = "gi.first-steps-dismissed-v1:";

function isDismissed(userId: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = DISMISS_PREFIX + (userId ?? "anon");
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markDismissed(userId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const key = DISMISS_PREFIX + (userId ?? "anon");
    window.localStorage.setItem(key, "1");
  } catch {
    /* noop */
  }
}

export function PrimeirosPassosCard({
  gastosCount,
  receitasCount,
  cartoesCount,
  metasCount,
  className,
}: PrimeirosPassosCardProps) {
  const { t } = useTranslation("dashboard");
  const { user, profile } = useAuth();
  const { plan } = usePlan();
  const tipo = tipoEfetivo(profile?.tipo_cadastro as TipoCadastro);
  const isBusiness = tipo === "mei" || tipo === "empresa";
  // free_ads: nesta fase só libera gastos/receitas manuais básicos. Cartões
  // e metas ainda não estão liberados — escondemos os itens para não levar
  // o usuário a um bloqueio de plano. Demais planos (pago/sem_assinatura/
  // admin) continuam vendo o checklist completo.
  const isFreeAds = plan === "free_ads";

  const [dismissed, setDismissed] = useState<boolean>(() => isDismissed(user?.id ?? null));

  useEffect(() => {
    setDismissed(isDismissed(user?.id ?? null));
  }, [user?.id]);

  const items = useMemo(() => {
    const incomeKey = isBusiness ? "revenue" : "income";
    const base = [
      {
        id: "expense",
        label: t("firstSteps.items.expense"),
        done: gastosCount > 0,
        to: "/adicionar",
        search: { tipo: "gasto" },
        icon: Plus,
      },
      {
        id: incomeKey,
        label: t(`firstSteps.items.${incomeKey}`),
        done: receitasCount > 0,
        to: "/adicionar",
        search: { tipo: "receita" },
        icon: ArrowUp,
      },
      {
        id: "card",
        label: t("firstSteps.items.card"),
        done: cartoesCount > 0,
        to: "/cartoes",
        icon: Wallet,
      },
      {
        id: "goal",
        label: t("firstSteps.items.goal"),
        done: metasCount > 0,
        to: "/metas",
        icon: Target,
      },
    ] as const;
    return isFreeAds
      ? base.filter((i) => i.id !== "card" && i.id !== "goal")
      : base;
  }, [t, isBusiness, gastosCount, receitasCount, cartoesCount, metasCount, isFreeAds]);

  const totalDone = items.filter((i) => i.done).length;
  const allDone = totalDone === items.length;

  if (dismissed || allDone) return null;

  const handleDismiss = () => {
    markDismissed(user?.id ?? null);
    setDismissed(true);
  };

  const secondaryLabel = isBusiness
    ? t("firstSteps.secondaryCtaRevenue")
    : t("firstSteps.secondaryCtaIncome");

  return (
    <section
      className={cn(
        "rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 via-card to-card p-3.5 shadow-card sm:p-4",
        className,
      )}
      aria-label={t("firstSteps.title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold sm:text-base">
              {t("firstSteps.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-[13px]">
              {t("firstSteps.description")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("firstSteps.dismiss")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                search={("search" in item ? item.search : undefined) as Record<string, unknown> | undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-sm transition-colors hover:border-border hover:bg-card-elevated",
                  item.done && "opacity-70",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                    item.done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-card-elevated text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {item.done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    item.done && "line-through",
                  )}
                >
                  {item.label}
                </span>
                {!item.done && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Link to="/adicionar" search={{ tipo: "gasto" }} className="sm:flex-1">
          <Button
            size="lg"
            className="card-press h-11 w-full rounded-xl bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("firstSteps.primaryCta")}
          </Button>
        </Link>
        <Link to="/adicionar" search={{ tipo: "receita" }} className="sm:flex-1">
          <Button
            size="lg"
            variant="outline"
            className="h-11 w-full rounded-xl text-sm font-semibold"
          >
            <ArrowUp className="mr-1 h-4 w-4" />
            {secondaryLabel}
          </Button>
        </Link>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {t("firstSteps.hint")}
      </p>
    </section>
  );
}

export default PrimeirosPassosCard;
