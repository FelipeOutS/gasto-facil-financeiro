import { TrendingUp, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

export type PrevisaoTipo =
  | "passado_dentro"
  | "passado_fora"
  | "futuro"
  | "sem_dados"
  | "dentro_previsto"
  | "risco_estouro"
  | "ja_estourado";

interface OrcamentoPrevisaoCardProps {
  tipo: PrevisaoTipo;
  gastoProjetado?: number;
  planejado?: number;
  diferenca?: number;
  labels: {
    title: string;
    pastWithin: string;
    pastOver: string;
    future: string;
    noData: string;
    onTrack: string;
    overRisk: string;
    overValue: string;
    alreadyOver: string;
    projected: string;
    planned: string;
    gapPositive: string;
    gapNegative: string;
  };
}

const statusConfig = {
  success: {
    ring: "ring-1 ring-success/30",
    iconBg: "bg-success/15",
    iconColor: "text-success",
    Icon: CheckCircle2,
  },
  warning: {
    ring: "ring-1 ring-warning/30",
    iconBg: "bg-warning/15",
    iconColor: "text-warning",
    Icon: AlertTriangle,
  },
  destructive: {
    ring: "ring-1 ring-destructive/30",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    Icon: XCircle,
  },
  muted: {
    ring: "",
    iconBg: "bg-muted/40",
    iconColor: "text-muted-foreground",
    Icon: Clock,
  },
};

function resolveStatus(tipo: PrevisaoTipo): keyof typeof statusConfig {
  switch (tipo) {
    case "dentro_previsto":
    case "passado_dentro":
      return "success";
    case "risco_estouro":
      return "warning";
    case "ja_estourado":
    case "passado_fora":
      return "destructive";
    case "futuro":
    case "sem_dados":
    default:
      return "muted";
  }
}

export function OrcamentoPrevisaoCard({
  tipo,
  gastoProjetado,
  planejado,
  diferenca,
  labels,
}: OrcamentoPrevisaoCardProps) {
  const statusKey = resolveStatus(tipo);
  const config = statusConfig[statusKey];
  const StatusIcon = config.Icon;

  const isAtual =
    tipo === "dentro_previsto" ||
    tipo === "risco_estouro" ||
    tipo === "ja_estourado" ||
    tipo === "sem_dados";

  const mensagemCurta =
    tipo === "passado_dentro"
      ? labels.pastWithin
      : tipo === "passado_fora"
        ? labels.pastOver
        : tipo === "futuro"
          ? labels.future
          : tipo === "sem_dados"
            ? labels.noData
            : tipo === "ja_estourado"
              ? labels.alreadyOver
              : null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-colors",
        config.ring,
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          config.iconBg,
          config.iconColor,
        )}
      >
        {isAtual ? <TrendingUp className="h-5 w-5" /> : <StatusIcon className="h-5 w-5" />}
      </span>

      <div className="min-w-1 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {labels.title}
        </p>

        {mensagemCurta ? (
          <p className="mt-1 text-sm font-medium text-muted-foreground">{mensagemCurta}</p>
        ) : (
          <>
            {gastoProjetado !== undefined && (
              <p
                className={cn(
                  "mt-1 text-xl font-bold tracking-tight",
                  statusKey === "destructive"
                    ? "text-destructive"
                    : statusKey === "warning"
                      ? "text-warning"
                      : "text-foreground",
                )}
              >
                {labels.projected.replace("{{value}}", formatBRL(gastoProjetado))}
              </p>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {tipo === "dentro_previsto" && planejado !== undefined
                ? labels.onTrack.replace("{{value}}", formatBRL(planejado))
                : tipo === "risco_estouro" && diferenca !== undefined
                  ? labels.overRisk.replace("{{value}}", formatBRL(Math.abs(diferenca)))
                  : tipo === "risco_estouro" && planejado !== undefined
                    ? labels.overValue.replace("{{value}}", formatBRL(planejado))
                    : null}
            </p>

            {planejado !== undefined &&
              diferenca !== undefined &&
              tipo !== "ja_estourado" &&
              tipo !== "risco_estouro" && (
                <p className="mt-1.5 text-[11px] font-medium">
                  {diferenca >= 1
                    ? labels.gapPositive.replace("{{value}}", formatBRL(diferenca))
                    : labels.gapNegative.replace("{{value}}", formatBRL(Math.abs(diferenca)))}
                </p>
              )}
          </>
        )}
      </div>
    </div>
  );
}
