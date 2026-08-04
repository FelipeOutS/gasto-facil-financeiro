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
};

/**
 * Cache de módulo: URLs que falharam ao carregar (404/erro de rede). Evita
 * reexecutar a cascata e mostrar flicker em montagens subsequentes do mesmo
 * banco/merchant. Persiste durante a sessão.
 */
const failedUrls = new Set<string>();

/**
 * Cascata de logo (mesma ordem para bank e merchant):
 *  1. SVG estático local (bundle Vite — disponível imediatamente, sem flicker).
 *  2. Candidatos dinâmicos do Logo.dev (+ favicon fallbacks p/ merchants).
 *  3. Inicial colorida.
 *
 * Bancos conhecidos (Nubank, Mercado Pago, Itaú, Santander, Inter, C6, Bradesco,
 * Banco do Brasil, Caixa, PicPay, Will Bank, Neon) carregam instantaneamente
 * via SVG local — não há requisição externa.
 */
function BrandLogoBase({ name, variant, className, onDark, imgClassName }: Props) {
  const resolved: BrandResolved = variant === "bank" ? getBankLogo(name) : getMerchantLogo(name);

  // Logo.dev como fallback p/ qualquer nome sem SVG local.
  // Para bancos usamos trustedOnly p/ não cair em favicons genéricos.
  const dynamicCandidates = useMemo(() => {
    if (!name || resolved.logoUrl) return [];
    return getLogoCandidates(null, name, { trustedOnly: variant === "bank" });
  }, [resolved.logoUrl, name, variant]);

  const [dynIdx, setDynIdx] = useState(() => skipFailed(dynamicCandidates, 0));
  useEffect(() => {
    setDynIdx(skipFailed(dynamicCandidates, 0));
  }, [dynamicCandidates]);

  const staticUrl = resolved.logoUrl;
  const dynamicUrl =
    dynamicCandidates.length && dynIdx < dynamicCandidates.length
      ? dynamicCandidates[dynIdx]
      : null;

  const bg = resolved.brandColor || (variant === "bank" ? "#3b82f6" : "#64748b");
  const FallbackIcon = variant === "bank" ? Building2 : Store;

  // ---------- variant: bank + onDark (superfícies de cartão de crédito) ----------
  if (variant === "bank" && onDark) {
    if (staticUrl) {
      // Slugs cujo SVG local já é monocromático claro (branco) — renderiza
      // direto sobre o cartão escuro, mantendo o visual "premium".
      const WHITE_OPTIMIZED_SLUGS = new Set([
        "mercadopago-branco",
        "logo-santander",
        "Banco_Bradesco",
        "logo-caixa",
        "banco-inter",
        "Logo_C6_Bank",
      ]);
      // Wordmarks horizontais — variante wide para crescer um pouco.
      const WIDE_BANK_SLUGS = new Set([
        "mercadopago-branco",
        "logo-santander",
        "Banco_Bradesco",
        "banco-do-brasil",
        "picpay",
        "will-bank",
        "banco-inter",
      ]);
      const slug = resolved.slug ?? "";
      const isWhiteOptimized = WHITE_OPTIMIZED_SLUGS.has(slug);
      const isWide = WIDE_BANK_SLUGS.has(slug);

      // SVG colorido (Nubank roxo, PicPay verde, Itaú, BB, Neon, Will Bank) —
      // envolve em uma "pílula" branca discreta para garantir contraste em
      // qualquer gradiente de cartão. Instantâneo, sem requisição de rede.
      if (!isWhiteOptimized) {
        return (
          <span
            className={cn(
              "bank-logo-container relative inline-flex items-center justify-start overflow-visible",
              className,
            )}
            aria-hidden
          >
            <span className="inline-flex h-9 items-center justify-center rounded-md bg-white/95 px-2.5 py-1 shadow-sm ring-1 ring-black/5">
              <img
                src={staticUrl}
                alt=""
                className={cn(
                  "block h-auto w-auto max-h-6 max-w-[120px] object-contain",
                  imgClassName,
                )}
                decoding="async"
              />
            </span>
          </span>
        );
      }

      return (
        <span
          className={cn(
            "bank-logo-container relative inline-flex items-center justify-start overflow-hidden",
            isWide && "bank-logo-wide",
            className,
          )}
          aria-hidden
        >
          <img
            src={staticUrl}
            alt=""
            className={cn(
              "block h-auto w-auto max-h-full max-w-full object-contain object-left",
              imgClassName,
            )}
            decoding="async"
          />
        </span>
      );
    }
    // Fallback dinâmico (Logo.dev) — pílula branca para legibilidade no dark.
    if (dynamicUrl) {
      return (
        <span
          className={cn(
            "bank-logo-container relative inline-flex items-center justify-center overflow-hidden",
            className,
          )}
          aria-hidden
        >
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-white/95 p-1 ring-1 ring-black/5">
            <img
              src={dynamicUrl}
              alt=""
              className="h-full w-full object-contain"
              onError={() => {
                failedUrls.add(dynamicUrl);
                setDynIdx((i) => skipFailed(dynamicCandidates, i + 1));
              }}
              decoding="async"
            />
          </span>
        </span>
      );
    }
    // Fallback final — pílula com inicial colorida do banco.
    return (
      <span
        className={cn(
          "bank-logo-container relative inline-flex items-center justify-start overflow-hidden",
          className,
        )}
        aria-hidden
      >
        <span
          className="grid h-10 w-10 place-items-center rounded-lg text-sm font-bold text-white shadow-sm ring-1 ring-white/10"
          style={{ background: bg }}
        >
          {resolved.initial && resolved.initial !== "?" ? (
            resolved.initial
          ) : (
            <FallbackIcon className="h-4 w-4 text-white" />
          )}
        </span>
      </span>
    );
  }

  // ---------- variant: merchant / bank sem onDark ----------
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
