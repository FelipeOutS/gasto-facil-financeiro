import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "default"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "primary"
  | "muted";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** Optional leading dot indicator. */
  dot?: boolean;
  size?: "sm" | "md";
}

const toneClasses: Record<StatusTone, string> = {
  default: "bg-muted/60 text-foreground border-border",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
  primary: "bg-primary text-primary-foreground border-primary",
  muted: "bg-muted/40 text-muted-foreground border-transparent",
};

const dotClasses: Record<StatusTone, string> = {
  default: "bg-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-primary",
  primary: "bg-primary-foreground",
  muted: "bg-muted-foreground",
};

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, tone = "default", dot, size = "sm", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-medium",
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
          toneClasses[tone],
          className,
        )}
        {...props}
      >
        {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} aria-hidden />}
        {children}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";
