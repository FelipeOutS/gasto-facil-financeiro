import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionTileProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Hide the default chevron. */
  hideChevron?: boolean;
  tone?: "default" | "primary" | "warning" | "destructive";
}

const toneIcon = {
  default: "bg-muted/40 text-foreground",
  primary: "bg-primary/15 text-primary",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export const ActionTile = React.forwardRef<HTMLButtonElement, ActionTileProps>(
  (
    { className, title, description, icon, trailing, hideChevron, tone = "default", ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-card transition-colors min-h-14",
          "hover:bg-card-elevated active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      >
        {icon && (
          <span
            className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", toneIcon[tone])}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {trailing}
        {!hideChevron && !trailing && (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    );
  },
);
ActionTile.displayName = "ActionTile";
