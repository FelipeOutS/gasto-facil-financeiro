import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { detectFinanceBrief, equivalentMonthWindows, namedFullMonthComparison } from "../src/server/whatsapp-finance-brief.server";
import { buildInteractiveFromReply, replyIdToTexto, MAIN_MENU_MARKER } from "../src/server/whatsapp-interactive.server";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PHONE = "5511999998888";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
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
      invoice_month text, fatura_competencia text
    );
    CREATE TABLE receitas(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      origem text, descricao text NOT NULL, valor numeric(14,2) NOT NULL,
      data date NOT NULL, mes smallint NOT NULL, ano integer NOT NULL,
      recorrencia_id uuid, deleted_at timestamptz
    );
    CREATE TABLE recorrencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL, origem text, status text);
    CREATE TABLE contas_a_pagar(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL, status text, data_pagamento date, gasto_id uuid);
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql", import.meta.url), "utf8"));
  return db;
}

test("comparação usa dias equivalentes e aceita meses completos nomeados", () => {
  expect(equivalentMonthWindows("2026-10-04")).toMatchObject({
    currentStart: "2026-10-01", currentEnd: "2026-10-05",
    previousStart: "2026-09-01", previousEnd: "2026-09-05",
  });
  expect(namedFullMonthComparison("compare setembro inteiro com agosto", "2026-10-04")).toMatchObject({
    currentStart: "2026-09-01", currentEnd: "2026-10-01",
    previousStart: "2026-08-01", previousEnd: "2026-09-01",
  });
  expect(detectFinanceBrief("Como estão minhas finanças?")).toBe("overview");
  expect(detectFinanceBrief("e mês passado?")).toBe("follow_previous");
  expect(detectFinanceBrief("gastei mais com alimentação?")).toBe("category");
  expect(detectFinanceBrief("onde estou gastando mais?")).toBe("top_category");
});

test("menu mantém comandos antigos e botão pós-lançamento preserva referência", () => {
  const menu = buildInteractiveFromReply(MAIN_MENU_MARKER);
  expect(menu?.type).toBe("list");
  if (menu?.type === "list") expect(menu.rows).toHaveLength(6);
  expect(replyIdToTexto("menu_receitas")).toBe("4");
  expect(replyIdToTexto("wa12_undo:44444444-4444-4444-8444-444444444444", "Desfazer"))
    .toBe("wa12_undo:44444444-4444-4444-8444-444444444444");
  expect(replyIdToTexto("wa12_edit_scope:44444444-4444-4444-8444-444444444444:occurrence", "Só esta receita"))
    .toBe("wa12_edit_scope:44444444-4444-4444-8444-444444444444:occurrence");
});

test("desfazer gasto é atômico, revoga conta vinculada e ignora replay", async () => {
  const db = await fixture();
  try {
    const gasto = "33333333-3333-4333-8333-333333333333";
    const action = "44444444-4444-4444-8444-444444444444";
    await db.exec(`
      INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento)
      VALUES ('${gasto}','${A}','whatsapp','Mercado',89.90,'2026-10-04',10,2026,'pix');
      INSERT INTO contas_a_pagar(user_id,status,data_pagamento,gasto_id)
      VALUES ('${A}','paga','2026-10-04','${gasto}');
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id)
      VALUES ('${action}','${A}','${PHONE}','wa-a','expense','${gasto}');
    `);
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${B}','${PHONE}','${action}') AS result`)).rows[0].result).toBe("unavailable");
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${action}') AS result`)).rows[0].result).toBe("undone");
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${action}') AS result`)).rows[0].result).toBe("already_undone");
    expect((await db.query(`SELECT id FROM gastos WHERE id='${gasto}'`)).rows).toHaveLength(0);
    const account = await db.query<{ status: string; gasto_id: string | null }>("SELECT status,gasto_id FROM contas_a_pagar");
    expect(account.rows[0]).toMatchObject({ status: "pendente", gasto_id: null });
  } finally { await db.close(); }
});

