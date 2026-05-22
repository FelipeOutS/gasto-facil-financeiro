import { createClient } from "@supabase/supabase-js";

/**
 * Verifies a Bearer token from a Request and returns the authenticated user.
 * Returns null when missing/invalid. Use to gate /api/* server route handlers.
 */
export async function getUserFromRequest(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : getTokenFromCookies(request);
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
    const name = decodeURIComponent(rawName ?? "");
    const value = decodeURIComponent(rawValue.join("=") ?? "");
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

export function unauthorizedResponse(message = "Você precisa estar logado para conectar o Mercado Pago."): Response {
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
