/**
 * Helpers de ambiente para os specs E2E do `free_ads`.
 *
 * Princípio: NUNCA hardcodar credenciais. NUNCA criar usuário real.
 * Se as variáveis necessárias não existirem, retornar um "guard" que faz
 * o spec pular com mensagem clara, em vez de falhar de forma confusa.
 *
 * Variáveis aceitas:
 *   E2E_BASE_URL                 (ex.: https://preview.../)
 *   E2E_QA_EMAIL                 (e-mail de uma conta QA já criada)
 *   E2E_QA_PASSWORD              (senha da conta QA)
 *   E2E_QA_USER_ID               (UID; opcional — recomendado p/ rollback seguro)
 *   SUPABASE_URL                 (apenas em ambiente de teste local/CI)
 *   SUPABASE_SERVICE_ROLE_KEY    (apenas em ambiente de teste local/CI)
 *
 * Service role só é usada por scripts de setup/teardown rodando FORA do
 * browser. Ela nunca entra no bundle do app e nunca é exposta ao client.
 */

export type E2EEnv = {
  baseUrl: string;
  qaEmail: string;
  qaPassword: string;
  qaUserId: string | null;
  supabaseUrl: string | null;
  serviceRoleKey: string | null;
};

export type E2EEnvResult =
  | { ok: true; env: E2EEnv }
  | { ok: false; reason: string };

export function readE2EEnv(): E2EEnvResult {
  const baseUrl = process.env.E2E_BASE_URL;
  const qaEmail = process.env.E2E_QA_EMAIL;
  const qaPassword = process.env.E2E_QA_PASSWORD;
  if (!baseUrl) return { ok: false, reason: "E2E_BASE_URL ausente." };
  if (!qaEmail) return { ok: false, reason: "E2E_QA_EMAIL ausente." };
  if (!qaPassword) return { ok: false, reason: "E2E_QA_PASSWORD ausente." };
  return {
    ok: true,
    env: {
      baseUrl,
      qaEmail,
      qaPassword,
      qaUserId: process.env.E2E_QA_USER_ID ?? null,
      supabaseUrl: process.env.SUPABASE_URL ?? null,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    },
  };
}

export function hasAdminAccess(env: E2EEnv): boolean {
  return !!(env.supabaseUrl && env.serviceRoleKey);
}
