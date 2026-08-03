import { createClient } from "@supabase/supabase-js";

/**
 * Verifies a Bearer token from a Request and returns the authenticated user.
 * Returns null when missing/invalid. Use to gate /api/* server route handlers.
 */
export async function getUserFromRequest(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim() || getTokenFromCookies(request);
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getUser(token);
  return data.user ?? null;
}

function getTokenFromCookies(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie) return "";
  const pairs = cookie.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    const [rawName, ...rawValue] = pair.split("=");
    const name = safeDecode(rawName ?? "");
    const value = safeDecode(rawValue.join("=") ?? "");
    if (!value) continue;
    if (name === "sb-access-token" || name.endsWith("-auth-token")) {
      try {
        const parsed = JSON.parse(value) as { access_token?: string } | [string, string];
        if (Array.isArray(parsed) && parsed[0]) return parsed[0];
        if (!Array.isArray(parsed) && parsed.access_token) return parsed.access_token;
      } catch {
        if (value.startsWith("eyJ")) return value;
      }
    }
  }
  return "";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function unauthorizedResponse(message = "Você precisa estar logado para conectar o Mercado Pago."): Response {
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Bypass de Admin Master para rotas internas: delega para a fonte única
 * server-side em `src/server/admin-master.server.ts`.
 */
import { hasAdminMasterRole } from "./admin-master.server";

export async function isAdminMasterUser(user: { id: string; email?: string | null } | null | undefined): Promise<boolean> {
  if (!user?.id) return false;
  return hasAdminMasterRole(user.id);
}


export function forbiddenResponse(message = "Acesso restrito ao administrador master."): Response {
  return new Response(JSON.stringify({ error: "forbidden", message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Etapa 23 — Resposta 403 enriquecida para bloqueios de plano.
 * Mantém os campos legados (`error`, `message`) para compatibilidade e
 * adiciona `code: "PREMIUM_FEATURE_REQUIRED"` + `feature` para que a UI
 * possa identificar o erro e abrir o modal premium em vez de toast genérico.
 */
export function premiumForbiddenResponse(
  feature: string,
  message = "Este recurso está disponível em planos superiores. Acesse Meu plano para liberar.",
  requiredPlan?: string,
): Response {
  return new Response(
    JSON.stringify({
      error: "forbidden",
      code: "PREMIUM_FEATURE_REQUIRED",
      feature,
      requiredPlan: requiredPlan ?? null,
      message,
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Server-side feature gate for premium import/OCR endpoints.
 * Returns null when access is allowed, otherwise a 403 Response.
 *
 * Centralizes the check so we never trust client-side plan checks alone.
 */
export async function ensurePremiumFeatureAccess(
  user: { id: string; email?: string | null } | null | undefined,
  feature: "importacoes" | "importar_extrato" | "importar_fatura" | "importar_conta" | "investimentos",
): Promise<Response | null> {
  if (!user) return unauthorizedResponse("Você precisa estar logado.");
  if (await isAdminMasterUser(user)) return null;
  try {
    const { getSubscriptionForUserIdentity } = await import("@/server/subscription.server");
    const { planAllowsFeature } = await import("@/lib/plans");
    const sub = await getSubscriptionForUserIdentity({
      userId: user.id,
      email: user.email ?? null,
      repairLink: false,
    });
    if (!sub.active) {
      return premiumForbiddenResponse(
        feature,
        "Sua assinatura não está ativa. Acesse Meu plano para liberar este recurso.",
      );
    }
    if (!planAllowsFeature(sub.plan, feature)) {
      return premiumForbiddenResponse(
        feature,
        "Este recurso está disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa.",
        "Controle Completo Pessoal",
      );
    }
    return null;
  } catch (err) {
    console.error("[ensurePremiumFeatureAccess] erro ao verificar plano", err);
    return forbiddenResponse("Não foi possível validar seu plano. Tente novamente.");
  }
}
