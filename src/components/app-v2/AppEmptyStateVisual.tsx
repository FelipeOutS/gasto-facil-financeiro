import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppEmptyStateVisualProps {
  title: ReactNode;
  description?: ReactNode;
  /** CTA(s) — botão primário, link secundário, etc. */
  action?: ReactNode;
  /** Ícone opcional renderizado dentro do círculo decorativo. */
  icon?: ReactNode;
  tone?: AppModuleTone;
  /** Ilustração custom (sobrescreve o blob padrão). */
  illustration?: ReactNode;
  className?: string;
}

/**
 * Empty state visual reutilizável com blob SVG inline (sem assets externos).
 * Renderiza um círculo gradiente com a cor do módulo + título + descrição + CTA.
 */
export function AppEmptyStateVisual({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  illustration,
  className,
}: AppEmptyStateVisualProps) {
  const { t } = useTranslation("common");
  const color = MODULE_TONE_VAR[tone];

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 bg-card-elevated/40 px-6 py-10 text-center motion-safe:animate-rise",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className="relative grid h-24 w-24 place-items-center"
        aria-hidden="true"
      >
        {illustration ?? (
          <svg
            viewBox="0 0 96 96"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="appv2-blob-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={color} stopOpacity="0.45" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="48" cy="48" r="44" fill="url(#appv2-blob-grad)" />
            <circle
              cx="48"
              cy="48"
              r="28"
              fill="none"
              stroke={color}
              strokeOpacity="0.35"
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
          </svg>
        )}
        {icon && (
          <span
            className="relative z-10 grid h-12 w-12 place-items-center rounded-2xl bg-card text-foreground shadow-card"
            style={{ color }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground sm:text-base">
          {title}
        </p>
        {description ? (
          <p className="text-xs text-muted-foreground sm:text-sm">
            {description}
          </p>
        ) : (
          <p className="sr-only">{t("appV2.empty.default")}</p>
        )}
      </div>
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
