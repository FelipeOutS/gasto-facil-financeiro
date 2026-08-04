import { Wallet, CalendarClock, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

export type LimiteDiarioTipo = "passado" | "futuro" | "atual" | "estourado" | "semOrcamento";

interface OrcamentoLimiteDiarioCardProps {
  tipo: LimiteDiarioTipo;
  valor?: number;
  status: "success" | "warning" | "destructive" | "muted";
  diasRestantes?: number;
  labels: {
    title: string;
    description: string;
    perDay: string;
    pastMonth: string;
    futureMonth: string;
    exceeded: string;
    noBudget: string;
    remainingDays: string;
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
    Icon: AlertTriangle,
  },
  muted: {
    ring: "",
    iconBg: "bg-muted/40",
    iconColor: "text-muted-foreground",
    Icon: Clock,
  },
};

export function OrcamentoLimiteDiarioCard({
  tipo,
  valor,
  status,
  diasRestantes,
  labels,
}: OrcamentoLimiteDiarioCardProps) {
  const config = statusConfig[status];
  const StatusIcon = config.Icon;

  const mensagem =
    tipo === "passado"
      ? labels.pastMonth
      : tipo === "futuro"
        ? labels.futureMonth
        : tipo === "estourado"
          ? labels.exceeded
          : tipo === "semOrcamento"
            ? labels.noBudget
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
        {tipo === "atual" ? (
          <Wallet className="h-5 w-5" />
        ) : tipo === "futuro" ? (
          <CalendarClock className="h-5 w-5" />
        ) : (
          <StatusIcon className="h-5 w-5" />
        )}
      </span>

      <div className="min-w-1 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labels.title}
          </p>
          {tipo === "atual" && diasRestantes !== undefined && diasRestantes > 1 && (
            <span className="shrink-1 truncate text-[10px] text-muted-foreground">
              {labels.remainingDays.replace("{{count}}", String(diasRestantes))}
            </span>
          )}
        </div>

        {tipo === "atual" && valor !== undefined ? (
          <>
            <p
              className={cn(
                "mt-1 text-xl font-bold tracking-tight",
                status === "destructive"
                  ? "text-destructive"
                  : status === "warning"
                    ? "text-warning"
                    : "text-foreground",
              )}
            >
              {labels.perDay.replace("{{value}}", formatBRL(valor))}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {labels.description}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm font-medium text-muted-foreground">{mensagem}</p>
        )}
      </div>
    </div>
  );
}
