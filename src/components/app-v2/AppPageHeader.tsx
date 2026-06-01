import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Ícone opcional renderizado em um chip com a cor do módulo. */
  icon?: ReactNode;
  tone?: AppModuleTone;
  /** Ações alinhadas à direita (botões secundários, menus). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho interno consistente para todas as rotas do app V3.
 * Mobile-first; em telas largas título e ações ficam lado a lado.
 */
export function AppPageHeader({
  title,
  description,
  icon,
  tone = "neutral",
  actions,
  className,
}: AppPageHeaderProps) {
  const color = MODULE_TONE_VAR[tone];

  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border/60"
            style={{
              backgroundColor: `color-mix(in oklab, ${color} 18%, var(--card))`,
              color: color,
            }}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}
