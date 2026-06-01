/**
 * Helpers para mapear o resultado do lookup de imagem (Open Food Facts /
 * logo de marca) para os campos persistíveis em `community_market_prices`.
 *
 * Regras importantes:
 *  - A constraint do banco exige `^https?://` em `image_url`, por isso
 *    logos locais (`/logos/empresas/*.svg`) NÃO são persistidos. Eles
 *    continuam aparecendo como fallback visual em runtime via ProductCard.
 *  - Toda URL passa pela whitelist antes de ser gravada.
 *  - Confidence textual ("high|medium|low") é mapeada para numérica.
 */
import type { ProductImageResult } from "./product-image.functions";
import { validateImageUrl, type ImageSourceTag } from "./image-url-whitelist";

export type PersistableImage = {
  image_url: string | null;
  image_source: ImageSourceTag | null;
  image_confidence: number | null;
};

const EMPTY: PersistableImage = {
  image_url: null,
  image_source: null,
  image_confidence: null,
};

const CONF_MAP: Record<string, number> = {
  high: 0.9,
  medium: 0.65,
  low: 0.35,
};

/** Converte o resultado do lookup em campos seguros para insert/update. */
export function toPersistableImage(
  result: ProductImageResult | null | undefined,
): PersistableImage {
  if (!result || !result.imageUrl) return EMPTY;
  if (result.persistable === false) return EMPTY;
  const v = validateImageUrl(result.imageUrl);
  if (!v.ok) return EMPTY;
  // Logos locais não satisfazem a constraint de URL — pular persistência.
  if (v.origin === "local") return EMPTY;
  // Só persistimos quando a confiança é média ou alta — evita gravar
  // imagens duvidosas no banco. Baixa confiança continua aparecendo
  // como sugestão temporária em runtime.
  if (result.confidence !== "high" && result.confidence !== "medium") {
    return EMPTY;
  }

  const source: ImageSourceTag =
    v.origin === "openfoodfacts"
      ? "open_food_facts"
      : v.origin === "joanin"
        ? "joanin"
        : "manual";

  const confidence = result.confidence ? CONF_MAP[result.confidence] ?? null : null;

  return { image_url: v.url, image_source: source, image_confidence: confidence };
}

/** Para casos onde a imagem foi removida manualmente pelo usuário. */
export const EMPTY_IMAGE: PersistableImage = EMPTY;
