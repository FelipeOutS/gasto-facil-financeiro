import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Lock, Check, Crown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
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

  const rec = deriveRecommendedPlan(feature, recommendedPlan);
  const planLabel = rec ? PLAN_LABEL[rec] : null;
  const bullets = benefits && benefits.length > 0 ? benefits : defaultBenefits(rec);
  const effectiveTrialPlan = rec ?? trialPlan;

  async function handleTrial() {
    if (!user?.id) {
      toast.error("Faça login para testar.");
      return;
    }
    setLoading(true);
    try {
      const res = await startTrial(user.id, effectiveTrialPlan);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success("Teste grátis ativado por 10 dias.");
      await refresh();
      onOpenChange(false);
    } catch {
      toast.error("Erro ao iniciar o teste.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-primary/20 ring-1 ring-primary/20">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">{title}</DialogTitle>
          <DialogDescription className="text-center">
            {description ??
              "Este recurso está disponível apenas em planos elegíveis. Escolha um plano para liberar esse recurso."}
          </DialogDescription>
        </DialogHeader>

        {(planLabel || bullets.length > 0) && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
            {planLabel && (
              <div className="mb-3 flex items-center gap-2 text-foreground">
                <Crown className="h-4 w-4 text-primary" />
                <span className="font-medium">Liberado a partir do plano</span>
                <span className="font-semibold text-primary">{planLabel}</span>
              </div>
            )}
            {bullets.length > 0 && (
              <ul className="space-y-1.5">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{b}</span>
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
              {loading ? "Ativando…" : "Testar grátis por 10 dias"}
            </Button>
          )}
          <Button asChild variant={trialUsed ? "default" : "outline"} className="w-full rounded-2xl min-h-11">
            <Link to="/meu-plano" onClick={() => onOpenChange(false)}>
              Ver planos <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {showContinue && (
            <Button
              variant="ghost"
              className="w-full rounded-2xl min-h-11"
              onClick={() => onOpenChange(false)}
            >
              Agora não
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
