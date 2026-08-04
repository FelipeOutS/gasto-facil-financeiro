import { Link } from "@tanstack/react-router";
import { Lock, Sparkles, ArrowRight } from "lucide-react";
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
import { PLAN_LABEL, plansAllowingFeature, type FeatureKey } from "@/lib/plans";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  feature: FeatureKey | null;
  featureLabel: string;
  benefit?: string;
};

export function UpgradeModal({ open, onOpenChange, feature, featureLabel, benefit }: Props) {
  const { t } = useTranslation("common");
  const min = feature ? (plansAllowingFeature(feature)[0] ?? "pessoal_premium") : "pessoal_premium";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-primary/20 ring-1 ring-primary/20">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">{featureLabel}</DialogTitle>
          <DialogDescription className="text-center">
            {benefit ?? t("premium.defaultDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-border bg-card-elevated p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("premium.unlockFromPlan")}
          </p>
          <p className="mt-1 text-2xl font-bold text-primary">{PLAN_LABEL[min]}</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button asChild className="w-full rounded-2xl min-h-11">
            <Link to="/meu-plano" onClick={() => onOpenChange(false)}>
              {t("premium.ctaSeePlans")} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full rounded-2xl min-h-11"
            onClick={() => onOpenChange(false)}
          >
            {t("premium.ctaNotNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Selo "Premium" reaproveitável em botões/itens bloqueados.
 */
export function LockChip() {
  const { t } = useTranslation("common");
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
      <Lock className="h-3 w-3" /> {t("premium.badge")}
    </span>
  );
}
