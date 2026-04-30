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
export function useRoles(): RolesState {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (authLoading) return;
      if (!user) {
        setRoles([]);
        setLoading(false);
        return;
      }
      setLoading(true);

      // 1) Tenta auto-claim do primeiro owner. Se já houver um, retorna false (no-op).
      try {
        await supabase.rpc("claim_owner_if_first");
      } catch {
        // silencioso: se a função não existir ou falhar, ainda lemos as roles abaixo.
      }

      // 2) Busca roles do usuário atual
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (cancelled) return;
      if (error || !data) {
        setRoles([]);
      } else {
        setRoles(data.map((r) => r.role as AppRole));
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
