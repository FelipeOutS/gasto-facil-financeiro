/**
 * Prompt 4A — Módulo central de configuração do Mercado Pago.
 *
 * Server-only — NUNCA importar em código client (contém leitura de secrets).
 *
 * Responsabilidades (fonte única da verdade):
 *   - resolver o ambiente (`production` | `sandbox`) de forma fail-closed;
 *   - devolver access token, webhook secret e public key do ambiente correto;
 *   - devolver URL base da API, notification_url, back_urls e redirect_uri;
 *   - expor estado de configuração + diagnóstico SANITIZADO (nunca valores);
 *   - garantir que sandbox JAMAIS use credencial de produção e vice-versa.
 *
 * Nenhuma rota deve ler `process.env.MERCADO_PAGO_*` diretamente.
 */

export type MpEnvironment = "production" | "sandbox";

export type MpConfigState =
  | "ok"
  | "legacy_production"
  | "unresolved_environment"
  | "ambiguous_environment"
  | "missing_production_credentials"
  | "missing_sandbox_credentials"
  | "missing_sandbox_base_url"
  | "credential_environment_mismatch";

export interface MpResolvedConfig {
  /** true somente quando é seguro criar novos checkouts. */
  ok: boolean;
  environment: MpEnvironment | null;
  state: MpConfigState;
  accessToken: string | null;
  webhookSecret: string | null;
  publicKey: string | null;
  apiBaseUrl: string;
  siteBaseUrl: string | null;
  notificationUrl: string | null;
  redirectUri: string | null;
  /** Novos checkouts permitidos? */
  allowNewCheckouts: boolean;
  /** Leitura/verificação de pagamentos históricos permitida? */
  allowHistoricalVerification: boolean;
  /** Fallback do secret legado de produção em uso. */
  legacyFallbackUsed: boolean;
  /** TTL (minutos) para novos checkouts. */
  checkoutTtlMinutes: number;
  /** Mensagens sanitizadas — nunca contêm valor de secret. */
  diagnostics: string[];
}

export const MP_API_BASE_URL = "https://api.mercadopago.com";
export const PRODUCTION_SITE_URL = "https://gastointeligente.com.br";
export const WEBHOOK_PATH = "/api/public/webhooks/mercadopago";
export const DEFAULT_CHECKOUT_TTL_MINUTES = 30;

type Env = Record<string, string | undefined>;

/** Classifica um token do MP pelo prefixo, sem revelar seu valor. */
export function classifyTokenPrefix(
  token: string | null | undefined,
): "production" | "sandbox" | "unknown" {
  const t = (token ?? "").trim();
  if (!t) return "unknown";
  if (t.startsWith("APP_USR-")) return "production";
  if (t.startsWith("TEST-")) return "sandbox";
  return "unknown";
}

