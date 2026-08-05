/**
 * P1-01 — Cabeçalhos de Segurança HTTP (Fase 1: Report-Only + Anti-Clickjacking)
 * 
 * Este módulo centraliza a definição da Content-Security-Policy-Report-Only
 * e do X-Frame-Options para garantir proteção uniforme em toda a aplicação.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

// Origens inventariadas no Prompt 12A
const ORIGINS = {
  self: "'self'",
  none: "'none'",
  unsafeInline: "'unsafe-inline'",
  data: "data:",
  blob: "blob:",
  googleFonts: "https://fonts.googleapis.com https://fonts.gstatic.com",
  googleTagManager: "https://www.googletagmanager.com",
  googleAds: "https://pagead2.googlesyndication.com https://adservice.google.com",
  googleStatic: "https://www.gstatic.com",
  mercadoPago: "https://sdk.mercadopago.com https://api.mercadopago.com https://www.mercadopago.com",
  lovableCloud: "https://*.lovable.app https://ai.gateway.lovable.dev",
  supabase: "https://*.supabase.co", // Fallback para compatibilidade
  logoDev: "https://img.logo.dev",
  unsplash: "https://images.unsplash.com",
  favicon: "https://favicon.im https://favicon.yandex.net https://icons.duckduckgo.com https://www.google.com/s2/favicons",
  openFoodFacts: "https://*.openfoodfacts.org",
  brasilApi: "https://brasilapi.com.br https://publica.cnpj.ws",
  bcb: "https://api.bcb.gov.br",
  facebook: "https://graph.facebook.com",
};

export const SECURITY_HEADERS = {
  // 1. CSP Report-Only (Não bloqueia, apenas loga violações no console)
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' ${ORIGINS.unsafeInline} ${ORIGINS.googleTagManager} ${ORIGINS.googleAds} ${ORIGINS.mercadoPago}`,
    `script-src-elem 'self' ${ORIGINS.unsafeInline} ${ORIGINS.googleTagManager} ${ORIGINS.googleAds} ${ORIGINS.mercadoPago}`,
    `style-src 'self' ${ORIGINS.unsafeInline} ${ORIGINS.googleFonts}`,
    `style-src-elem 'self' ${ORIGINS.unsafeInline} ${ORIGINS.googleFonts}`,
    `font-src 'self' ${ORIGINS.googleFonts} ${ORIGINS.googleStatic} ${ORIGINS.data}`,
    `img-src 'self' ${ORIGINS.data} ${ORIGINS.blob} ${ORIGINS.logoDev} ${ORIGINS.unsplash} ${ORIGINS.favicon} ${ORIGINS.googleStatic} ${ORIGINS.mercadoPago} ${ORIGINS.openFoodFacts}`,
    `connect-src 'self' ${ORIGINS.lovableCloud} ${ORIGINS.supabase} ${ORIGINS.mercadoPago} ${ORIGINS.googleTagManager} ${ORIGINS.googleAds} ${ORIGINS.bcb} ${ORIGINS.brasilApi} ${ORIGINS.openFoodFacts} ${ORIGINS.facebook} https://api.pwnedpasswords.com`,
    `frame-src 'self' ${ORIGINS.mercadoPago}`,
    "frame-ancestors 'none'", // Prevenção clickjacking desejada (em report-only)
    "form-action 'self' https://www.mercadopago.com.br https://www.mercadopago.com",
    `media-src 'self' ${ORIGINS.data} ${ORIGINS.blob}`,
    `worker-src 'self' ${ORIGINS.blob}`,
    "manifest-src 'self'",
    "upgrade-insecure-requests"
  ].join('; '),

  // 2. Proteção EFETIVA contra Clickjacking (Bloqueia framing)
  // Decisão: DENY (O app não é usado legitimamente dentro de iframes de terceiros)
  'X-Frame-Options': 'DENY',

  // 3. Headers já existentes em produção (Preservados para consistência)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * Aplica os headers de segurança a um objeto Headers do TanStack Start.
 */
export function applySecurityHeaders(headers: Headers) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    // Não sobrescrever se já existir (evita duplicação caso algum handler já defina)
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });
}
