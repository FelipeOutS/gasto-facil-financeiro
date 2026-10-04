import { useEffect, useMemo, useState, memo } from "react";
import { Building2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBankLogo, getMerchantLogo, type BrandResolved } from "@/lib/logos";
import { getLogoCandidates } from "@/lib/brand/resolver";

type Variant = "bank" | "merchant";

type Props = {
  name: string | undefined | null;
  variant: Variant;
  className?: string;
  onDark?: boolean;
  imgClassName?: string;
  bankPresentation?: "card" | "badge" | "tiny";
  bankCardTone?: "light" | "dark";
};

const BANK_WORDMARK_SLUGS = new Set([
  "mercadopago-branco",
  "banco-inter",
  "logo-santander",
  "Banco_Bradesco",
  "logo-caixa",
  "banco-do-brasil",
  "picpay",
  "Logo_C6_Bank",
  "will-bank",
  "assai-atacadista",
]);

/**
 * Cache de módulo: URLs que falharam ao carregar (404/erro de rede). Evita
 * reexecutar a cascata e mostrar flicker em montagens subsequentes do mesmo
 * banco/merchant. Persiste durante a sessão.
 */
const failedUrls = new Set<string>();

/**
 * Cascata de logo: símbolo local compacto (quando houver), SVG local completo,
 * candidato remoto confiável e, por fim, inicial ou ícone. URLs que falharam
 * ficam em cache nesta sessão para evitar imagens quebradas em novas montagens.
 *
 * Bancos conhecidos (Nubank, Mercado Pago, Itaú, Santander, Inter, C6, Bradesco,
 * Banco do Brasil, Caixa, PicPay, Will Bank, Neon) carregam instantaneamente
 * via SVG local — não há requisição externa.
 */
