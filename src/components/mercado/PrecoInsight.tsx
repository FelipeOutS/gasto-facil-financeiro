import { useTranslation } from "react-i18next";
import { TrendingDown, TrendingUp, Minus, Info } from "lucide-react";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { usePrecoInsight, type PrecoInsightStatus } from "@/lib/mercado/precos-history";

interface Props {
  nome: string | undefined;
  codigoBarras?: string;
  precoUnitario: number | undefined | null;
  className?: string;
}

const toneByStatus: Record<PrecoInsightStatus, { wrap: string; icon: string; Icon: typeof Info }> =
  {
    bom: {
      wrap: "border-success/30 bg-success/10 text-success",
      icon: "text-success",
      Icon: TrendingDown,
    },
    normal: {
      wrap: "border-border/60 bg-muted/40 text-muted-foreground",
      icon: "text-muted-foreground",
      Icon: Minus,
    },
    alto: {
      wrap: "border-warning/30 bg-warning/10 text-warning",
      icon: "text-warning",
      Icon: TrendingUp,
    },
    muito_alto: {
      wrap: "border-destructive/30 bg-destructive/10 text-destructive",
      icon: "text-destructive",
      Icon: TrendingUp,
    },
    sem_historico: {
      wrap: "border-border/60 bg-muted/40 text-muted-foreground",
      icon: "text-muted-foreground",
      Icon: Info,
    },
  };

const titleKey: Record<PrecoInsightStatus, string> = {
  bom: "precoInsight.goodTitle",
  normal: "precoInsight.normalTitle",
  alto: "precoInsight.highTitle",
  muito_alto: "precoInsight.veryHighTitle",
  sem_historico: "precoInsight.noHistoryTitle",
};

const descKey: Record<PrecoInsightStatus, string> = {
  bom: "precoInsight.goodDesc",
  normal: "precoInsight.normalDesc",
  alto: "precoInsight.highDesc",
  muito_alto: "precoInsight.veryHighDesc",
  sem_historico: "precoInsight.noHistoryDesc",
};

export function PrecoInsight({ nome, codigoBarras, precoUnitario, className }: Props) {
  const { t } = useTranslation("mercado");
  const insight = usePrecoInsight(nome, codigoBarras, precoUnitario);
  if (!insight) return null;

  const tone = toneByStatus[insight.status];
  const Icon = tone.Icon;
  const hasStats =
    insight.status !== "sem_historico" &&
    (insight.menorPreco !== undefined || insight.precoMedio !== undefined);

  return (
    <div
      className={cn(
        "mt-2 flex items-start gap-2 rounded-2xl border p-2.5 text-[12px] leading-snug",
        tone.wrap,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-widest opacity-70">
            {t("precoInsight.label")}
          </span>
          <span className="truncate">{t(titleKey[insight.status])}</span>
        </p>
        <p className="mt-0.5 opacity-90">{t(descKey[insight.status])}</p>
        {hasStats && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums opacity-80">
            {insight.menorPreco !== undefined && (
              <span>
                {t("precoInsight.lowest")}: <Money value={insight.menorPreco} />
              </span>
            )}
            {insight.precoMedio !== undefined && (
              <span>
                {t("precoInsight.average")}: <Money value={insight.precoMedio} />
              </span>
            )}
            {insight.ultimoPreco !== undefined && (
              <span>
                {t("precoInsight.last")}: <Money value={insight.ultimoPreco} />
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
