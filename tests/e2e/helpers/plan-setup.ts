/**
 * Setup/teardown SEGURO do plano `free_ads` para o usuário QA.
 *
 * Regras críticas:
 *   - Atualiza APENAS a linha do UID/email QA. NUNCA faz UPDATE em massa.
 *   - Sempre roda rollback no afterAll, mesmo em caso de erro.
 *   - Se service role não estiver disponível, retorna `mode: "manual"` para
 *     o spec pular com mensagem clara.
 *   - Não cria server fn pública. Não escreve secrets em arquivo.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { E2EEnv } from "./env";

export type PlanSetupResult =
  | {
      mode: "admin";
      userId: string;
      restore: () => Promise<void>;
      assertNoFreeAds: () => Promise<void>;
    }
  | { mode: "manual"; reason: string };

function adminClient(env: E2EEnv): SupabaseClient {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("admin client requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveUserId(admin: SupabaseClient, env: E2EEnv): Promise<string | null> {
  if (env.qaUserId) return env.qaUserId;
  // listUsers é paginado; QA é poucos usuários no ambiente de teste.
  // Em produção real isso não é chamado (sem service role).
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const match = data.users.find((u) => (u.email ?? "").toLowerCase() === env.qaEmail.toLowerCase());
  return match?.id ?? null;
}

export async function setupFreeAdsForQAUser(env: E2EEnv): Promise<PlanSetupResult> {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return {
      mode: "manual",
      reason:
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não disponíveis. Coloque o usuário QA em free_ads manualmente antes de rodar.",
    };
  }
  const admin = adminClient(env);
  const userId = await resolveUserId(admin, env);
  if (!userId) {
    return { mode: "manual", reason: `Usuário QA ${env.qaEmail} não encontrado.` };
  }

  // SETUP — atualiza SOMENTE esta linha.
  const { error: setupErr } = await admin
    .from("user_plans")
    .update({
      plano: "free_ads",
      status: "ativo",
      current_period_end: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (setupErr) {
    throw new Error(`Falha ao colocar usuário QA em free_ads: ${setupErr.message}`);
  }

  const restore = async () => {
    const { error } = await admin
      .from("user_plans")
      .update({
        plano: "sem_assinatura",
        status: "sem_assinatura",
        current_period_end: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) {
      // Gritante: rollback é obrigatório.
      console.error("\n🚨 ROLLBACK FREE_ADS FALHOU para", userId, error.message);
      throw new Error(`ROLLBACK FREE_ADS FALHOU: ${error.message}`);
    }
  };

  const assertNoFreeAds = async () => {
    const { count, error } = await admin
      .from("user_plans")
      .select("user_id", { count: "exact", head: true })
      .eq("plano", "free_ads");
    if (error) throw error;
    if ((count ?? 0) !== 0) {
      throw new Error(`Há ${count} usuários em free_ads após teardown.`);
    }
  };

  return { mode: "admin", userId, restore, assertNoFreeAds };
}
