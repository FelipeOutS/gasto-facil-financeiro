/**
 * Mercado Inteligente — Resumo de economia estimada com Preço Comunitário (V2.3.3).
 *
 * Compara preço atual de cada item com o menor preço comunitário compatível.
 * Só soma quando o preço comunitário é MENOR que o do usuário. Não promete
 * "menor preço garantido".
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingDown } from "lucide-react";
import { Money } from "@/components/Money";
import {
  getSuggestionsFor,
  useActiveCommunityPrices,
  type CommunitySuggestion,
} from "@/lib/mercado/community-prices-suggestions";

export type SavingsItemInput = {
  nome: string;
  quantidade: number;
  precoEstimado?: number;
};

export function CommunityPriceSavingsSummary({
  items,
  preferredMarketId,
  preferredMarketName,
}: {
  items: SavingsItemInput[];
  preferredMarketId?: string | null;
  preferredMarketName?: string | null;
}) {
  const { t } = useTranslation("mercado");
  const { pool } = useActiveCommunityPrices();

  const { savings, comparedCount } = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const it of items) {
      if (!it.precoEstimado || it.precoEstimado <= 0) continue;
      const sugs: CommunitySuggestion[] = getSuggestionsFor(
        it.nome,
        pool,
        preferredMarketId,
        preferredMarketName,
        3,
      );
      if (!sugs.length) continue;
      const min = sugs.reduce((m, s) => Math.min(m, s.price), Number.POSITIVE_INFINITY);
      if (!Number.isFinite(min)) continue;
      const diff = (it.precoEstimado - min) * (it.quantidade || 1);
      if (diff > 0) {
        total += diff;
        count += 1;
      }
    }
    return { savings: total, comparedCount: count };
  }, [items, pool, preferredMarketId, preferredMarketName]);

  if (savings <= 0) return null;

  return (
    <section className="mt-4 rounded-3xl border border-success/30 bg-success/10 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-success/20 text-success">
          <TrendingDown className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {t("communityPrices.suggestions.estimatedSavings")}
          </h3>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-success">
            <Money value={savings} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("communityPrices.suggestions.savingsHint", { count: comparedCount })}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("communityPrices.suggestions.noGuarantee")}
          </p>
        </div>
      </div>
    </section>
  );
}
