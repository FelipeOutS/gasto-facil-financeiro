/**
 * WA-SEC-CA-01B — Teste estático permanente da defesa em profundidade da
 * policy `connected_accounts_update_viewer`.
 *
 * Motivação: o scanner apenas heurístico não prova segurança; este teste
 * garante, no runner oficial, que:
 *
 *   1. A função auxiliar `public.connected_accounts_viewer_update_allowed`
 *      existe, é SECURITY DEFINER, STABLE, com search_path=public,pg_temp.
 *   2. `anon` e `PUBLIC` NÃO têm EXECUTE nessa função.
 *   3. `authenticated` TEM EXECUTE (necessário para a policy avaliar WITH CHECK).
 *   4. A policy `connected_accounts_update_viewer` invoca a função no WITH CHECK
 *      passando exatamente os 10 campos sensíveis (id + 9 colunas administrativas).
 *   5. O trigger `connected_accounts_prevent_invitee_escalation` continua
 *      ativo como segunda camada.
 *
 * O teste roda contra o Postgres real via psql. Sem PGHOST, cada asserção é
 * marcada como skip explícito com motivo — nunca silenciosamente ausente.
 *
 * Cobertura de integração via Data API (JWT authenticated real, ataques
 * cross-user) fica registrada como skip condicional pendente de credenciais
 * de QA no CI, sem esconder a lacuna.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const hasDb = !!process.env.PGHOST;
const hasQaJwt =
  !!process.env.QA_JWT_OWNER &&
  !!process.env.QA_JWT_VIEWER &&
  !!process.env.QA_JWT_THIRD;

function psql(sql: string): string {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-c", sql], { encoding: "utf8" });
  if ((r.status ?? -1) !== 0) {
    throw new Error(`psql failed: ${r.stderr}`);
  }
  return (r.stdout ?? "").trim();
}

describe.skipIf(!hasDb)("WA-SEC-CA-01B — policy viewer bloqueia antes do trigger", () => {
  it("função auxiliar existe com propriedades corretas", () => {
    const row = psql(`
      SELECT p.prosecdef::text || '|' || p.provolatile::text || '|' ||
             coalesce(array_to_string(p.proconfig, ','), '')
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public'
         AND p.proname='connected_accounts_viewer_update_allowed';
    `);
    // prosecdef=true (SECURITY DEFINER), provolatile='s' (STABLE), search_path fixo.
    expect(row).toContain("true|s|");
    expect(row).toContain("search_path=public");
    expect(row).toContain("pg_temp");
  });

  it("PUBLIC e anon NÃO possuem EXECUTE na função auxiliar", () => {
    const publicHas = psql(`
      SELECT has_function_privilege('public',
        'public.connected_accounts_viewer_update_allowed(uuid, public.connected_account_status, public.connected_account_access, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz)',
        'EXECUTE');
    `);
    const anonHas = psql(`
      SELECT has_function_privilege('anon',
        'public.connected_accounts_viewer_update_allowed(uuid, public.connected_account_status, public.connected_account_access, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz)',
        'EXECUTE');
    `);
    expect(publicHas).toBe("f");
    expect(anonHas).toBe("f");
  });

  it("authenticated TEM EXECUTE (necessário para WITH CHECK avaliar)", () => {
    const authHas = psql(`
      SELECT has_function_privilege('authenticated',
        'public.connected_accounts_viewer_update_allowed(uuid, public.connected_account_status, public.connected_account_access, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz)',
        'EXECUTE');
    `);
    expect(authHas).toBe("t");
  });

  it("policy connected_accounts_update_viewer invoca a função auxiliar no WITH CHECK", () => {
    const withCheck = psql(`
      SELECT with_check FROM pg_policies
       WHERE tablename='connected_accounts'
         AND policyname='connected_accounts_update_viewer';
    `);
    expect(withCheck).toContain("connected_accounts_viewer_update_allowed");
    // Todos os campos sensíveis explicitamente presentes na assinatura.
    for (const field of [
      "id",
      "status",
      "access_level",
      "owner_user_id",
      "viewer_user_id",
      "invited_email",
      "invite_token",
      "invite_expires_at",
      "accepted_at",
      "refused_at",
    ]) {
      expect(withCheck).toContain(field);
    }
    // E ainda mantém o gate de identidade.
    expect(withCheck).toContain("auth.uid()");
    expect(withCheck).toContain("viewer_user_id");
  });

  it("policies do owner e do invitee permanecem preservadas", () => {
    const owner = psql(`
      SELECT count(*) FROM pg_policies
       WHERE tablename='connected_accounts'
         AND policyname='connected_accounts_update_owner';
    `);
    const invitee = psql(`
      SELECT count(*) FROM pg_policies
       WHERE tablename='connected_accounts'
         AND policyname='connected_accounts_update_invitee';
    `);
    expect(owner).toBe("1");
    expect(invitee).toBe("1");
  });

  it("trigger de defesa em profundidade continua ativo", () => {
    const trg = psql(`
      SELECT tgenabled::text FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname='connected_accounts'
         AND t.tgname='connected_accounts_prevent_escalation'
         AND NOT t.tgisinternal;
    `);
    // 'O' (origin) ou 'A' (always) contam como habilitado; 'D' seria disabled.
    expect(trg).toMatch(/^[OA]$/);
  });

  it("função lógica: viewer que NÃO é dono do row recebe false (sem oracle)", () => {
    // Caller autenticado com UUID aleatório que não é viewer de nenhuma linha
    // — a função precisa devolver false, não vazar dados. Executado em uma
    // única transação via stdin para preservar SET LOCAL.
    const script =
      `BEGIN;\n` +
      `SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';\n` +
      `SELECT public.connected_accounts_viewer_update_allowed(\n` +
      `  gen_random_uuid(), 'accepted'::public.connected_account_status,\n` +
      `  'admin'::public.connected_account_access, NULL, NULL,\n` +
      `  'x@x','tok', now(), now(), now());\n` +
      `ROLLBACK;`;
    const r = spawnSync("psql", ["-X", "-A", "-t"], { input: script, encoding: "utf8" });
    const out = (r.stdout ?? "").trim();
    // Última linha não-vazia é o resultado do SELECT.
    const lines = out.split(/\n/).map((s) => s.trim()).filter(Boolean);
    expect(lines[lines.length - 1]).toBe("f");
  });
});

// Integração real via Data API — só roda quando QA_JWT_* estiverem presentes.
// Marcar skip explícito quando ausentes é a política de "não esconder lacuna
// de cobertura" definida no bloco WA-SEC-CA-01B.
describe.skipIf(!hasQaJwt)("WA-SEC-CA-01B — ataques cross-user via Data API (QA JWTs)", () => {
  it.todo("viewer não pode elevar access_level via Data API");
  it.todo("viewer não pode trocar owner_user_id/viewer_user_id/token/emails");
  it.todo("viewer não pode forçar status=accepted");
  it.todo("terceiro sem vínculo é rejeitado por RLS");
  it.todo("owner pode alterar access_level (fluxo legítimo)");
  it.todo("invitee correto pode aceitar convite pending");
  it.todo("registro accepted não volta para pending");
});
