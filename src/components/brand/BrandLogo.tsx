/**
 * BrandLogo — Componente global para exibir o logo de qualquer marca
 * (empresa, banco, plataforma, assinatura, cliente, fornecedor).
 *
 * Estratégia:
 *   1. Se `domain` for fornecido, tenta Logo.dev → DuckDuckGo → Google s2.
 *   2. Senão, tenta extrair domínio do nome (palpite por TLD comum).
 *   3. Em caso de falha, exibe fallback elegante (inicial + cor estável)
 *      ou um ícone customizado via `fallbackIcon`.
 *
 * Apenas o domínio público é enviado a APIs externas — nunca dados sensíveis.
 */
import { memo, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  colorForSeed,
  extractDomain,
  getLogoCandidates,
  initialOfName,
} from "@/lib/brand/resolver";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<Size, string> = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-lg",
};

export type BrandLogoProps = {
  name: string;
  domain?: string | null;
  size?: Size;
  rounded?: "lg" | "xl" | "2xl" | "full";
  className?: string;
  fallbackIcon?: ReactNode;
  /** Substitui completamente o fallback (inclusive estilos) quando nenhum logo carrega. */
  fallback?: ReactNode;
  /** "square" mostra logo sobre fundo branco; "circle" mostra como avatar redondo. */
  variant?: "square" | "circle";
  /**
   * Quando true, só tenta logos de marcas explicitamente conhecidas (SEED ou
   * domínio passado). Evita o "flicker" de favicons genéricos para nomes
   * livres como "PIRUETA BOA ESPERANÇA" — vai direto ao fallback de categoria.
   */
  trustedOnly?: boolean;
};

function BrandLogoBase({
  name,
  domain,
  size = "md",
  rounded = "xl",
  className,
  fallbackIcon,
  fallback,
  variant = "square",
  trustedOnly,
}: BrandLogoProps) {
  const cleanDomain = extractDomain(domain ?? "") ?? domain ?? null;
  const candidates = getLogoCandidates(cleanDomain, name, { trustedOnly });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [cleanDomain, name]);

  const failed = idx >= candidates.length;
  const sizeCls = SIZE_CLASSES[size];
  const radius =
    variant === "circle"
      ? "rounded-full"
      : rounded === "full"
        ? "rounded-full"
        : rounded === "2xl"
          ? "rounded-2xl"
          : rounded === "lg"
            ? "rounded-lg"
            : "rounded-xl";

  if (failed || !candidates.length) {
    if (fallback !== undefined && fallback !== null) {
      return <>{fallback}</>;
    }
    if (fallbackIcon) {
      return (
        <span
          aria-hidden
          className={cn(
            "grid shrink-0 place-items-center bg-muted text-muted-foreground",
            radius,
            sizeCls,
            className,
          )}
        >
          {fallbackIcon}
        </span>
      );
    }
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center font-semibold text-white",
          radius,
          sizeCls,
          className,
        )}
        style={{ background: colorForSeed(name || cleanDomain || "?") }}
      >
        {initialOfName(name)}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-white/95 ring-1 ring-border/60",
        radius,
        sizeCls,
        className,
      )}
    >
      <img
        src={candidates[idx]}
        alt=""
        onError={() => setIdx((i) => i + 1)}
        onLoad={(e) => {
          // Rejeita imagens minúsculas (favicons 16/32px), que ficam
          // pixeladas/borradas quando renderizadas em h-11/h-14. Avança
          // pra próxima fonte ou cai no fallback elegante.
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalWidth < 48) {
            setIdx((i) => i + 1);
          }
        }}
        className="h-full w-full object-contain p-1.5"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}

export const BrandLogo = memo(BrandLogoBase);
