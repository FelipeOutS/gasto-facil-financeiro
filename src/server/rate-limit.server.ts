/**
 * Rate-limit helper (server-side only).
 *
 * Conta eventos da tabela `rate_limit_events` numa janela deslizante e
 * decide se a chamada atual deve ser bloqueada. NÃO armazena body, headers,
 * tokens, cookies — apenas IP, user-agent, rota, método, user_id e a key.
 *
 * Falhas internas (DB indisponível etc.) NUNCA bloqueiam o fluxo principal:
 * em caso de erro o helper retorna `blocked: false` para não derrubar o app.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RateLimitPreset = {
  limit: number;
  windowSeconds: number;
};

export const RATE_LIMIT_PRESETS = {
  mpWebhook: { limit: 120, windowSeconds: 60 },
  whatsappWebhook: { limit: 60, windowSeconds: 60 },
  publicApi: { limit: 60, windowSeconds: 60 },
  aiPerUser: { limit: 20, windowSeconds: 3600 },
  importPerUser: { limit: 10, windowSeconds: 3600 },
  flyerOcrPerUser: { limit: 40, windowSeconds: 3600 },
  authAttempt: { limit: 10, windowSeconds: 600 },
} satisfies Record<string, RateLimitPreset>;

export type CheckRateLimitOptions = {
  key: string;
  route: string;
  limit: number;
  windowSeconds: number;
  ip_address?: string | null;
  user_id?: string | null;
  user_agent?: string | null;
  method?: string | null;
};

export type CheckRateLimitResult = {
  blocked: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
};

/**
 * Extrai um IP "best effort" a partir dos headers da Request.
 * Em Cloudflare Workers `cf-connecting-ip` é o mais confiável; cai para
 * `x-forwarded-for` e `x-real-ip` em outros ambientes.
 */
export function getClientIp(request: Request): string | null {
  const h = request.headers;
  const candidates = [
    h.get("cf-connecting-ip"),
    h.get("x-real-ip"),
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  ];
  for (const c of candidates) {
    if (c && c.length > 0 && c.length <= 64) return c;
  }
  return null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function checkRateLimit(
  options: CheckRateLimitOptions,
): Promise<CheckRateLimitResult> {
  const { key, route, limit, windowSeconds } = options;
  const sinceISO = new Date(Date.now() - windowSeconds * 1000).toISOString();

  try {
    const { count } = await supabaseAdmin
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", sinceISO);

    const current = count ?? 0;
    const blocked = current >= limit;

    // Registra o evento (não bloqueia o fluxo se falhar).
    try {
      await supabaseAdmin.from("rate_limit_events").insert({
        key,
        route: truncate(route, 255) ?? route,
        ip_address: truncate(options.ip_address ?? null, 64),
        user_id: options.user_id ?? null,
        user_agent: truncate(options.user_agent ?? null, 512),
        method: truncate(options.method ?? null, 16),
        blocked,
      });
    } catch (err) {
      console.error("[rate-limit] insert failed", err);
    }

    return {
      blocked,
      count: current + 1,
      limit,
      retryAfterSeconds: windowSeconds,
    };
  } catch (err) {
    console.error("[rate-limit] check failed", err);
    return { blocked: false, count: 0, limit, retryAfterSeconds: windowSeconds };
  }
}

/**
 * Helper para construir resposta 429 padronizada (rotas internas).
 */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Muitas tentativas. Tente novamente em alguns instantes.",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

/**
 * Resposta amigável para rate-limit por usuário (rotas autenticadas).
 */
export function userRateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Muitas tentativas. Aguarde um pouco antes de tentar novamente.",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

/**
 * Aplica rate-limit por usuário em handlers já autenticados (IA, OCR, importações).
 * Registra audit log quando bloqueia. Nunca quebra fluxo em caso de erro interno.
 *
 * Uso: const blocked = await enforceUserRateLimit({ scope: "ai", userId, route });
 *      if (blocked) throw blocked;   // (em createServerFn)
 *      if (blocked) return blocked;  // (em server route)
 */
export async function enforceUserRateLimit(params: {
  scope: "ai" | "import" | "flyerOcr";
  userId: string;
  route: string;
  request?: Request;
}): Promise<Response | null> {
  const preset =
    params.scope === "ai"
      ? RATE_LIMIT_PRESETS.aiPerUser
      : params.scope === "flyerOcr"
        ? RATE_LIMIT_PRESETS.flyerOcrPerUser
        : RATE_LIMIT_PRESETS.importPerUser;
  const ip = params.request ? getClientIp(params.request) : null;
  const ua = params.request?.headers.get("user-agent") ?? null;

  const result = await checkRateLimit({
    key: `${params.scope}:${params.userId}`,
    route: params.route,
    user_id: params.userId,
    ip_address: ip,
    user_agent: ua,
    method: params.request?.method ?? "POST",
    limit: preset.limit,
    windowSeconds: preset.windowSeconds,
  });

  if (!result.blocked) return null;

  // Audit log opcional (não quebra fluxo se falhar).
  try {
    const { logAuditEvent } = await import("./logs.server");
    await logAuditEvent({
      actor_user_id: params.userId,
      target_user_id: params.userId,
      action:
        params.scope === "ai"
          ? "rate_limit_blocked_ai"
          : params.scope === "flyerOcr"
            ? "rate_limit_blocked_flyer_ocr"
            : "rate_limit_blocked_import",
      entity_type: "rate_limit",
      metadata: { route: params.route, limit: preset.limit, window_seconds: preset.windowSeconds },
    });
  } catch (err) {
    console.error("[rate-limit] audit log failed", err);
  }

  return userRateLimitedResponse(result.retryAfterSeconds);
}