function pick(env: Env, key: string): string | null {
  const v = env[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function ttlFromEnv(env: Env): number {
  const raw = pick(env, "MERCADO_PAGO_CHECKOUT_TTL_MINUTES");
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 5 || n > 24 * 60) return DEFAULT_CHECKOUT_TTL_MINUTES;
  return Math.floor(n);
}

function blocked(
  state: MpConfigState,
  diagnostics: string[],
  env: Env,
  environment: MpEnvironment | null = null,
  extra: Partial<MpResolvedConfig> = {},
): MpResolvedConfig {
  return {
    ok: false,
    environment,
    state,
    accessToken: null,
    webhookSecret: null,
    publicKey: null,
    apiBaseUrl: MP_API_BASE_URL,
    siteBaseUrl: null,
    notificationUrl: null,
    redirectUri: null,
    allowNewCheckouts: false,
    allowHistoricalVerification: false,
    legacyFallbackUsed: false,
    checkoutTtlMinutes: ttlFromEnv(env),
    diagnostics,
    ...extra,
  };
}

/**
 * Resolve a configuração do Mercado Pago.
 *
 * Regras de ambiente:
 *   - `MERCADO_PAGO_ENVIRONMENT=production` → produção;
 *   - `MERCADO_PAGO_ENVIRONMENT=sandbox`    → sandbox;
 *   - valor inválido (inclusive capitalização inesperada, ex. "Production")
 *     → `unresolved_environment`, novos fluxos BLOQUEADOS;
 *   - ausente/vazio → modo legado: se existir `MERCADO_PAGO_ACCESS_TOKEN`
 *     com prefixo `APP_USR-` (produção comprovada pelo próprio prefixo),
 *     resolve como `legacy_production` e mantém produção operante com aviso
 *     sanitizado. Qualquer outra combinação é ambígua e BLOQUEIA novos fluxos.
 *
 * Regras de credencial:
 *   - sandbox usa EXCLUSIVAMENTE os secrets `MERCADO_PAGO_SANDBOX_*`;
 *     nenhum fallback para produção, em nenhuma hipótese;
 *   - produção prioriza `MERCADO_PAGO_PRODUCTION_*` e cai para os secrets
 *     legados (`MERCADO_PAGO_ACCESS_TOKEN` / `_WEBHOOK_SECRET`) com aviso;
 *   - prefixo do token precisa combinar com o ambiente resolvido.
 */
export function resolveMercadoPagoConfig(env: Env = process.env as Env): MpResolvedConfig {
  const diagnostics: string[] = [];
  const raw = env["MERCADO_PAGO_ENVIRONMENT"];
  const declared = typeof raw === "string" ? raw.trim() : "";
  const ttl = ttlFromEnv(env);

  let environment: MpEnvironment | null = null;
  let legacyMode = false;

  if (declared === "production" || declared === "sandbox") {
    environment = declared;
  } else if (declared.length > 0) {
    diagnostics.push("MERCADO_PAGO_ENVIRONMENT com valor inválido (esperado 'production' ou 'sandbox')");
    return blocked("unresolved_environment", diagnostics, env);
  } else {
    // Ausente/vazio — modo legado retrocompatível.
    const legacyToken = pick(env, "MERCADO_PAGO_ACCESS_TOKEN");
    if (classifyTokenPrefix(legacyToken) === "production") {
      environment = "production";
      legacyMode = true;
      diagnostics.push(
        "MERCADO_PAGO_ENVIRONMENT ausente — operando em modo legacy_production (prefixo do token indica produção). Configure a variável explicitamente.",
      );
    } else {
      diagnostics.push(
        "MERCADO_PAGO_ENVIRONMENT ausente e credencial legada não identificável — configuração ambígua",
      );
      return blocked("ambiguous_environment", diagnostics, env);
    }
  }

  // ---------------- SANDBOX ----------------
  if (environment === "sandbox") {
    const accessToken = pick(env, "MERCADO_PAGO_SANDBOX_ACCESS_TOKEN");
    const webhookSecret = pick(env, "MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET");
    const publicKey = pick(env, "MERCADO_PAGO_SANDBOX_PUBLIC_KEY");
    const missing: string[] = [];
    if (!accessToken) missing.push("MERCADO_PAGO_SANDBOX_ACCESS_TOKEN");
    if (!webhookSecret) missing.push("MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET");
    if (!publicKey) missing.push("MERCADO_PAGO_SANDBOX_PUBLIC_KEY");
    if (missing.length > 0) {
      diagnostics.push(`Sandbox sem credenciais obrigatórias: ${missing.join(", ")} (sem fallback para produção)`);
      return blocked("missing_sandbox_credentials", diagnostics, env, "sandbox");
    }
    if (classifyTokenPrefix(accessToken) === "production") {
      diagnostics.push("Token configurado em MERCADO_PAGO_SANDBOX_ACCESS_TOKEN tem prefixo de produção — bloqueado");
      return blocked("credential_environment_mismatch", diagnostics, env, "sandbox");
    }
    const siteBaseUrl = pick(env, "MERCADO_PAGO_SANDBOX_BASE_URL");
    if (!siteBaseUrl) {
      diagnostics.push("Sandbox sem MERCADO_PAGO_SANDBOX_BASE_URL — não é permitido usar o domínio de produção");
      return blocked("missing_sandbox_base_url", diagnostics, env, "sandbox");
    }
    const notificationUrl =
      pick(env, "MERCADO_PAGO_SANDBOX_NOTIFICATION_URL") ??
      `${siteBaseUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
    return {
      ok: true,
      environment: "sandbox",
      state: "ok",
      accessToken,
      webhookSecret,
      publicKey,
      apiBaseUrl: MP_API_BASE_URL,
      siteBaseUrl: siteBaseUrl.replace(/\/+$/, ""),
      notificationUrl,
      redirectUri: pick(env, "MERCADO_PAGO_SANDBOX_REDIRECT_URI"),
      allowNewCheckouts: true,
      allowHistoricalVerification: true,
      legacyFallbackUsed: false,
      checkoutTtlMinutes: ttl,
      diagnostics,
    };
  }

  // ---------------- PRODUÇÃO ----------------
  const modernToken = pick(env, "MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN");
  const legacyToken = pick(env, "MERCADO_PAGO_ACCESS_TOKEN");
  const accessToken = modernToken ?? legacyToken;
  const modernSecret = pick(env, "MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET");
  const legacySecret = pick(env, "MERCADO_PAGO_WEBHOOK_SECRET");
  const webhookSecret = modernSecret ?? legacySecret;
  const legacyFallbackUsed = (!modernToken && !!legacyToken) || (!modernSecret && !!legacySecret);

  if (!accessToken || !webhookSecret) {
    diagnostics.push(
      "Produção sem access token e/ou webhook secret configurados (MERCADO_PAGO_PRODUCTION_* ou legados)",
    );
    return blocked("missing_production_credentials", diagnostics, env, "production");
  }
  if (classifyTokenPrefix(accessToken) === "sandbox") {
    diagnostics.push("Token de produção com prefixo de teste (TEST-) — bloqueado");
    return blocked("credential_environment_mismatch", diagnostics, env, "production");
  }
  if (legacyFallbackUsed) {
    diagnostics.push(
      "Usando secrets LEGADOS de produção (MERCADO_PAGO_ACCESS_TOKEN / MERCADO_PAGO_WEBHOOK_SECRET). Migrar para MERCADO_PAGO_PRODUCTION_*; fallback será removido em prompt posterior.",
    );
  }

  const siteBaseUrl = (pick(env, "MERCADO_PAGO_PRODUCTION_BASE_URL") ?? PRODUCTION_SITE_URL).replace(
    /\/+$/,
    "",
  );
  const notificationUrl =
    pick(env, "MERCADO_PAGO_PRODUCTION_NOTIFICATION_URL") ?? `${siteBaseUrl}${WEBHOOK_PATH}`;

  return {
    ok: true,
    environment: "production",
    state: legacyMode || legacyFallbackUsed ? "legacy_production" : "ok",
    accessToken,
    webhookSecret,
    publicKey: pick(env, "MERCADO_PAGO_PRODUCTION_PUBLIC_KEY") ?? pick(env, "MERCADO_PAGO_PUBLIC_KEY"),
    apiBaseUrl: MP_API_BASE_URL,
    siteBaseUrl,
    notificationUrl,
    redirectUri: pick(env, "MERCADO_PAGO_PRODUCTION_REDIRECT_URI") ?? pick(env, "MERCADO_PAGO_REDIRECT_URI"),
    allowNewCheckouts: true,
    allowHistoricalVerification: true,
    legacyFallbackUsed,
    checkoutTtlMinutes: ttl,
    diagnostics,
  };
}

/** Diagnóstico 100% sanitizado — seguro para log e para painel admin. */
export function mercadoPagoConfigDiagnostics(
  env: Env = process.env as Env,
): {
  environment: MpEnvironment | null;
  state: MpConfigState;
  allowNewCheckouts: boolean;
  allowHistoricalVerification: boolean;
  legacyFallbackUsed: boolean;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  hasPublicKey: boolean;
  notificationUrl: string | null;
  checkoutTtlMinutes: number;
  messages: string[];
} {
  const cfg = resolveMercadoPagoConfig(env);
  return {
    environment: cfg.environment,
    state: cfg.state,
    allowNewCheckouts: cfg.allowNewCheckouts,
    allowHistoricalVerification: cfg.allowHistoricalVerification,
    legacyFallbackUsed: cfg.legacyFallbackUsed,
    hasAccessToken: !!cfg.accessToken,
    hasWebhookSecret: !!cfg.webhookSecret,
    hasPublicKey: !!cfg.publicKey,
    notificationUrl: cfg.notificationUrl,
    checkoutTtlMinutes: cfg.checkoutTtlMinutes,
    messages: cfg.diagnostics,
  };
}

/** Ambiente persistido em novas linhas (`environment` das tabelas). */
export function environmentForPersistence(cfg: MpResolvedConfig): "production" | "sandbox" | "legacy_unknown" {
  return cfg.environment ?? "legacy_unknown";
}

/** Expiração calculada no servidor para um novo checkout. */
export function checkoutExpiresAt(cfg: MpResolvedConfig, now: Date = new Date()): Date {
  return new Date(now.getTime() + cfg.checkoutTtlMinutes * 60_000);
}

/** true quando o checkout já venceu (comparação server-side). */
export function isCheckoutExpired(expiresAt: string | Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= now.getTime();
}
