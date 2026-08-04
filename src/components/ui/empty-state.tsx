import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Variant = "default" | "compact" | "premium";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  ctaLabel?: React.ReactNode;
  onCta?: () => void;
  /** Custom CTA node (overrides ctaLabel/onCta). */
  cta?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCta,
  cta,
  secondaryAction,
  variant = "default",
  className,
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const isPremium = variant === "premium";

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-3xl border text-center",
        isCompact ? "p-5" : "p-8",
        isPremium
          ? "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-card"
          : "border-dashed border-border bg-card/60",
        "motion-safe:animate-rise",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "grid place-items-center rounded-2xl text-foreground motion-safe:animate-pop",
            isCompact ? "h-12 w-12" : "h-14 w-14",
            isPremium ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground",
          )}
        >
          {icon}
        </div>
      )}
      <h3 className={cn("font-semibold", icon ? "mt-3" : "", isCompact ? "text-sm" : "text-base")}>
        {title}
      </h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {(cta || (ctaLabel && onCta)) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {cta ?? (
            <Button onClick={onCta} className="min-h-11 rounded-full font-semibold">
              {ctaLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
      {!cta && !ctaLabel && secondaryAction && <div className="mt-4">{secondaryAction}</div>}
    </div>
  );
}
