import { Link } from "@tanstack/react-router";
import { Crown, Sparkles, ArrowRight, Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlan } from "@/lib/use-plan";
import { PLAN_LABEL } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * Card compacto de assinatura para o Dashboard.
 */
export function PlanoCard({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const { plan, status, storedPlan, isAdminMaster, loading, isTrialActive, trialDaysLeft } =
    usePlan();

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card animate-pulse",
          className,
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/50" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-muted-foreground">{t("planCard.checking")}</p>
        </div>
      </div>
    );
  }

  const semAssinatura =
    !isAdminMaster && !isTrialActive && (storedPlan === "sem_assinatura" || storedPlan === "free");
  const aguardando = !isAdminMaster && status === "aguardando_pagamento";
  const ativoPago = !isAdminMaster && status === "ativo" && !semAssinatura;

  if (isAdminMaster) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 via-card to-primary/5 p-3.5 shadow-card",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-500">
            <Crown className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("planCard.fullAccess")}</p>
            <p className="truncate text-xs text-muted-foreground">{t("planCard.fullAccessDesc")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdminMaster && isTrialActive) {
    return (
      <Link
        to="/meu-plano"
        className={cn(
          "flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-amber-500/10 p-3.5 shadow-card transition-colors hover:border-primary/50",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("planCard.trialActive")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t("planCard.trialDesc", { count: trialDaysLeft, plan: PLAN_LABEL[plan] })}
            </p>
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
          {t("planCard.viewPlans")} <ArrowRight className="h-3 w-3" />
        </span>
      </Link>
    );
  }

  if (ativoPago) {
    return (
      <Link
        to="/meu-plano"
        className={cn(
          "flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-3.5 shadow-card transition-colors hover:border-primary/50",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("planCard.active")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t("planCard.activeDesc", { plan: PLAN_LABEL[plan] })}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
          {t("planCard.manage")}
        </span>
      </Link>
    );
  }

  if (aguardando) {
    return (
      <Link
        to="/meu-plano"
        className={cn(
          "flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card p-3.5 shadow-card transition-colors hover:border-amber-500/50",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-500">
            <Hourglass className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("planCard.pending")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t("planCard.pendingDesc", { plan: PLAN_LABEL[plan] })}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-[11px] font-semibold text-white">
          {t("planCard.continue")}
        </span>
      </Link>
    );
  }

  return (
    <Link
      to="/meu-plano"
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-amber-500/5 p-3.5 shadow-card transition-colors hover:border-primary/50",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-amber-500/20 text-primary">
          <Crown className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("planCard.unlock")}</p>
          <p className="truncate text-xs text-muted-foreground">{t("planCard.unlockDesc")}</p>
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
        {t("planCard.viewPlans")} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
