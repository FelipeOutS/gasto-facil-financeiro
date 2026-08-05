export const SECURITY_HEADERS = {
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self' https://www.mercadopago.com.br https://www.mercadopago.com",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://pagead2.googlesyndication.com https://adservice.google.com https://sdk.mercadopago.com https://api.mercadopago.com https://www.mercadopago.com",
    "script-src-elem 'self' 'unsafe-inline' https://www.googletagmanager.com https://pagead2.googlesyndication.com https://adservice.google.com https://sdk.mercadopago.com https://api.mercadopago.com https://www.mercadopago.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://www.gstatic.com data:",
    "img-src 'self' data: blob: https://img.logo.dev https://images.unsplash.com https://favicon.im https://favicon.yandex.net https://icons.duckduckgo.com https://www.google.com/s2/favicons https://www.gstatic.com https://sdk.mercadopago.com https://www.mercadopago.com https://openfoodfacts.org",
    "connect-src 'self' https://lovable.app https://ai.gateway.lovable.dev https://supabase.co https://sdk.mercadopago.com https://api.mercadopago.com https://www.mercadopago.com https://www.googletagmanager.com https://pagead2.googlesyndication.com https://adservice.google.com https://api.bcb.gov.br https://brasilapi.com.br https://publica.cnpj.ws https://openfoodfacts.org https://graph.facebook.com https://api.pwnedpasswords.com",
    "frame-src 'self' https://sdk.mercadopago.com https://www.mercadopago.com https://www.mercadopago.com.br",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
    "report-uri /api/public/csp-report"
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

export function applySecurityHeaders(headers: Headers) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
}

