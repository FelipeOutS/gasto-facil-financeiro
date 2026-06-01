import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppSummaryCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Texto auxiliar abaixo do valor (variação, período). */
  hint?: ReactNode;
  /** Ícone opcional à esquerda. */
  icon?: ReactNode;
  tone?: AppModuleTone;
  /** Variação visual: positivo/negativo/neutro. Para indicação não-baseada-em-cor use também ícone. */
  trend?: "up" | "down" | "flat";
  className?: string;
}

/**
 * Card de KPI/resumo reutilizável para dashboards e topos de módulo.
 * Não calcula nada — apenas apresenta valores recebidos como props.
 */
export function AppSummaryCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  trend,
  className,
}: AppSummaryCardProps) {
  const color = MODULE_TONE_VAR[tone];
  const trendClass =
    trend === "up"
      ? "text-success"
      : trend === "down"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-card",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`,
              color,
            }}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-foreground">
        {value}
      </div>
      {hint && <p className={cn("mt-1 text-xs", trendClass)}>{hint}</p>}
    </div>
  );
}