test("desfazer compra parcelada remove o grupo inteiro e receita recorrente distingue escopos", async () => {
  const db = await fixture();
  try {
    const group = "55555555-5555-4555-8555-555555555555";
    const first = "66666666-6666-4666-8666-666666666661";
    const action = "77777777-7777-4777-8777-777777777777";
    await db.exec(`
      INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento,grupo_parcelamento_id,total_parcelas)
      VALUES ('${first}','${A}','whatsapp','Tênis',100,'2026-10-04',10,2026,'credito','${group}',3),
      ('66666666-6666-4666-8666-666666666662','${A}','whatsapp','Tênis',100,'2026-10-04',10,2026,'credito','${group}',3),
      ('66666666-6666-4666-8666-666666666663','${A}','whatsapp','Tênis',100,'2026-10-04',10,2026,'credito','${group}',3);
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
      VALUES ('${action}','${A}','${PHONE}','wa-group','installment','${first}','${group}');
    `);
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${action}') AS result`)).rows[0].result).toBe("undone");
    expect((await db.query(`SELECT id FROM gastos WHERE grupo_parcelamento_id='${group}'`)).rows).toHaveLength(0);

    const recurrence = "88888888-8888-4888-8888-888888888888";
    const income = "99999999-9999-4999-8999-999999999999";
    const recurringAction = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(`
      INSERT INTO recorrencias(id,user_id,origem,status) VALUES ('${recurrence}','${A}','whatsapp','ativa');
      INSERT INTO receitas(id,user_id,origem,descricao,valor,data,mes,ano,recorrencia_id)
      VALUES ('${income}','${A}','whatsapp','Salário',3500,'2026-10-04',10,2026,'${recurrence}');
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
      VALUES ('${recurringAction}','${A}','${PHONE}','wa-income','recurring_income','${income}','${recurrence}');
    `);
    expect((await db.query<{ result: string }>(`SELECT whatsapp_edit_recent_action('${A}','${PHONE}','${recurringAction}','valor','3600.00','3500.00',NULL,NULL,'single') AS result`)).rows[0].result).toBe("choose_scope");
    expect((await db.query<{ result: string }>(`SELECT whatsapp_edit_recent_action('${A}','${PHONE}','${recurringAction}','valor','3600.00','3500.00',NULL,NULL,'occurrence') AS result`)).rows[0].result).toBe("updated");
    expect((await db.query<{ valor: string }>(`SELECT valor::text FROM receitas WHERE id='${income}'`)).rows[0].valor).toBe("3600.00");
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${recurringAction}','occurrence') AS result`)).rows[0].result).toBe("undone");
    expect((await db.query<{ status: string }>(`SELECT status FROM recorrencias WHERE id='${recurrence}'`)).rows[0].status).toBe("ativa");
    expect((await db.query(`SELECT id FROM receitas WHERE id='${income}'`)).rows).toHaveLength(0);

    const secondIncome = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const secondAction = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await db.exec(`
      INSERT INTO receitas(id,user_id,origem,descricao,valor,data,mes,ano,recorrencia_id)
      VALUES ('${secondIncome}','${A}','whatsapp','Salário',3500,'2026-11-04',11,2026,'${recurrence}');
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
      VALUES ('${secondAction}','${A}','${PHONE}','wa-income-2','recurring_income','${secondIncome}','${recurrence}');
    `);
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${secondAction}','series') AS result`)).rows[0].result).toBe("undone");
    expect((await db.query<{ status: string }>(`SELECT status FROM recorrencias WHERE id='${recurrence}'`)).rows[0].status).toBe("cancelada");
  } finally { await db.close(); }
});

test("edição rejeita confirmação antiga e respeita expiração", async () => {
  const db = await fixture();
  try {
    const gasto = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const action = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.exec(`
      INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento)
      VALUES ('${gasto}','${A}','whatsapp','Mercado',89.90,'2026-10-04',10,2026,'pix');
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id)
      VALUES ('${action}','${A}','${PHONE}','wa-edit','expense','${gasto}');
    `);
    const call = (before: string) => db.query<{ result: string }>(`SELECT whatsapp_edit_recent_action('${A}','${PHONE}','${action}','valor','79.90','${before}') AS result`);
    expect((await call("89.90")).rows[0].result).toBe("updated");
    expect((await call("89.90")).rows[0].result).toBe("changed");
    await db.exec(`UPDATE whatsapp_recent_actions SET expires_at=now()-interval '1 second' WHERE id='${action}'`);
    expect((await call("79.90")).rows[0].result).toBe("expired");
  } finally { await db.close(); }
});

test("grupo incompleto não sofre reversão parcial", async () => {
  const db = await fixture();
  try {
    const group = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const gasto = "10101010-1010-4010-8010-101010101010";
    const action = "20202020-2020-4020-8020-202020202020";
    await db.exec(`
      INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento,grupo_parcelamento_id,total_parcelas)
      VALUES ('${gasto}','${A}','whatsapp','Compra',100,'2026-10-04',10,2026,'credito','${group}',3),
      ('30303030-3030-4030-8030-303030303030','${A}','whatsapp','Compra',100,'2026-10-04',10,2026,'credito','${group}',3);
      INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id,related_id)
      VALUES ('${action}','${A}','${PHONE}','wa-incomplete','installment','${gasto}','${group}');
    `);
    expect((await db.query<{ result: string }>(`SELECT whatsapp_undo_recent_action('${A}','${PHONE}','${action}') AS result`)).rows[0].result).toBe("unavailable");
    expect((await db.query(`SELECT id FROM gastos WHERE grupo_parcelamento_id='${group}'`)).rows).toHaveLength(2);
  } finally { await db.close(); }
});
