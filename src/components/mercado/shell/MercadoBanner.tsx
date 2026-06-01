import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface MercadoBannerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** URL da imagem/ilustração (responsiva, lazy). */
  imageSrc?: string;
  imageAlt?: string;
  /** Tonalidade de fundo: usa token do mercado. */
  tone?: "brand" | "fresh" | "meat" | "bakery" | "drinks" | "dairy" | "cleaning" | "pantry" | "household" | "community";
  /** CTA — passar Link/Button já estilizado para manter type-safety de rota. */
  cta?: ReactNode;
  className?: string;
  /** Altura compacta para banners secundários. */
  compact?: boolean;
  /** Marca a imagem como crítica (LCP): carrega eager e com fetchPriority alta. Use apenas no banner principal acima da dobra. */
  priority?: boolean;
}

const TONE_VAR: Record<NonNullable<MercadoBannerProps["tone"]>, string> = {
  brand: "var(--brand)",
  fresh: "var(--color-mercado-fresh)",
  meat: "var(--color-mercado-meat)",
  bakery: "var(--color-mercado-bakery)",
  drinks: "var(--color-mercado-drinks)",
  dairy: "var(--color-mercado-dairy)",
  cleaning: "var(--color-mercado-cleaning)",
  pantry: "var(--color-mercado-pantry)",
  household: "var(--color-mercado-household)",
  community: "var(--color-mercado-community)",
};

export function MercadoBanner({
  title,
  subtitle,
  imageSrc,
  imageAlt,
  tone = "brand",
  cta,
  className,
  compact = false,
  priority = false,
}: MercadoBannerProps) {
  const { t } = useTranslation("mercado");
  const color = TONE_VAR[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60 shadow-card",
        compact ? "min-h-[128px]" : "min-h-[168px] md:min-h-[200px]",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${color} 22%, var(--card)) 0%, var(--card) 70%)`,
      }}
    >
      {imageSrc && (
        <img
          src={imageSrc}
          alt={imageAlt ?? t("shell.banner.imageAlt")}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          {...(priority ? { fetchPriority: "high" as const } : { fetchPriority: "low" as const })}
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 object-cover object-right opacity-90 sm:w-2/5"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="relative z-10 flex h-full max-w-[62%] flex-col justify-center gap-2 p-4 sm:max-w-[60%] sm:p-5 md:p-6">
        <h3 className="text-base font-semibold leading-tight text-foreground md:text-lg">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs leading-snug text-muted-foreground md:text-sm">
            {subtitle}
          </p>
        )}
        {cta && <div className="mt-1">{cta}</div>}
      </div>
    </div>
  );
}
