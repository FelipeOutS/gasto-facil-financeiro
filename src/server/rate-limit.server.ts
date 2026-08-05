/**
 * Rate-limit helper (server-side only).
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
  importPerUser: { limit: 20, windowSeconds: 3600 },
  flyerOcrPerUser: { limit: 20, windowSeconds: 3600 },
  onlineImportPerUser: { limit: 30, windowSeconds: 3600 },
  whatsappBoletoOcrPerUser: { limit: 10, windowSeconds: 3600 },
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
  dbError?: boolean;
};

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
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      _key: truncate(key, 200) ?? key,
      _route: truncate(route, 255) ?? route,
      _limit: limit,
      _window_seconds: windowSeconds,
      _ip_address: truncate(options.ip_address ?? null, 64) ?? undefined,
      _user_id: options.user_id ?? undefined,
      _user_agent: truncate(options.user_agent ?? null, 512) ?? undefined,
      _method: truncate(options.method ?? null, 16) ?? undefined,
    });
    if (error)
      return { blocked: false, count: 0, limit, retryAfterSeconds: windowSeconds, dbError: true };
    const row = Array.isArray(data) ? data[0] : data;
    const current = Number(row?.current_count ?? 0);
    const blocked = Boolean(row?.blocked);
    return { blocked, count: current, limit, retryAfterSeconds: windowSeconds };
  } catch {
    return { blocked: false, count: 0, limit, retryAfterSeconds: windowSeconds, dbError: true };
  }
}

// Contrato do corpo 429: `code` é o identificador estável para clientes e
// `error` é mantido por compatibilidade. Nenhum detalhe do limiter (limite,
// janela, chave, contador, user_id) é exposto.
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ code: "rate_limited", error: "rate_limited", message: "Muitas tentativas." }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export function userRateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ code: "rate_limited", error: "rate_limited", message: "Aguarde um pouco." }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
    },
  );
}


export async function enforceUserRateLimit(params: {
  scope: "ai" | "import" | "flyerOcr" | "onlineImport" | "whatsappBoletoOcr";
  userId: string;
  route: string;
  request?: Request;
  failMode?: "open" | "closed";
}): Promise<Response | null> {
  const preset =
    RATE_LIMIT_PRESETS[
      params.scope === "ai"
        ? "aiPerUser"
        : params.scope === "flyerOcr"
          ? "flyerOcrPerUser"
          : params.scope === "onlineImport"
            ? "onlineImportPerUser"
            : params.scope === "whatsappBoletoOcr"
              ? "whatsappBoletoOcrPerUser"
              : "importPerUser"
    ];
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

  if (result.dbError && params.failMode === "closed")
    return userRateLimitedResponse(preset.windowSeconds);
  if (!result.blocked) return null;
  return userRateLimitedResponse(result.retryAfterSeconds);
}
