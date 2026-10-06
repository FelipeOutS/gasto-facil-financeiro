import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { financialIdForWhatsAppMessage } from "../src/server/whatsapp-financial-idempotency.server";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const hash = (token: string) => createHash("sha256").update("wa-link-v1:" + token).digest("hex");

async function database(extraLegacySql = "", onMigrationError?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${USER_A}'), ('${USER_B}');
    CREATE TABLE public.whatsapp_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      telefone text NOT NULL UNIQUE, ativo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      opt_in_em timestamptz, opt_in_version text, opt_in_user_agent text,
      revogado_em timestamptz
    );
    INSERT INTO public.whatsapp_links(user_id,telefone,ativo,opt_in_em)
    VALUES ('${USER_A}','5511999998888',true,now());
    CREATE TABLE public.recorrencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
    CREATE TABLE public.receitas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
    CREATE TABLE public.gastos(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE public.whatsapp_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      external_id text UNIQUE, telefone text NOT NULL, texto text NOT NULL,
      recebida_em timestamptz NOT NULL DEFAULT now(), status text NOT NULL,
      parsed jsonb, resposta_sugerida text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.create_recurring_income(
      p_user_id uuid, p_descricao text, p_valor numeric, p_data date,
      p_tipo text, p_frequencia text, p_dia_mes integer DEFAULT NULL,
      p_dia_semana integer DEFAULT NULL, p_observacao text DEFAULT NULL,
      p_origem text DEFAULT 'whatsapp'
    ) RETURNS TABLE(receita_id uuid, recorrencia_id uuid, proxima_cobranca date)
    LANGUAGE plpgsql AS $$
    BEGIN
      IF p_descricao = 'FAIL' THEN RAISE EXCEPTION 'transient'; END IF;
      INSERT INTO public.recorrencias(user_id) VALUES (p_user_id) RETURNING id INTO recorrencia_id;
      INSERT INTO public.receitas(user_id) VALUES (p_user_id) RETURNING id INTO receita_id;
      proxima_cobranca := p_data + 30;
      RETURN NEXT;
    END $$;
  `);
  if (extraLegacySql) await db.exec(extraLegacySql);
  const sql = await readFile(
    new URL("../supabase/migrations/20261004120000_whatsapp_trust_foundation.sql", import.meta.url),
    "utf8",
  );
  try {
    await db.exec(sql);
  } catch (error) {
    if (onMigrationError) await onMigrationError(db);
    await db.close();
    throw error;
  }
  return db;
}

test("migration aborta sem alterar dados se duas contas legadas compartilham o número físico", async () => {
  const unchanged = async (db: PGlite) => {
    const columns = await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='whatsapp_links'
        AND column_name='verification_state'
    `);
    expect(columns.rows[0].n).toBe(0);
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511999998888' AND ativo=true")).rows).toHaveLength(1);
  };
  await expect(database(`
    INSERT INTO whatsapp_links(user_id,telefone,ativo,opt_in_em)
    VALUES ('${USER_B}','11999998888',true,now());
  `, unchanged)).rejects.toThrow(/legacy whatsapp phone ownership conflict/);
  await expect(database(`
    INSERT INTO whatsapp_links(user_id,telefone,ativo,opt_in_em)
    VALUES ('${USER_B}','(11) 99999-8888',true,now());
  `, unchanged)).rejects.toThrow(/legacy whatsapp phone ownership conflict/);
});

