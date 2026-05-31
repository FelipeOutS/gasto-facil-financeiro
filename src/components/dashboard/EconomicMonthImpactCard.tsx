import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  PiggyBank,
  Compass,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  loadBcbRadar,
  type BcbIndicator,
  type BcbIndicatorKey,
} from "@/lib/economy/bcb";
import {
  buildEconomicMonthImpact,
  type EconomicImpactTone,
} from "@/lib/insights/economic-month-impact";

interface Props {
  className?: string;
  saldo: number;
  receitas: number;
  despesas: number;
  contasVencidas?: number;
  cartaoUsoPercentual?: number;
  recorrenciasTotal?: number;
}

function pick(indicators: BcbIndicator[], key: BcbIndicatorKey): number | null {
  const i = indicators.find((x) => x.key === key);
  return i ? i.value : null;
}

const TONE_STYLES: Record<
  EconomicImpactTone,
  { bg: string; border: string; text: string; icon: typeof Compass }
> = {
  destructive: {
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    text: "text-destructive",
    icon: ShieldAlert,
  },
  warning: {
    bg: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
    icon: AlertTriangle,
  },
  success: {
    bg: "bg-success/10",
    border: "border-success/30",
    text: "text-success",
    icon: PiggyBank,
  },
  info: {
    bg: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
    icon: TrendingUp,
  },
  muted: {
    bg: "bg-muted/40",
    border: "border-border",
    text: "text-muted-foreground",
    icon: Compass,
  },
};

/**
 * Card discreto que traduz Selic/CDI/IPCA do BCB em impacto prático para o mês,
 * usando dados financeiros já calculados no Dashboard. Não duplica o Radar BCB.
 */
export function EconomicMonthImpactCard({
  className,
  saldo,
  receitas,
  despesas,
  contasVencidas,
  cartaoUsoPercentual,
  recorrenciasTotal,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation("dashboard");
  const [indicators, setIndicators] = useState<BcbIndicator[]>([]);

  useEffect(() => {
    let cancel = false;
    loadBcbRadar()
      .then((r) => {
        if (!cancel) setIndicators(r.indicators);
      })
      .catch(() => {
        /* silencioso — card simplesmente não aparece */
      });
    return () => {
      cancel = true;
    };
  }, []);

  const impact = useMemo(() => {
    if (indicators.length === 0) return null;
    return buildEconomicMonthImpact({
      selic: pick(indicators, "SELIC"),
      cdi: pick(indicators, "CDI"),
      ipca: pick(indicators, "IPCA"),
      saldo,
      receitas,
      despesas,
      contasVencidas,
      cartaoUsoPercentual,
      recorrenciasTotal,
    });
  }, [
    indicators,
    saldo,
    receitas,
    despesas,
    contasVencidas,
    cartaoUsoPercentual,
    recorrenciasTotal,
  ]);

  if (!impact) return null;

  const styles = TONE_STYLES[impact.tone];
  const Icon = styles.icon;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 transition-colors",
        styles.border,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
            styles.bg,
            styles.text,
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("economicImpact.eyebrow")}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">
            {impact.title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {impact.description}
          </p>
          {impact.actionLabel && impact.actionHref && (
            <button
              type="button"
              onClick={() =>
                void navigate({ to: impact.actionHref as string })
              }
              className={cn(
                "mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1",
                styles.bg,
                styles.text,
                "hover:opacity-90",
              )}
            >
              {impact.actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
