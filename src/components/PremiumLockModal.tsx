import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Lock, Check, Crown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/lib/auth-context";
import { usePlan, startTrial } from "@/lib/use-plan";
import {
  PLAN_LABEL,
  COMMERCIAL_PLANS,
  minPlanFor,
  plansAllowingFeature,
  type FeatureKey,
  type PlanTier,
} from "@/lib/plans";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  /**
   * Feature bloqueada. Se informada, o modal mostra:
   *  - plano mínimo recomendado
   *  - 3-4 benefícios do plano sugerido
   */
  feature?: FeatureKey;
  /** Sobrescreve o plano recomendado (raro — normalmente derivado de `feature`). */
  recommendedPlan?: PlanTier;
  /** Benefícios para exibir; se omitido, derivamos do plano recomendado. */
  benefits?: string[];
  /** Plano usado quando o usuário ativa o teste grátis. */
  trialPlan?: PlanTier;
  /** Mostra o botão "Agora não" (fechar modal sem ação). */
  showContinue?: boolean;
};

function deriveRecommendedPlan(feature?: FeatureKey, override?: PlanTier): PlanTier | null {
  if (override) return override;
  if (!feature) return null;
  // Preferir o primeiro plano da whitelist (mais barato que libera).
  const allowed = plansAllowingFeature(feature).filter(
    (p) => p !== "free" && p !== "sem_assinatura" && p !== "admin_master",
  );
  if (allowed.length > 0) return allowed[0];
  return minPlanFor(feature);
}

function defaultBenefits(plan: PlanTier | null): string[] {
  if (!plan) return [];
  const c = COMMERCIAL_PLANS.find((p) => p.tier === plan);
  if (!c) return [];
  return c.highlights.slice(0, 4);
}

/**
 * Modal padrão de bloqueio premium reutilizável. Mostra o nome do recurso,
 * o plano mínimo recomendado, benefícios principais e CTAs claros.
 */
export function PremiumLockModal({
  open,
  onOpenChange,
  title,
  description,
  feature,
  recommendedPlan,
  benefits,
  trialPlan = "pessoal_premium",
  showContinue = true,
}: Props) {
  const { user } = useAuth();
  const { trialUsed, refresh } = usePlan();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation("common");

  const rec = deriveRecommendedPlan(feature, recommendedPlan);
  const planLabel = rec ? PLAN_LABEL[rec] : null;
  const bullets = benefits && benefits.length > 0 ? benefits : defaultBenefits(rec);
  const effectiveTrialPlan = rec ?? trialPlan;

  async function handleTrial() {
    if (!user?.id) {
      toast.error(t("premium.trialLoginRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await startTrial(user.id, effectiveTrialPlan);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(t("premium.trialActivated"));
      await refresh();
      onOpenChange(false);
    } catch {
      toast.error(t("premium.trialError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="relative mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/25 via-primary/15 to-primary/25 ring-1 ring-primary/30 shadow-elevated">
            <Lock className="h-7 w-7 text-primary" />
            <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-md">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          </div>
          <DialogTitle className="text-center text-lg font-bold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            {description ?? t("premium.defaultDescription")}
          </DialogDescription>
        </DialogHeader>

        {(planLabel || bullets.length > 0) && (
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4 text-sm shadow-card">
            {planLabel && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Crown className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">
                  {t("premium.unlockedFromPlan")}
                </span>
                <StatusBadge tone="info" dot className="font-semibold">
                  {planLabel}
                </StatusBadge>
              </div>
            )}
            {bullets.length > 0 && (
              <ul className="space-y-2">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-foreground/90">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="text-sm leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!trialUsed && (
            <Button
              className="w-full rounded-2xl min-h-11"
              disabled={loading}
              onClick={handleTrial}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {loading ? t("premium.trialActivating") : t("premium.trialCta")}
            </Button>
          )}
          <Button
            asChild
            variant={trialUsed ? "default" : "outline"}
            className="w-full rounded-2xl min-h-11"
          >
            <Link to="/meu-plano" onClick={() => onOpenChange(false)}>
              {t("premium.ctaSeePlans")} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {showContinue && (
            <Button
              variant="ghost"
              className="w-full rounded-2xl min-h-11"
              onClick={() => onOpenChange(false)}
            >
              {t("premium.ctaNotNow")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
