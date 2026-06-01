/**
 * Mercado Inteligente — whitelist segura de hosts de imagem de produto.
 *
 * Compartilhado entre cliente e servidor. Toda URL de imagem que vai ser
 * persistida ou exibida vinda de fonte externa (Joanin, Open Food Facts,
 * logos locais) deve passar por `isAllowedImageUrl`. URLs arbitrárias
 * coladas pelo usuário NÃO são aceitas — não há ponto de entrada para isso
 * nesta fase.
 *
 * Mantém alinhado com o constraint de URL em
 * `community_market_prices.image_url` (apenas http(s), ≤ 2048).
 */
export const VALID_IMAGE_SOURCES = [
  "open_food_facts",
  "joanin",
  "manual",
  "brand_logo",
  "none",
] as const;
export type ImageSourceTag = (typeof VALID_IMAGE_SOURCES)[number];

const OPENFOODFACTS_HOSTS = new Set([
  "images.openfoodfacts.org",
  "world.openfoodfacts.org",
  "static.openfoodfacts.org",
]);

// Hosts e subdomínios do Joanin Online onde imagens públicas de produto são
// servidas. Permitimos apenas o próprio domínio do parceiro.
const JOANIN_HOST_SUFFIXES = [".joaninonline.com.br", "joaninonline.com.br"];

function isJoaninHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return JOANIN_HOST_SUFFIXES.some((s) =>
    s.startsWith(".") ? h.endsWith(s) : h === s,
  );
}

export type AllowedImageOrigin = "openfoodfacts" | "joanin" | "local";

export type ImageValidationResult =
  | { ok: true; url: string; origin: AllowedImageOrigin }
  | { ok: false; reason: "invalid_url" | "host_not_allowed" | "too_long" };

const MAX_URL_LENGTH = 2048;

/**
 * Aceita apenas URLs http(s) cujos hostnames estão na whitelist.
 * Logos locais (`/logos/empresas/...svg`) também são considerados válidos
 * e marcados como `local`.
 */
export function validateImageUrl(raw: unknown): ImageValidationResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_url" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "invalid_url" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  // Logo local: começa com "/logos/empresas/" e termina com extensão de imagem.
  if (/^\/logos\/empresas\/[a-z0-9_\-]+\.(svg|png|jpg|jpeg|webp)$/i.test(trimmed)) {
    return { ok: true, url: trimmed, origin: "local" };
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "invalid_url" };
  }
  const host = u.hostname.toLowerCase();
  if (OPENFOODFACTS_HOSTS.has(host)) {
    u.protocol = "https:";
    return { ok: true, url: u.toString(), origin: "openfoodfacts" };
  }
  if (isJoaninHost(host)) {
    u.protocol = "https:";
    return { ok: true, url: u.toString(), origin: "joanin" };
  }
  return { ok: false, reason: "host_not_allowed" };
}

/** Atalho booleano para uso em parsers e UIs. */
export function isAllowedImageUrl(raw: unknown): boolean {
  return validateImageUrl(raw).ok;
}
