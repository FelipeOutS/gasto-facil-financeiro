import { supabase } from "@/integrations/supabase/client";
import { requireOnline } from "@/lib/use-online-status";

/**
 * fetch() wrapper that automatically attaches the current Supabase session's
 * Bearer token. Use for all internal /api/* route calls that require auth.
 *
 * Also enforces an online check before firing the request — when the device
 * is offline, this throws and shows the standard friendly toast so the caller
 * can stop its loading state in a single try/catch.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!(await requireOnline())) {
    throw new Error("offline");
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { credentials: "include", ...init, headers });
}
