import { supabase } from "@/integrations/supabase/client";

/**
 * fetch() wrapper that automatically attaches the current Supabase session's
 * Bearer token. Use for all internal /api/* route calls that require auth.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { credentials: "include", ...init, headers });
}