test("site antigo ainda pode revogar, mas cliente autenticado não pode ativar, verificar ou trocar telefone", async () => {
  const db = await database();
  try {
    await db.exec("SET ROLE authenticated");
    const revoked = await db.query(
      "UPDATE whatsapp_links SET ativo=false, revogado_em=now() WHERE telefone='5511999998888' RETURNING id",
    );
    expect(revoked.rows).toHaveLength(1);
    expect((await db.query<{ verification_state: string }>(
      "SELECT verification_state FROM whatsapp_links WHERE telefone='5511999998888'",
    )).rows[0].verification_state).toBe("revoked");
    await expect(db.exec(
      "UPDATE whatsapp_links SET ativo=true, revogado_em=NULL WHERE telefone='5511999998888'",
    )).rejects.toThrow();
    await expect(db.exec(
      "UPDATE whatsapp_links SET verification_state='verified' WHERE telefone='5511999998888'",
    )).rejects.toThrow();
    await expect(db.exec(
      "UPDATE whatsapp_links SET telefone='5511999997777' WHERE telefone='5511999998888'",
    )).rejects.toThrow();
    await expect(db.exec(
      `INSERT INTO whatsapp_links(user_id,telefone) VALUES ('${USER_A}','5511999997777')`,
    )).rejects.toThrow();
    await db.exec("RESET ROLE");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511999998888' AND ativo=false")).rows).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("migration preserva legado e normaliza ativo+revogado; aliases não permitem segunda conta", async () => {
  const db = await database(`
    INSERT INTO whatsapp_links(user_id,telefone,ativo,opt_in_em,revogado_em)
    VALUES
      ('${USER_B}','5511988887777',true,now(),now()),
      ('${USER_B}','11999996666',true,now(),NULL),
      ('${USER_B}','5511977775555',false,NULL,now()),
      ('${USER_B}','5511955553333',true,NULL,NULL),
      ('33333333-3333-4333-8333-333333333333','5511966664444',true,now(),NULL);
  `);
  try {
    const revoked = await db.query<{ ativo: boolean; verification_state: string }>(
      "SELECT ativo,verification_state FROM whatsapp_links WHERE telefone='5511988887777'",
    );
    expect(revoked.rows[0]).toEqual({ ativo: false, verification_state: "revoked" });
    const inactive = await db.query<{ ativo: boolean; verification_state: string }>(
      "SELECT ativo,verification_state FROM whatsapp_links WHERE telefone='5511977775555'",
    );
    expect(inactive.rows[0]).toEqual({ ativo: false, verification_state: "revoked" });
    const noConsent = await db.query<{ verification_state: string; opt_in_em: string | null; verified_at: string | null }>(
      "SELECT verification_state,opt_in_em,verified_at FROM whatsapp_links WHERE telefone='5511955553333'",
    );
    expect(noConsent.rows[0]).toEqual({ verification_state: "verified", opt_in_em: null, verified_at: null });
    await expect(begin(db, USER_A, "5511999996666", "ZZZZZZZZZZZZ")).rejects.toThrow();
    expect((await begin(db, USER_B, "5511999996666", "YYYYYYYYYYYY")).status).toBe("already_active");
    await expect(begin(db, USER_A, "5511966664444", "XXXXXXXXXXXX")).rejects.toThrow();
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511999996666'")).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});

test("alias legado de 10 dígitos exige prova no número canônico sem perder vínculo antigo antes da confirmação", async () => {
  const db = await database(`
    INSERT INTO whatsapp_links(user_id,telefone,ativo,opt_in_em)
    VALUES ('${USER_B}','1188887777',true,now());
  `);
  try {
    const pending = await begin(db, USER_B, "5511988887777", "AAAAAAAAAAAA");
    expect(pending.status).toBe("pending");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='1188887777' AND ativo=true")).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511988887777' AND ativo=false")).rows).toHaveLength(1);
    expect(await complete(db, "5511988887777", "AAAAAAAAAAAA", "proof")).toBe("verified");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='1188887777' AND ativo=false")).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511988887777' AND ativo=true")).rows).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("vínculo legado ativo sem consentimento não é tratado como já verificado para uso", async () => {
  const db = await database(`
    INSERT INTO whatsapp_links(user_id,telefone,ativo,opt_in_em)
    VALUES ('${USER_B}','5511988887777',true,NULL);
  `);
  try {
    const pending = await begin(db, USER_B, "5511988887777", "AAAAAAAAAAAA");
    expect(pending.status).toBe("pending");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511988887777' AND ativo=false AND opt_in_em IS NULL")).rows).toHaveLength(1);
    expect(await complete(db, "5511988887777", "AAAAAAAAAAAA", "consent-proof")).toBe("verified");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511988887777' AND ativo=true AND opt_in_em IS NOT NULL")).rows).toHaveLength(1);
  } finally {
    await db.close();
  }
});

async function begin(db: PGlite, user: string, phone: string, token: string) {
  const result = await db.query<{ result: { status: string; link_id: string } }>(
    "SELECT public.whatsapp_begin_link_verification($1,$2,$3,$4,$5) AS result",
    [user, phone, hash(token), "whatsapp-channel-v2", "test"],
  );
  return result.rows[0].result;
}
async function complete(db: PGlite, phone: string, token: string, id: string) {
  const result = await db.query<{ result: string }>(
    "SELECT public.whatsapp_complete_link_verification($1,$2,$3) AS result",
    [phone, hash(token), id],
  );
  return result.rows[0].result;
}

test("vínculo exige posse do remetente, token válido e uso único; troca preserva o antigo até confirmação", async () => {
  const db = await database();
  try {
    const grants = await db.query<{ link_update: boolean; challenge_read: boolean; complete_execute: boolean; card_execute: boolean; card_close_execute: boolean }>(`
      SELECT has_table_privilege('authenticated','public.whatsapp_links','UPDATE') AS link_update,
             has_table_privilege('authenticated','public.whatsapp_link_challenges','SELECT') AS challenge_read,
             has_function_privilege('authenticated',
               'public.whatsapp_complete_link_verification(text,text,text)','EXECUTE') AS complete_execute,
             has_function_privilege('authenticated',
               'public.whatsapp_advance_card_session(uuid,text,uuid,uuid,text,text,timestamptz,text,jsonb,text)','EXECUTE') AS card_execute,
             has_function_privilege('authenticated',
               'public.whatsapp_close_card_sessions(uuid,text,text)','EXECUTE') AS card_close_execute
    `);
    expect(grants.rows[0]).toEqual({ link_update: true, challenge_read: false, complete_execute: false, card_execute: false, card_close_execute: false });
    const legacy = await db.query<{ verification_state: string; verified_at: string }>(
      "SELECT verification_state,verified_at FROM whatsapp_links WHERE telefone='5511999998888'",
    );
    expect(legacy.rows[0].verification_state).toBe("verified");
    expect(legacy.rows[0].verified_at).toBeTruthy();
    expect((await begin(db, USER_A, "5511999998888", "AAAAAAAAAAAA")).status).toBe("already_active");
    const pending = await begin(db, USER_A, "5511999997777", "BBBBBBBBBBBB");
    expect(pending.status).toBe("pending");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511999997777' AND ativo=true AND opt_in_em IS NOT NULL")).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM whatsapp_links WHERE telefone='5511999998888' AND ativo=true")).rows).toHaveLength(1);
    expect(await complete(db, "5511999996666", "BBBBBBBBBBBB", "wrong-phone")).toBe("invalid");
    expect(await complete(db, "5511999997777", "CCCCCCCCCCCC", "wrong-token")).toBe("invalid");
    await begin(db, USER_A, "5511999997777", "DDDDDDDDDDDD");
    expect(await complete(db, "5511999997777", "BBBBBBBBBBBB", "old-token")).toBe("invalid");
    await db.exec("UPDATE whatsapp_link_challenges SET expires_at=now()-interval '1 second'");
    expect(await complete(db, "5511999997777", "DDDDDDDDDDDD", "expired")).toBe("invalid");
    await begin(db, USER_A, "5511999997777", "EEEEEEEEEEEE");
    expect(await complete(db, "5511999997777", "EEEEEEEEEEEE", "valid")).toBe("verified");
    expect(await complete(db, "5511999997777", "EEEEEEEEEEEE", "replay")).toBe("invalid");
    const links = await db.query<{ telefone: string; ativo: boolean }>(
      "SELECT telefone,ativo FROM whatsapp_links WHERE user_id=$1 ORDER BY telefone", [USER_A],
    );
    expect(links.rows.filter((r) => r.ativo).map((r) => r.telefone)).toEqual(["5511999997777"]);
    await expect(begin(db, USER_B, "5511999997777", "FFFFFFFFFFFF")).rejects.toThrow();
    expect((await db.query("SELECT id FROM whatsapp_links WHERE user_id=$1 AND ativo=true", [USER_B])).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});

test("chaves simples e RPC recorrente impedem dupla gravação concorrente; falha permite retry", async () => {
  const db = await database();
  try {
    for (const [table, kind] of [["gastos", "expense"], ["receitas", "income_single"]] as const) {
      const id = financialIdForWhatsAppMessage(USER_A, "wamid-1", kind);
      await Promise.all([
        db.query(`INSERT INTO ${table}(id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, USER_A]),
        db.query(`INSERT INTO ${table}(id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, USER_A]),
      ]);
      const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id=$1`, [id]);
      expect(count.rows[0].n).toBe(1);
    }
    const args = [USER_A, "wamid-recurring", "Salário", 3500, "2026-10-04", "salario", "mensal", 5, null];
    const call = () => db.query<{ result: { receita_id: string; recorrencia_id: string; duplicate: boolean } }>(
      "SELECT public.whatsapp_create_recurring_income_once($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result", args,
    );
    const [first, second] = await Promise.all([call(), call()]);
    expect(first.rows[0].result.receita_id).toBe(second.rows[0].result.receita_id);
    expect([first.rows[0].result.duplicate, second.rows[0].result.duplicate].sort()).toEqual([false, true]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM whatsapp_financial_actions")).rows[0].n).toBe(1);
    expect((await call()).rows[0].result.duplicate).toBe(true);
    args[1] = "wamid-failed";
    args[2] = "FAIL";
    await expect(call()).rejects.toThrow();
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM whatsapp_financial_actions")).rows[0].n).toBe(1);
    args[2] = "Salário";
    expect((await call()).rows[0].result.duplicate).toBe(false);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM whatsapp_financial_actions")).rows[0].n).toBe(2);
  } finally {
    await db.close();
  }
});

test("PARAR e remoção revogam desafio atomicamente, inclusive em corrida com confirmação", async () => {
  const db = await database();
  try {
    await begin(db, USER_A, "5511999997777", "GGGGGGGGGGGG");
    const revoke = () => db.query("SELECT public.whatsapp_revoke_links($1,NULL)", [USER_A]);
    await Promise.all([complete(db, "5511999997777", "GGGGGGGGGGGG", "race"), revoke()]);
    expect((await db.query("SELECT id FROM whatsapp_links WHERE user_id=$1 AND ativo=true", [USER_A])).rows).toHaveLength(0);
    expect((await db.query("SELECT user_id FROM whatsapp_link_challenges WHERE user_id=$1", [USER_A])).rows).toHaveLength(0);
    await begin(db, USER_A, "5511999996666", "HHHHHHHHHHHH");
    await revoke();
    expect(await complete(db, "5511999996666", "HHHHHHHHHHHH", "late")).toBe("invalid");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE user_id=$1 AND ativo=true", [USER_A])).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});

test("quinta tentativa errada bloqueia a sexta; novo desafio restaura somente o token novo", async () => {
  const db = await database();
  try {
    await begin(db, USER_A, "5511999997777", "AAAAAAAAAAAA");
    for (let i = 0; i < 5; i++) {
      expect(await complete(db, "5511999997777", "BBBBBBBBBBBB", `wrong-${i}`)).toBe("invalid");
    }
    expect(await complete(db, "5511999997777", "AAAAAAAAAAAA", "sixth")).toBe("invalid");
    const attempts = await db.query<{ attempts: number }>(
      "SELECT attempts FROM whatsapp_link_challenges WHERE user_id=$1", [USER_A],
    );
    expect(attempts.rows[0].attempts).toBe(5);
    await begin(db, USER_A, "5511999997777", "CCCCCCCCCCCC");
    expect(await complete(db, "5511999997777", "AAAAAAAAAAAA", "old")).toBe("invalid");
    expect(await complete(db, "5511999997777", "CCCCCCCCCCCC", "new")).toBe("verified");
  } finally {
    await db.close();
  }
});

test("duas confirmações e duas trocas simultâneas terminam com um único vínculo ativo", async () => {
  const db = await database();
  try {
    await begin(db, USER_A, "5511999997777", "AAAAAAAAAAAA");
    const results = await Promise.all([
      complete(db, "5511999997777", "AAAAAAAAAAAA", "confirm-a"),
      complete(db, "5511999997777", "AAAAAAAAAAAA", "confirm-b"),
    ]);
    expect(results.sort()).toEqual(["invalid", "verified"]);
    const pending = await Promise.all([
      begin(db, USER_A, "5511999996666", "BBBBBBBBBBBB"),
      begin(db, USER_A, "5511999995555", "CCCCCCCCCCCC"),
    ]);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
    const valid = await complete(db, "5511999995555", "CCCCCCCCCCCC", "new-number");
    const old = await complete(db, "5511999996666", "BBBBBBBBBBBB", "old-number");
    expect(valid).toBe("verified");
    expect(old).toBe("invalid");
    expect((await db.query("SELECT id FROM whatsapp_links WHERE user_id=$1 AND ativo=true", [USER_A])).rows).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("cartão avança atomicamente, rejeita bifurcação e preserva sessão em falha", async () => {
  const db = await database();
  try {
    const advance = (expected: string | null, external: string) => db.query<{ result: string }>(
      "SELECT public.whatsapp_advance_card_session($1,$2,$3,NULL,$4,$5,now(),$6,$7::jsonb,$8) AS result",
      [USER_A, "5511999998888", expected, external, "cadastrar cartão",
        "cartao_cad_coleta", JSON.stringify({ kind: "cartao_cadastro", dados: {} }), "Qual é o nome?"],
    );
    const concurrent = await Promise.all([advance(null, "card-a"), advance(null, "card-b")]);
    expect(concurrent.map((r) => r.rows[0].result).sort()).toEqual(["advanced", "stale"]);
    const active = await db.query<{ id: string; external_id: string }>(
      "SELECT id,external_id FROM whatsapp_messages WHERE status='cartao_cad_coleta'",
    );
    expect(active.rows).toHaveLength(1);
    const id = active.rows[0].id;
    expect((await advance(id, active.rows[0].external_id)).rows[0].result).toBe("replay");
    await db.query(
      "INSERT INTO whatsapp_messages(user_id,external_id,telefone,texto,status,parsed) VALUES ($1,'collision',$2,'x','consulta','{}'::jsonb)",
      [USER_A, "5511999998888"],
    );
    await expect(db.query(
      "SELECT public.whatsapp_advance_card_session($1,$2,$3,NULL,$4,$5,now(),$6,$7::jsonb,$8)",
      [USER_A, "5511999998888", id, "collision", "erro", "cartao_cad_confirmacao",
        JSON.stringify({ kind: "cartao_cadastro", dados: {} }), "Confirmar?"],
    )).rejects.toThrow();
    expect((await db.query("SELECT id FROM whatsapp_messages WHERE id=$1 AND status='cartao_cad_coleta'", [id])).rows).toHaveLength(1);
    expect((await advance(id, "card-c")).rows[0].result).toBe("advanced");
    expect((await db.query("SELECT id FROM whatsapp_messages WHERE id=$1 AND status='expirada'", [id])).rows).toHaveLength(1);
    const closed = await db.query<{ result: number }>(
      "SELECT public.whatsapp_close_card_sessions($1,$2,'cancelada') AS result",
      [USER_A, "5511999998888"],
    );
    expect(closed.rows[0].result).toBe(1);
    expect((await db.query("SELECT id FROM whatsapp_messages WHERE status='cartao_cad_coleta'")).rows).toHaveLength(0);
    const afterCancel = await db.query<{ result: string }>(
      "SELECT public.whatsapp_advance_card_session($1,$2,$3,NULL,'card-late','late',now(),'cartao_cad_coleta',$4::jsonb,'late') AS result",
      [USER_A, "5511999998888", (await db.query<{ id: string }>(
        "SELECT id FROM whatsapp_messages WHERE external_id='card-c'",
      )).rows[0].id, JSON.stringify({ kind: "cartao_cadastro", dados: {} })],
    );
    expect(afterCancel.rows[0].result).toBe("stale");
    expect((await db.query("SELECT id FROM whatsapp_messages WHERE external_id='card-late'")).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});
