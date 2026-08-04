import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type AppRole = "owner" | "admin" | "user";

type RolesState = {
  roles: AppRole[];
  loading: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** Owner ou admin: tem acesso total a recursos administrativos / premium. */
  hasFullAccess: boolean;
};

/**
 * Carrega as roles do usuário autenticado e tenta auto-promover o primeiro
 * usuário a "owner" (Felipe), de forma SEGURA: o servidor só atribui owner se
 * ainda não existir nenhum dono. A partir desse momento a função no banco
 * retorna `false` e fica selada.
 *
 * Permissões NÃO são derivadas de CPF, e-mail visível ou texto de UI — são
 * lidas da tabela `user_roles` no servidor, com RLS restringindo escrita.
 */
const ROLES_CACHE_PREFIX = "gf-roles-cache:";
const ROLES_RUNTIME_CACHE_TTL_MS = 5 * 60_000;

let rolesRuntimeCache: { userId: string; roles: AppRole[]; loadedAt: number } | null = null;
let rolesRuntimeInFlight: { userId: string; promise: Promise<AppRole[] | null> } | null = null;

function getRuntimeRoles(userId: string): AppRole[] | null {
  if (
    rolesRuntimeCache?.userId === userId &&
    Date.now() - rolesRuntimeCache.loadedAt < ROLES_RUNTIME_CACHE_TTL_MS
  ) {
    return rolesRuntimeCache.roles;
  }
  return null;
}

function rememberRuntimeRoles(userId: string, roles: AppRole[]) {
  rolesRuntimeCache = { userId, roles, loadedAt: Date.now() };
  writeRolesCache(userId, roles);
}

function readRolesCache(userId: string): AppRole[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ROLES_CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppRole[]) : null;
  } catch {
    return null;
  }
}

function writeRolesCache(userId: string, roles: AppRole[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROLES_CACHE_PREFIX + userId, JSON.stringify(roles));
  } catch {
    /* ignore */
  }
}

export function useRoles(): RolesState {
  const { user, loading: authLoading } = useAuth();
  const initialRoles = user ? (getRuntimeRoles(user.id) ?? readRolesCache(user.id)) : null;
  const [roles, setRoles] = useState<AppRole[]>(initialRoles ?? []);
  const [loading, setLoading] = useState(!initialRoles);
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(
    initialRoles && user ? user.id : null,
  );

  // Hidratação síncrona do cache (evita perder permissões durante a navegação).
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setHydratedUserId(null);
      return;
    }
    if (hydratedUserId === user.id) return;
    const cached = getRuntimeRoles(user.id) ?? readRolesCache(user.id);
    if (cached) {
      setRoles(cached);
      setLoading(false);
    }
    setHydratedUserId(user.id);
  }, [user, authLoading, hydratedUserId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (authLoading) return;
      if (!user) {
        setRoles([]);
        setLoading(false);
        return;
      }
      const runtimeCached = getRuntimeRoles(user.id);
      if (runtimeCached) {
        setRoles(runtimeCached);
        setLoading(false);
        return;
      }

      const hasCache = !!readRolesCache(user.id);
      if (!hasCache) setLoading(true);

      const next = await (rolesRuntimeInFlight?.userId === user.id
        ? rolesRuntimeInFlight.promise
        : (() => {
            const promise = (async () => {
              try {
                await supabase.rpc("claim_owner_if_first");
              } catch {
                // silencioso
              }

              const { data, error } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", user.id);

              if (error || !data) return null;
              return data.map((r) => r.role as AppRole);
            })();
            rolesRuntimeInFlight = { userId: user.id, promise };
            promise.finally(() => {
              if (rolesRuntimeInFlight?.promise === promise) {
                rolesRuntimeInFlight = null;
              }
            });
            return promise;
          })());

      if (cancelled) return;
      if (!next) {
        if (!hasCache) setRoles([]);
      } else {
        setRoles(next);
        rememberRuntimeRoles(user.id, next);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const isOwner = roles.includes("owner");
  const isAdmin = roles.includes("admin");
  return {
    roles,
    loading,
    isOwner,
    isAdmin,
    hasFullAccess: isOwner || isAdmin,
  };
}