function BrandLogoBase({ name, variant, className, onDark, imgClassName, bankPresentation, bankCardTone = "light" }: Props) {
  const resolved: BrandResolved = variant === "bank" ? getBankLogo(name) : getMerchantLogo(name);
  const presentation = bankPresentation ?? (onDark ? "card" : "badge");
  const [failedStaticUrl, setFailedStaticUrl] = useState<string | null>(null);
  const staticUrls = variant === "bank"
    ? presentation === "card"
      ? [resolved.cardMark?.url]
      : [resolved.compactLogoUrl, resolved.logoUrl]
    : [resolved.logoUrl];
  const staticUrl =
    staticUrls.find((url) => url && failedStaticUrl !== url && !failedUrls.has(url)) ?? null;

  // Logo.dev como fallback p/ qualquer nome sem SVG local.
  // Para bancos usamos trustedOnly p/ não cair em favicons genéricos.
  const dynamicCandidates = useMemo(() => {
    if (!name || staticUrl || (variant === "bank" && presentation === "card")) return [];
    return getLogoCandidates(null, name, { trustedOnly: variant === "bank" });
  }, [staticUrl, name, variant, presentation]);

  const [dynIdx, setDynIdx] = useState(() => skipFailed(dynamicCandidates, 0));
  const [loadedDynamicUrl, setLoadedDynamicUrl] = useState<string | null>(null);
  useEffect(() => {
    setDynIdx(skipFailed(dynamicCandidates, 0));
  }, [dynamicCandidates]);

  const dynamicUrl =
    dynamicCandidates.length && dynIdx < dynamicCandidates.length
      ? dynamicCandidates[dynIdx]
      : null;

  const bg = resolved.brandColor || (variant === "bank" ? "#3b82f6" : "#64748b");
  const FallbackIcon = variant === "bank" ? Building2 : Store;

  // Cartões usam apenas o cardMark explícito, respeitando os que precisam da
  // cor original. Listas mantêm o asset colorido e seu fallback independente.
  if (variant === "bank") {
    const isWide =
      BANK_WORDMARK_SLUGS.has(resolved.slug ?? "") && staticUrl !== resolved.compactLogoUrl;
    const imageUrl = staticUrl ?? dynamicUrl;
    const showFallback = !staticUrl && (!dynamicUrl || loadedDynamicUrl !== dynamicUrl);

    return (
      <span
        className={cn(
          "relative shrink-0",
          presentation === "card" && "inline-flex h-10 w-[116px] max-w-full items-center justify-start text-current",
          presentation !== "card" && "inline-grid place-items-center overflow-hidden",
          presentation !== "card" && "bg-white text-slate-700 ring-1 ring-inset ring-black/10",
          presentation === "badge" && "h-10 w-10 rounded-[12px]",
          presentation === "tiny" && "h-6 w-6 rounded-[6px]",
          className,
        )}
        aria-hidden
      >
        {showFallback && (
          resolved.initial && resolved.initial !== "?" ? (
            <span
              className={cn(
                "font-bold leading-none",
              presentation === "card" && "text-2xl",
                presentation === "badge" && "text-sm",
                presentation === "tiny" && "text-[10px]",
              )}
            >
              {resolved.initial}
            </span>
          ) : (
            <FallbackIcon className={presentation === "tiny" ? "h-3 w-3" : "h-4 w-4"} />
          )
        )}
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className={cn(
              "pointer-events-none block object-contain",
              presentation === "card"
                ? cn("h-full max-h-full w-auto object-left", resolved.cardMark?.shape === "symbol" ? "max-w-[68px]" : "max-w-[116px]")
                : "absolute inset-0 h-full w-full object-center",
              presentation === "card" && resolved.cardMark?.colorMode !== "original" && (bankCardTone === "light" ? "brightness-0 invert" : "brightness-0"),
              presentation === "badge" && (isWide ? "p-1" : "p-1.5"),
              presentation === "tiny" && "p-0.5",
              dynamicUrl && !staticUrl && loadedDynamicUrl !== dynamicUrl && "opacity-0",
              imgClassName,
            )}
            onLoad={dynamicUrl && !staticUrl ? () => setLoadedDynamicUrl(dynamicUrl) : undefined}
            onError={() => {
              if (staticUrl) {
                failedUrls.add(staticUrl);
                setFailedStaticUrl(staticUrl);
              } else if (dynamicUrl) {
                failedUrls.add(dynamicUrl);
                setDynIdx((i) => skipFailed(dynamicCandidates, i + 1));
              }
            }}
            decoding="async"
          />
        )}
      </span>
    );
  }

  // ---------- variant: merchant ----------
  if (staticUrl) {
    return (
      <span
        className={cn(
          "transaction-avatar logo-mode relative grid place-items-center overflow-hidden",
          "h-9 w-9",
          className,
        )}
        aria-hidden
      >
        <img
          src={staticUrl}
          alt=""
          className={cn("h-full w-full object-contain", imgClassName)}
          onError={() => {
            failedUrls.add(staticUrl);
            setFailedStaticUrl(staticUrl);
          }}
          decoding="async"
        />
      </span>
    );
  }

  if (dynamicUrl) {
    return (
      <span
        className={cn(
          "transaction-avatar logo-mode relative grid place-items-center overflow-hidden rounded-full bg-white/95 ring-1 ring-black/5",
          "h-9 w-9",
          className,
        )}
        aria-hidden
      >
        <img
          src={dynamicUrl}
          alt=""
          className={cn("h-full w-full object-contain p-1", imgClassName)}
          onError={() => {
            failedUrls.add(dynamicUrl);
            setDynIdx((i) => skipFailed(dynamicCandidates, i + 1));
          }}
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "transaction-avatar relative grid place-items-center overflow-hidden rounded-full",
        "h-9 w-9",
        className,
      )}
      aria-hidden
      style={{ background: bg, color: "#fff" }}
    >
      {resolved.initial && resolved.initial !== "?" ? (
        <span className="text-xs font-bold leading-none text-white">{resolved.initial}</span>
      ) : (
        <FallbackIcon className="h-4 w-4 text-white" />
      )}
    </span>
  );
}

function skipFailed(candidates: string[], start: number): number {
  let i = start;
  while (i < candidates.length && failedUrls.has(candidates[i])) i++;
  return i;
}

export const BrandLogo = memo(BrandLogoBase);
