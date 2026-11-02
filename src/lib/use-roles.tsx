import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type AppRole = "owner" | "admin" | "user";
// Share concurrent reads only. Never trust persisted browser roles or promote on navigation.
const inFlight = new Map<string, Promise<AppRole[]>>();
function loadRoles(userId: string): Promise<AppRole[]> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const promise = (async () => {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).abortSignal(AbortSignal.timeout(15000));
    if (error || !data) throw new Error("Não foi possível verificar permissões.");
    return data.map(row => row.role).filter((role): role is AppRole => role === "owner" || role === "admin" || role === "user");
  })();
  inFlight.set(userId, promise);
  void promise.then(() => { if (inFlight.get(userId) === promise) inFlight.delete(userId); }, () => { if (inFlight.get(userId) === promise) inFlight.delete(userId); });
  return promise;
}
export function useRoles() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ userId: string | null; roles: AppRole[]; loading: boolean; error: string | null }>({ userId: null, roles: [], loading: true, error: null });
  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      if (!userId) { setState({ userId, roles: [], loading: false, error: null }); return; }
      setState(previous => previous.userId === userId && !previous.loading ? previous : { userId, roles: [], loading: true, error: null });
      try {
        const roles = await loadRoles(userId);
        if (alive && request === generation) setState({ userId, roles, loading: false, error: null });
      } catch {
        if (alive && request === generation) setState({ userId, roles: [], loading: false, error: "Não foi possível verificar permissões." });
      }
    };
    void refresh();
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(resume, 60000);
    return () => { alive = false; generation++; clearInterval(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [userId, authLoading]);
  const current = !authLoading && state.userId === userId;
  const roles = current ? state.roles : [];
  return { roles, loading: authLoading || !current || state.loading, error: current ? state.error : null, isOwner: roles.includes("owner"), isAdmin: roles.includes("admin"), hasFullAccess: roles.includes("owner") || roles.includes("admin") };
}
