import "./module-photo.css";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MODULE_TONE_VAR, type AppModuleTone } from "./tokens";

export interface AppModuleBannerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Tonalidade visual do módulo. */
  tone?: AppModuleTone;
  /** Ilustração/imagem opcional (renderizada à direita). */
  imageSrc?: string;
  imageSrcSet?: string;
  imageSizes?: string;
  imageSrcWebp?: string;
  imageAlt?: string;
  /** Contextual photo beside the module introduction. */
  photo?: boolean;
  photoPosition?: string;
  /** CTA já estilizado (Link/Button). */
  cta?: ReactNode;
  /** Marca como LCP (carrega eager + fetchPriority high). */
  priority?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * Banner premium reutilizável para o topo de cada módulo do app.
 * Inspirado no MercadoBanner V2 — usa gradiente baseado em token de módulo
 * e mantém min-height fixo para evitar CLS.
 */
export function AppModuleBanner({
  title,
  subtitle,
  tone = "neutral",
  imageSrc,
  imageSrcSet,
  imageSizes,
  imageSrcWebp,
  imageAlt,
  photo = false,
  photoPosition = "30% center",
  cta,
  priority = false,
  compact = false,
  className,
}: AppModuleBannerProps) {
  const { t } = useTranslation("common");
  const color = MODULE_TONE_VAR[tone];
  const resolvedAlt = imageAlt ?? t("appV2.banner.imageAlt");

  return (
    <div
      data-has-image={imageSrc ? "true" : "false"}
      className={cn(
        "gi-module-banner relative overflow-hidden rounded-3xl border border-border/60 shadow-card",
        compact ? "min-h-[128px]" : "min-h-[168px] md:min-h-[200px]",
        photo && "gi-module-banner-photo",
        className,
      )}
      style={{
        backgroundImage: photo ? "none" : `linear-gradient(135deg, color-mix(in oklab, ${color} 24%, var(--card)) 0%, var(--card) 72%)`,
      }}
    >
      {imageSrc && (
        <picture>
          {imageSrcWebp && <source srcSet={imageSrcWebp} type="image/webp" />}
          <img
            style={photo ? { objectPosition: photoPosition } : undefined}
            src={imageSrc}
            srcSet={imageSrcSet}
            sizes={imageSizes ?? (photo ? "(min-width: 640px) 144px, 88px" : undefined)}
            {...(photo ? { width: 1672, height: 941 } : {})}
            alt={resolvedAlt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            {...(priority ? { fetchPriority: "high" as const } : { fetchPriority: "low" as const })}
            className={cn("pointer-events-none absolute right-0 top-0 h-full w-1/2 object-cover object-right opacity-90 sm:w-2/5", photo && "gi-banner-photo")}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </picture>
      )}
      <div className="relative z-10 flex h-full max-w-[62%] flex-col justify-center gap-2 p-4 sm:max-w-[60%] sm:p-5 md:p-6">
        <h2 className="text-base font-semibold leading-tight text-foreground md:text-lg">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs leading-snug text-muted-foreground md:text-sm">{subtitle}</p>
        )}
        {cta && <div className="mt-1">{cta}</div>}
      </div>
    </div>
  );
}
