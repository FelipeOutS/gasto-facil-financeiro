/**
 * WA-SEC-CA-01B — Teste estático permanente da defesa em profundidade da
 * policy `connected_accounts_update_viewer`.
 *
 * Motivação: o scanner heurístico não prova segurança. Este teste, incluído
 * no runner oficial, garante que:
 *
 *   1. A função auxiliar `public.connected_accounts_viewer_update_allowed`
 *      existe, é SECURITY DEFINER, STABLE, com search_path=public,pg_temp.
 *   2. `anon` e `PUBLIC` NÃO têm EXECUTE nessa função.
 *   3. `authenticated` TEM EXECUTE (necessário para a policy avaliar WITH CHECK).
 *   4. A policy `connected_accounts_update_viewer` invoca a função no WITH CHECK
 *      passando os 10 campos sensíveis (id + 9 colunas administrativas).
 *   5. O trigger `connected_accounts_prevent_escalation` permanece ativo.
 *   6. A função retorna false para um caller que não é viewer do row
 *      (guarda anti-oracle).
 *
 * Sem PGHOST (ambiente de CI sem acesso managed), o describe inteiro é
 * marcado como skip explícito — o motivo fica visível no output do runner.
 *
 * Cobertura de integração via Data API real (JWT authenticated cross-user)
 * fica registrada como `it.todo` — skip visível pendente de credenciais QA,
 * nunca escondido.
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";

const hasDb = !!process.env.PGHOST;
const hasQaJwt =
  !!process.env.QA_JWT_OWNER &&
  !!process.env.QA_JWT_VIEWER &&
  !!process.env.QA_JWT_THIRD;

const FUNC_SIG =
  "public.connected_accounts_viewer_update_allowed(uuid, public.connected_account_status, public.connected_account_access, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz)";

function psql(sql: string): string {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-c", sql], { encoding: "utf8" });
  if ((r.status ?? -1) !== 0) {
    throw new Error(`psql failed: ${r.stderr}`);
  }
  return (r.stdout ?? "").trim();
}

// bun:test não expõe `describe.skipIf`. Emulação: usa `.skip` quando falta env.
const suite = hasDb ? describe : describe.skip;

suite("WA-SEC-CA-01B — policy viewer bloqueia antes do trigger", () => {
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
    expect(row.startsWith("true|s|")).toBe(true);
    expect(row).toContain("search_path=public");
    expect(row).toContain("pg_temp");
  });

  it("PUBLIC e anon NÃO possuem EXECUTE na função auxiliar", () => {
    const publicHas = psql(`SELECT has_function_privilege('public', '${FUNC_SIG}', 'EXECUTE');`);
    const anonHas = psql(`SELECT has_function_privilege('anon', '${FUNC_SIG}', 'EXECUTE');`);
    expect(publicHas).toBe("f");
    expect(anonHas).toBe("f");
  });

  it("authenticated TEM EXECUTE (necessário para WITH CHECK avaliar)", () => {
    const authHas = psql(`SELECT has_function_privilege('authenticated', '${FUNC_SIG}', 'EXECUTE');`);
    expect(authHas).toBe("t");
  });

  it("policy connected_accounts_update_viewer invoca função no WITH CHECK", () => {
    const withCheck = psql(`
      SELECT with_check FROM pg_policies
       WHERE tablename='connected_accounts'
         AND policyname='connected_accounts_update_viewer';
    `);
    expect(withCheck).toContain("connected_accounts_viewer_update_allowed");
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
    // 'O' (origin) ou 'A' (always) = habilitado; 'D' seria disabled.
    expect(/^[OA]$/.test(trg)).toBe(true);
  });

  it("função lógica: caller que NÃO é viewer do row recebe false (sem oracle)", () => {
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
    const bool = out.split(/\n/).map((s) => s.trim()).find((l) => l === "t" || l === "f");
    expect(bool).toBe("f");
  });
});

// Integração real via Data API — só roda quando QA_JWT_* estiverem presentes.
// `it.todo` mantém a lacuna visível no output do runner sem falhar.
const suiteJwt = hasQaJwt ? describe : describe.skip;
suiteJwt("WA-SEC-CA-01B — ataques cross-user via Data API (QA JWTs)", () => {
  it.todo("viewer não pode elevar access_level via Data API");
  it.todo("viewer não pode trocar owner_user_id/viewer_user_id/token/emails");
  it.todo("viewer não pode forçar status=accepted");
  it.todo("terceiro sem vínculo é rejeitado por RLS");
  it.todo("owner pode alterar access_level (fluxo legítimo)");
  it.todo("invitee correto pode aceitar convite pending");
  it.todo("registro accepted não volta para pending");
});
