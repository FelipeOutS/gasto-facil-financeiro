import * as React from "react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  trend?: {
    direction: "up" | "down" | "neutral";
    label: React.ReactNode;
  };
  /** Visual emphasis. */
  tone?: "default" | "positive" | "negative" | "warning" | "primary";
  className?: string;
  onClick?: () => void;
}

const toneRing: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "",
  positive: "ring-1 ring-success/30",
  negative: "ring-1 ring-destructive/30",
  warning: "ring-1 ring-warning/30",
  primary: "ring-1 ring-primary/30",
};

const toneIcon: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "bg-muted/40 text-foreground",
  positive: "bg-success/15 text-success",
  negative: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary",
};

const trendColors = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
};

export function MetricCard({
  label,
  value,
  hint,
  icon,
  trend,
  tone = "default",
  className,
  onClick,
}: MetricCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors",
        onClick && "hover:bg-card-elevated active:scale-[0.99]",
        toneRing[tone],
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon && (
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg", toneIcon[tone])}>
            {icon}
          </span>
        )}
      </div>
      <div className="text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {(hint || trend) && (
        <div className="flex items-center justify-between gap-2 text-xs">
          {hint && <span className="text-muted-foreground">{hint}</span>}
          {trend && (
            <span className={cn("font-medium", trendColors[trend.direction])}>{trend.label}</span>
          )}
        </div>
      )}
    </Tag>
  );
}
