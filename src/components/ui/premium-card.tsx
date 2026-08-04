import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "elevated" | "subtle" | "highlight";

const variantClasses: Record<Variant, string> = {
  default: "bg-card border-border shadow-card",
  elevated: "bg-card-elevated border-border/70 shadow-elevated",
  subtle: "bg-card/60 border-border/50",
  highlight: "bg-gradient-to-br from-primary/10 via-card to-card border-primary/30 shadow-card",
};

export interface PremiumCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  variant?: Variant;
  /** Use rounded-3xl instead of rounded-2xl */
  rounded?: "2xl" | "3xl";
  /** Padding preset. Default is comfortable (p-5). Use 'compact' (p-4) for dense lists. */
  padding?: "default" | "compact" | "none";
}

export const PremiumCard = React.forwardRef<HTMLDivElement, PremiumCardProps>(
  (
    {
      className,
      title,
      description,
      icon,
      action,
      variant = "default",
      rounded = "2xl",
      padding = "default",
      children,
      ...props
    },
    ref,
  ) => {
    const hasHeader = Boolean(title || description || icon || action);
    const pad = padding === "none" ? "" : padding === "compact" ? "p-4" : "p-5";
    return (
      <div
        ref={ref}
        className={cn(
          "border text-card-foreground transition-colors",
          rounded === "3xl" ? "rounded-3xl" : "rounded-2xl",
          variantClasses[variant],
          pad,
          className,
        )}
        {...props}
      >
        {hasHeader && (
          <div className="flex items-start gap-3">
            {icon && (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/40 text-foreground">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && <h3 className="text-sm font-semibold leading-tight">{title}</h3>}
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        {children && <div className={cn(hasHeader && "mt-4")}>{children}</div>}
      </div>
    );
  },
);
PremiumCard.displayName = "PremiumCard";
