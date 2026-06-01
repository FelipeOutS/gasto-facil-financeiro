import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppActionCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: AppModuleTone;
  /** Componente clicável envolvendo o card (ex.: Link do TanStack Router ou <button>). */
  as?: "button" | "div";
  onClick?: () => void;
  /** Estado bloqueado (premium gate). Apresenta um badge e remove pointer. */
  locked?: boolean;
  lockedLabel?: ReactNode;
  /** Rótulo acessível extra (usado quando o card é apenas wrapper de Link). */
  ariaLabel?: string;
  className?: string;
  /** Filho opcional, geralmente o <Link/>. */
  children?: ReactNode;
}

/**
 * Card de ação rápida (quick action) — atalhos no topo dos módulos.
 * Min-height ≥ 44px para conforto de toque mobile/Android WebView.
 */
export function AppActionCard({
  title,
  description,
  icon,
  tone = "neutral",
  as = "div",
  onClick,
  locked = false,
  lockedLabel,
  ariaLabel,
  className,
  children,
}: AppActionCardProps) {
  const color = MODULE_TONE_VAR[tone];
  const Tag: "button" | "div" = as;

  const inner = (
    <>
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor: `color-mix(in oklab, ${color} 20%, transparent)`,
              color,
            }}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {locked && lockedLabel && (
          <span className="shrink-0 rounded-full border border-border/60 bg-card-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {lockedLabel}
          </span>
        )}
      </div>
      {children}
    </>
  );

  const className_ = cn(
    "group flex min-h-11 w-full flex-col gap-2 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    !locked && "hover:bg-card-elevated active:scale-[0.99]",
    locked && "opacity-80",
    className,
  );

  if (Tag === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-disabled={locked || undefined}
        className={className_}
      >
        {inner}
      </button>
    );
  }
  return (
    <div role="group" aria-label={ariaLabel} className={className_}>
      {inner}
    </div>
  );
}
