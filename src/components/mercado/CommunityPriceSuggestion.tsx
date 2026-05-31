/**
 * Mercado Inteligente — Card de sugestão de Preço Comunitário (V2.3.3).
 *
 * Bloco discreto exibido em itens de lista/carrinho quando há preços
 * comunitários compatíveis. Não substitui o preço automaticamente — usa
 * callback `onUse` para que o consumidor controle o fluxo de salvamento.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import { Money } from "@/components/Money";
import type { CommunitySuggestion } from "@/lib/mercado/community-prices-suggestions";

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale === "en" ? "en-US" : "pt-BR");
  } catch {
    return iso;
  }
}

type LineProps = {
  s: CommunitySuggestion;
  locale: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
  compact?: boolean;
};

function SuggestionLine({ s, locale, t, compact }: LineProps) {
  const sourceLabel = t(`communityPrices.suggestions.source_${s.source}`, {
    defaultValue: s.source,
  });
  return (
    <div className={compact ? "min-w-0 flex-1" : "mt-1.5"}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          <Money value={s.price} />
        </span>
        <span className="truncate text-[12px] text-muted-foreground">{s.marketName}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        <span>{sourceLabel}</span>
        {" · "}
        <span>
          {t("communityPrices.suggestions.seenOn", { date: formatDate(s.seenAt, locale) })}
        </span>
        {s.validUntil ? (
          <>
            {" · "}
            <span>
              {t("communityPrices.suggestions.validUntil", {
                date: formatDate(s.validUntil, locale),
              })}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function CommunityPriceSuggestion({
  suggestions,
  onUse,
}: {
  suggestions: CommunitySuggestion[];
  onUse: (price: number) => void;
}) {
  const { t, i18n } = useTranslation("mercado");
  const [expanded, setExpanded] = useState(false);
  if (!suggestions.length) return null;
  const top = suggestions[0];
  const others = suggestions.slice(1);

  return (
    <div className="mt-2 rounded-2xl border border-brand/30 bg-brand/5 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand">
        <Tag className="h-3.5 w-3.5" />
        <span>{t("communityPrices.suggestions.title")}</span>
      </div>
      <SuggestionLine s={top} locale={i18n.language} t={t} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onUse(top.price)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-grad px-3 py-2 text-[12px] font-semibold text-primary-foreground shadow-elevated active:scale-[0.98]"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          {t("communityPrices.suggestions.usePrice")}
        </button>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border bg-card-elevated px-3 py-2 text-[12px] font-semibold text-foreground/80"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {t("communityPrices.suggestions.otherOptions", { count: others.length })}
          </button>
        )}
      </div>
      {expanded && others.length > 0 && (
        <ul className="mt-2 space-y-2 border-t border-brand/20 pt-2">
          {others.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <SuggestionLine s={s} locale={i18n.language} t={t} compact />
              <button
                type="button"
                onClick={() => onUse(s.price)}
                className="shrink-0 rounded-lg border border-border bg-card-elevated px-2.5 py-1.5 text-[11px] font-semibold text-foreground/80"
              >
                {t("communityPrices.suggestions.usePrice")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("communityPrices.suggestions.disclaimer")}
      </p>
    </div>
  );
}
