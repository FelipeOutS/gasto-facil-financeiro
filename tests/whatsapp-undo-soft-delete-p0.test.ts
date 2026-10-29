// P0: Desfazer gasto (WhatsApp e site) nunca apaga gasto soft-excluído.
// Tudo fictício: PGlite em memória (sem rede) + clientes falsos.
import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  deleteGastoAtivo,
  MSG_GASTO_EXCLUIDO_REVERSIVEL,
  MSG_GASTO_LEITURA_FALHOU,
  MSG_GASTO_MUDOU,
} from "../src/lib/whatsapp-gasto-delete";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PHONE = "5511900000000";
const G = "33333333-3333-4333-8333-333333333333";
const ACT = "44444444-4444-4444-8444-444444444444";
const GRP = "55555555-5555-4555-8555-555555555555";
const ACT2 = "66666666-6666-4666-8666-666666666666";

async function fixture(withCandidate: boolean) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE whatsapp_links(user_id uuid,telefone text,ativo boolean,opt_in_em timestamptz,revogado_em timestamptz);
    INSERT INTO whatsapp_links VALUES ('${A}','${PHONE}',true,now(),null);
    CREATE FUNCTION has_feature_access(uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${A}'), ('${B}');
    CREATE TABLE categorias(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE cartoes(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE gastos(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      origem text, descricao text NOT NULL, estabelecimento text NOT NULL DEFAULT '',
      valor numeric(14,2) NOT NULL, data date NOT NULL, mes smallint NOT NULL, ano integer NOT NULL,
      forma_pagamento text NOT NULL, categoria_id uuid, cartao_id uuid,
      grupo_parcelamento_id uuid, recorrencia_id uuid, total_parcelas smallint,
      invoice_month text, fatura_competencia text, deleted_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE receitas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      origem text, descricao text NOT NULL, valor numeric(14,2) NOT NULL, data date NOT NULL,
      mes smallint NOT NULL, ano integer NOT NULL, recorrencia_id uuid, deleted_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE recorrencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, origem text, status text);
    CREATE TABLE contas_a_pagar(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      status text, data_pagamento date, gasto_id uuid);
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql", import.meta.url), "utf8"));
  if (withCandidate) {
    await db.exec(await readFile(new URL("./sql/whatsapp/11-f2-prerequisites.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../docs/migrations-candidate/gastos-soft-delete-f2.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../docs/migrations-candidate/whatsapp-entry-mutations-v2.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../docs/migrations-candidate/whatsapp-undo-soft-delete.sql", import.meta.url), "utf8"));
  }
  await db.exec(`
    INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento)
    VALUES ('${G}','${A}','whatsapp','Mercado fictício',10,'2026-10-04',10,2026,'pix');
    INSERT INTO contas_a_pagar(user_id,status,data_pagamento,gasto_id) VALUES ('${A}','paga','2026-10-04','${G}');
    INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id)
    VALUES ('${ACT}','${A}','${PHONE}','wa-ficticio','expense','${G}');
  `);
  return db;
}
const undo = async (db: PGlite, user: string, action = ACT) =>
  (await db.query<{ r: string }>(`SELECT whatsapp_undo_recent_action('${user}','${PHONE}','${action}') AS r`)).rows[0].r;
const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

test("REPRODUÇÃO: RPC atual apaga de vez gasto soft-excluído e marca undone", async () => {
  const db = await fixture(false);
  await db.exec(`UPDATE gastos SET deleted_at = now() WHERE id='${G}'`);
  expect(await undo(db, A)).toBe("undone");
  expect(await count(db, `SELECT count(*) n FROM gastos WHERE id='${G}'`)).toBe(0); // bug
  await db.close();
});

test("candidato: gasto soft-excluído não é apagado, ação continua ativa, conta intacta", async () => {
  const db = await fixture(true);
  await db.exec(`SET gi.gastos_soft_delete='on'; UPDATE gastos SET deleted_at = now(), deleted_by=user_id, deletion_batch_id=gen_random_uuid(), deletion_source='site' WHERE id='${G}'; SET gi.gastos_soft_delete='off'`);
  expect(await undo(db, A)).toBe("soft_deleted");
  expect(await undo(db, A)).toBe("soft_deleted"); // clique duplo / webhook repetido
  expect(await count(db, `SELECT count(*) n FROM gastos WHERE id='${G}'`)).toBe(1);
  expect(await count(db, `SELECT count(*) n FROM whatsapp_recent_actions WHERE id='${ACT}' AND state='active'`)).toBe(1);
  expect(await count(db, `SELECT count(*) n FROM contas_a_pagar WHERE gasto_id='${G}' AND status='paga'`)).toBe(1);
  await db.close();
});

test("candidato: gasto ativo e restaurado continuam desfazendo como antes; replay idempotente", async () => {
  const db = await fixture(true);
  await db.exec(`SET gi.gastos_soft_delete='on'; UPDATE gastos SET deleted_at = now(), deleted_by=user_id, deletion_batch_id=gen_random_uuid(), deletion_source='site' WHERE id='${G}'; SET gi.gastos_soft_delete='off'`);
  expect(await undo(db, A)).toBe("soft_deleted");
  await db.exec(`SET gi.gastos_soft_delete='on'; UPDATE gastos SET deleted_at = NULL, deleted_by=NULL, deletion_batch_id=NULL, deletion_source=NULL WHERE id='${G}'; SET gi.gastos_soft_delete='off'`); // restaurado
  expect(await undo(db, B)).toBe("unavailable"); // outro usuário
  expect(await undo(db, A)).toBe("undone");
  expect(await undo(db, A)).toBe("already_undone");
  expect(await count(db, `SELECT count(*) n FROM gastos WHERE id='${G}' AND deleted_at IS NOT NULL`)).toBe(1);
  expect(await count(db, `SELECT count(*) n FROM contas_a_pagar WHERE status='pendente' AND gasto_id IS NULL`)).toBe(1);
  await db.close();
});

test("candidato: série parcelada com uma parcela soft-excluída fica inteira", async () => {
  const db = await fixture(true);
  const ids = ["77777777-7777-4777-8777-777777777771", "77777777-7777-4777-8777-777777777772", "77777777-7777-4777-8777-777777777773"];
  for (const [i, id] of ids.entries()) {
    await db.exec(`INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento,grupo_parcelamento_id,total_parcelas)
      VALUES ('${id}','${A}','whatsapp','TV fictícia',100,'2026-1${i}-01',1${i},2026,'credito','${GRP}',3)`);
  }
  await db.exec(`INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
    VALUES ('${ACT2}','${A}','${PHONE}','wa-ficticio-2','installment','${ids[0]}','${GRP}')`);
  await db.exec(`SET gi.gastos_soft_delete='on'; UPDATE gastos SET deleted_at = now(), deleted_by=user_id, deletion_batch_id=gen_random_uuid(), deletion_source='site' WHERE id='${ids[2]}'; SET gi.gastos_soft_delete='off'`);
  expect(await undo(db, A, ACT2)).toBe("soft_deleted");
  expect(await count(db, `SELECT count(*) n FROM gastos WHERE grupo_parcelamento_id='${GRP}'`)).toBe(3);
  await db.exec(`SET gi.gastos_soft_delete='on'; UPDATE gastos SET deleted_at = NULL, deleted_by=NULL, deletion_batch_id=NULL, deletion_source=NULL WHERE grupo_parcelamento_id='${GRP}'; SET gi.gastos_soft_delete='off'`);
  expect(await undo(db, A, ACT2)).toBe("undone");
  expect(await count(db, `SELECT count(*) n FROM gastos WHERE grupo_parcelamento_id='${GRP}' AND deleted_at IS NOT NULL`)).toBe(3);
  await db.close();
});

test("candidato: privilégios preservados (só service_role executa, INVOKER)", async () => {
  const db = await fixture(true);
  const r = await db.query<{ sd: boolean; auth: boolean; svc: boolean }>(`SELECT p.prosecdef sd,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('service_role', p.oid, 'EXECUTE') svc
    FROM pg_proc p WHERE proname='whatsapp_undo_recent_action'`);
  expect(r.rows[0]).toEqual({ sd: false, auth: false, svc: true });
  await db.close();
});

// ---- Pré-checagem TS do bot e exclusão do site (clientes falsos) ----
type Row = { id: string; user_id: string; deleted_at: string | null; grupo_parcelamento_id?: string | null };
function fakeClient(rows: Row[], opts: { readError?: boolean; flipOnDelete?: boolean } = {}) {
  const deletes: string[] = [];
  const client = {
    deletes,
    from(_t: string) {
      const f: Array<(r: Row) => boolean> = [];
      let op: "select" | "delete" = "select";
      const q = {
        select: () => q,
        delete: () => { op = "delete"; return q; },
        eq: (c: keyof Row, v: unknown) => { f.push((r) => r[c] === v); return q; },
        is: (c: keyof Row, v: unknown) => { f.push((r) => (r[c] ?? null) === v); return q; },
        in: (c: keyof Row, v: unknown[]) => { f.push((r) => v.includes(r[c])); return q; },
        or: (expr: string) => {
          const [a, b] = expr.split(",").map((p) => p.split(".eq."));
          f.push((r) => r[a[0] as keyof Row] === a[1] || r[b[0] as keyof Row] === b[1]);
          return q;
        },
        run() {
          if (opts.readError && op === "select") return { data: null, error: { code: "42703", message: "column deleted_at does not exist" } };
          if (op === "delete" && opts.flipOnDelete) rows.forEach((r) => (r.deleted_at = "2026-10-12T00:00:00Z"));
          const hit = rows.filter((r) => f.every((fn) => fn(r)));
          if (op === "delete") for (const h of hit) { deletes.push(h.id); rows.splice(rows.indexOf(h), 1); }
          return { data: hit.map((r) => ({ ...r })), error: null };
        },
        maybeSingle: async () => { const r = q.run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(q.run()).then(res, rej),
      };
      return q;
    },
  };
  return client;
}

test("site: excluir gasto soft-excluído é recusado sem DELETE", async () => {
  const c = fakeClient([{ id: G, user_id: A, deleted_at: "2026-10-10T00:00:00Z" }]);
  await expect(deleteGastoAtivo(c, A, G)).rejects.toThrow(MSG_GASTO_EXCLUIDO_REVERSIVEL);
  expect(c.deletes).toEqual([]);
});

test("site: gasto ativo é apagado; outro usuário vê 'not_found' sem apagar", async () => {
  const rows = [{ id: G, user_id: A, deleted_at: null }];
  const c = fakeClient(rows);
  expect(await deleteGastoAtivo(c, B, G)).toBe("not_found");
  expect(c.deletes).toEqual([]);
  expect(await deleteGastoAtivo(c, A, G)).toBe("deleted");
  expect(c.deletes).toEqual([G]);
});

test("site: falha de leitura (ex.: coluna ausente em produção) falha fechado", async () => {
  const c = fakeClient([{ id: G, user_id: A, deleted_at: null }], { readError: true });
  await expect(deleteGastoAtivo(c, A, G)).rejects.toThrow(MSG_GASTO_LEITURA_FALHOU);
  expect(c.deletes).toEqual([]);
});

test("site: gasto marcado entre leitura e DELETE não é apagado (condição atômica)", async () => {
  const c = fakeClient([{ id: G, user_id: A, deleted_at: null }], { flipOnDelete: true });
  await expect(deleteGastoAtivo(c, A, G)).rejects.toThrow(MSG_GASTO_MUDOU);
  expect(c.deletes).toEqual([]);
});

test("bot: pré-checagem do Desfazer bloqueia excluído, parcela excluída e erro de leitura", async () => {
  process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "ficticio";
  const { checkUndoSoftDelete, MSG_UNDO_GASTO_EXCLUIDO } = await import("../src/server/whatsapp-postlaunch.server");
  const exp = { user_id: A, entity_kind: "expense" as const, entity_id: G, related_id: null };
  expect(await checkUndoSoftDelete(fakeClient([{ id: G, user_id: A, deleted_at: null }]), exp)).toBeNull();
  expect(await checkUndoSoftDelete(fakeClient([{ id: G, user_id: A, deleted_at: "x" }]), exp)).toBe(MSG_UNDO_GASTO_EXCLUIDO);
  expect(await checkUndoSoftDelete(fakeClient([{ id: G, user_id: B, deleted_at: "x" }]), exp)).toBeNull(); // isolamento: RPC decide 'unavailable'
  const inst = { user_id: A, entity_kind: "installment" as const, entity_id: G, related_id: GRP };
  const serie = [
    { id: G, user_id: A, deleted_at: null, grupo_parcelamento_id: GRP },
    { id: ACT2, user_id: A, deleted_at: "x", grupo_parcelamento_id: GRP },
  ];
  expect(await checkUndoSoftDelete(fakeClient(serie), inst)).toBe(MSG_UNDO_GASTO_EXCLUIDO);
  expect(await checkUndoSoftDelete(fakeClient([], { readError: true }), exp)).toMatch(/Não consegui desfazer/);
});

test("candidato: edição manual posterior é preservada sem marcar ação desfeita", async()=>{
 const db=await fixture(true);try{
 await db.exec(`UPDATE gastos SET valor=99,updated_at=now()+interval '1 second' WHERE id='${G}'`);
 expect(await undo(db,A)).toBe("modified");
 expect(await count(db,`SELECT count(*) n FROM gastos WHERE id='${G}' AND valor=99 AND deleted_at IS NULL`)).toBe(1);
 expect(await count(db,`SELECT count(*) n FROM whatsapp_recent_actions WHERE id='${ACT}' AND state='active'`)).toBe(1);
 }finally{await db.close();}
});
