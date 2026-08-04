import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Visual size of the title. */
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-lg font-semibold tracking-tight",
};

export function SectionHeader({
  title,
  description,
  icon,
  action,
  className,
  size = "md",
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      {icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/40 text-foreground">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className={cn("leading-tight", sizeClasses[size])}>{title}</h2>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
