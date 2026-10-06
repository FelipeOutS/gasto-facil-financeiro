import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { detectCardLimitQuestion, detectPlanningIntent, parseMoney } from "../src/server/whatsapp-planning.server";
import { parseAlertPreference } from "../src/server/whatsapp-alert-preferences.server";
import { crossedBudgetThreshold } from "../src/server/whatsapp-proactive-alerts.server";
import { replyIdToTexto } from "../src/server/whatsapp-interactive.server";

const A="11111111-1111-4111-8111-111111111111";
const B="22222222-2222-4222-8222-222222222222";
const PHONE="5511999998888";
const ID="33333333-3333-4333-8333-333333333333";
async function fixture(){
  const db=new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${A}'),('${B}');
    CREATE FUNCTION public.has_feature_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE TABLE public.whatsapp_links(user_id uuid,telefone text,ativo boolean,opt_in_em timestamptz,revogado_em timestamptz);
    INSERT INTO public.whatsapp_links VALUES('${A}','${PHONE}',true,now(),null);
    CREATE TABLE public.metas_financeiras(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
      nome text NOT NULL,valor_objetivo numeric(14,2) NOT NULL,valor_atual numeric(14,2) NOT NULL DEFAULT 0,
      prazo date,color_hex text NOT NULL DEFAULT '#10b981');
    CREATE TABLE public.dinheiro_guardado(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
      meta_id uuid,valor numeric(14,2) NOT NULL);
    CREATE TABLE public.movimentacoes_meta(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
      meta_id uuid NOT NULL REFERENCES public.metas_financeiras(id) ON DELETE CASCADE,valor numeric(14,2) NOT NULL);
    CREATE TABLE public.recorrencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
      nome text NOT NULL,valor numeric NOT NULL,frequencia text NOT NULL,proxima_cobranca date,
      status text NOT NULL,tipo_recorrencia text,origem text,moeda text,ultimo_valor numeric);
    CREATE TABLE public.cartoes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
      nome text NOT NULL,banco text NOT NULL DEFAULT '',limite_total numeric(14,2) NOT NULL,dia_fechamento integer NOT NULL,dia_vencimento integer NOT NULL);
    CREATE TABLE public.whatsapp_notification_preferences(user_id uuid PRIMARY KEY REFERENCES auth.users(id));
    CREATE TABLE public.whatsapp_notification_templates(key text PRIMARY KEY,category text,
      default_priority text,requires_template_window boolean,meta_template_name text,payload_schema jsonb,active boolean,
      CONSTRAINT whatsapp_notification_templates_category_check CHECK(category IN ('contas_a_pagar','recorrencias','metas','orcamento','ia_insights','mercado','avisos_sistema')));
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261004140000_whatsapp_planning_actions.sql",import.meta.url),"utf8"));
  return db;
}
async function propose(db:PGlite,kind:string,payload:Record<string,unknown>,target:string|null=null,id=ID){
  const escaped=JSON.stringify(payload).replaceAll("'","''");
  await db.exec(`INSERT INTO whatsapp_planning_actions(id,user_id,telefone,source_external_id,kind,target_id,payload,state)
    VALUES('${id}','${A}','${PHONE}','wa-${id}','${kind}',${target?`'${target}'`:'NULL'},'${escaped}'::jsonb,'ready')`);
}
async function apply(db:PGlite,user=A,id=ID){
  const r=await db.query<{result:{status:string}}>(`SELECT whatsapp_apply_planning_action('${id}','${user}','${PHONE}') AS result`);
  return r.rows[0].result.status;
}

test("frases, menu e limiares são determinísticos",()=>{
  expect(parseMoney("R$ 10 mil")).toBe(10_000);
  expect(detectPlanningIntent("quero juntar 10 mil para uma viagem")?.kind).toBe("goal_create");
  expect(detectPlanningIntent("guardei 300 para viagem")?.kind).toBe("goal_add");
  expect(detectPlanningIntent("coloca 300 na primeira")?.term).toBe("primeira");
  expect(detectPlanningIntent("retirei 100 da meta viagem")?.kind).toBe("goal_withdraw");
  expect(detectPlanningIntent("assino Netflix por 39,90 por mês")?.kind).toBe("recurrence_create");
  expect(detectPlanningIntent("muda o limite do Nubank para 5000")?.payload.field).toBe("limit");
  expect(detectPlanningIntent("o fechamento agora é dia 3"))
    .toEqual({kind:"card_edit",payload:{field:"closing",raw:"3"}});
  expect(detectPlanningIntent("cancela 3")).toBeNull();
  expect(detectCardLimitQuestion("quanto falta de limite no Nubank?"))
    .toEqual({kind:"available",term:"nubank"});
  expect(detectCardLimitQuestion("qual cartão tem mais limite?"))
    .toEqual({kind:"highest"});
  expect(parseAlertPreference("me avisa quando eu atingir 80% do orçamento"))
    .toEqual({kind:"set",key:"orcamento",enabled:true});
  expect(parseAlertPreference("não quero mais alerta de fatura"))
    .toEqual({kind:"set",key:"faturas",enabled:false});
  expect(parseAlertPreference("PARAR")).toBeNull();
  expect(crossedBudgetThreshold(950,1000)).toBe(90);
  expect(crossedBudgetThreshold(1000,1000)).toBe(100);
  expect(replyIdToTexto(`wa13_confirm:${ID}`,"Confirmar")).toBe(`wa13_confirm:${ID}`);
});

test("orçamento 79→80→85→90→100 só muda de limiar em 80, 90 e 100", () => {
  expect([79, 80, 85, 90, 100].map(used => crossedBudgetThreshold(used, 100)))
    .toEqual([null, 80, 80, 90, 100]);
});

test("meta: criação única, aporte e retirada sem saldo manual negativo",async()=>{
  const db=await fixture();
  try{
    await propose(db,"goal_create",{name:"Viagem",amount:10000});
    expect(await apply(db,B)).toBe("missing");
    expect(await apply(db)).toBe("applied");
    expect(await apply(db)).toBe("already_applied");
    const rows=await db.query<{id:string;valor_objetivo:string}>("SELECT id,valor_objetivo FROM metas_financeiras");
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].valor_objetivo)).toBe(10000);
    const goal=rows.rows[0].id;
    await propose(db,"goal_add",{amount:300},goal,"44444444-4444-4444-8444-444444444444");
    expect(await apply(db,A,"44444444-4444-4444-8444-444444444444")).toBe("applied");
    await propose(db,"goal_withdraw",{amount:400},goal,"55555555-5555-4555-8555-555555555555");
    expect(await apply(db,A,"55555555-5555-4555-8555-555555555555")).toBe("insufficient_manual_amount");
    const v=await db.query<{valor_atual:string}>(`SELECT valor_atual FROM metas_financeiras WHERE id='${goal}'`);
    expect(Number(v.rows[0].valor_atual)).toBe(300);
  }finally{await db.close();}
});

test("meta com histórico não apaga movimentação; edição de cartão rejeita estado antigo",async()=>{
  const db=await fixture();
  try{
    const goal="66666666-6666-4666-8666-666666666666";
    await db.exec(`INSERT INTO metas_financeiras(id,user_id,nome,valor_objetivo) VALUES('${goal}','${A}','Carro',5000);
      INSERT INTO movimentacoes_meta(user_id,meta_id,valor) VALUES('${A}','${goal}',100);
      INSERT INTO cartoes(id,user_id,nome,limite_total,dia_fechamento,dia_vencimento)
      VALUES('77777777-7777-4777-8777-777777777777','${A}','Nubank',4000,3,10);`);
    await propose(db,"goal_cancel",{},goal);
    expect(await apply(db)).toBe("has_history");
    expect((await db.query("SELECT id FROM movimentacoes_meta")).rows).toHaveLength(1);
    await propose(db,"card_edit",{field:"limit",before:"3000",value:5000},
      "77777777-7777-4777-8777-777777777777","88888888-8888-4888-8888-888888888888");
    expect(await apply(db,A,"88888888-8888-4888-8888-888888888888")).toBe("changed_or_invalid");
    expect(Number((await db.query<{limite_total:string}>("SELECT limite_total FROM cartoes")).rows[0].limite_total)).toBe(4000);
  }finally{await db.close();}
});

test("recorrência confirma uma vez; cancelamento preserva a linha e não cria gasto",async()=>{
  const db=await fixture();
  try{
    await propose(db,"recurrence_create",{name:"Netflix",amount:39.90,frequency:"mensal",type:"assinatura"});
    expect(await apply(db)).toBe("applied");
    expect(await apply(db)).toBe("already_applied");
    const rec=(await db.query<{id:string;status:string}>("SELECT id,status FROM recorrencias")).rows[0];
    expect(rec.status).toBe("ativa");
    const action="99999999-9999-4999-8999-999999999999";
    await propose(db,"recurrence_cancel",{},rec.id,action);
    expect(await apply(db,A,action)).toBe("applied");
    expect((await db.query<{status:string}>(`SELECT status FROM recorrencias WHERE id='${rec.id}'`)).rows[0].status).toBe("cancelada");
  }finally{await db.close();}
});

test("preferências novas são opt-in, e edição de cartão só altera o dono",async()=>{
  const db=await fixture();
  try{
    await db.exec(`INSERT INTO whatsapp_notification_preferences(user_id) VALUES('${A}');
      INSERT INTO cartoes(id,user_id,nome,limite_total,dia_fechamento,dia_vencimento)
      VALUES('77777777-7777-4777-8777-777777777777','${A}','Nubank',4000,3,10);`);
    const prefs=(await db.query<{faturas:boolean;renovacao_assinatura:boolean;resumo_semanal:boolean;resumo_mensal:boolean}>(
      `SELECT faturas,renovacao_assinatura,resumo_semanal,resumo_mensal FROM whatsapp_notification_preferences WHERE user_id='${A}'`)).rows[0];
    expect(prefs).toEqual({faturas:false,renovacao_assinatura:false,resumo_semanal:false,resumo_mensal:false});
    await propose(db,"card_edit",{field:"limit",before:"4000",value:5000},"77777777-7777-4777-8777-777777777777");
    expect(await apply(db,B)).toBe("missing");
    expect(await apply(db)).toBe("applied");
    expect(Number((await db.query<{limite_total:string}>("SELECT limite_total FROM cartoes")).rows[0].limite_total)).toBe(5000);
  }finally{await db.close();}
});

test("confirmação revalida vínculo e recurso do plano antes de escrever",async()=>{
  const db=await fixture();
  try{
    await propose(db,"goal_create",{name:"Viagem",amount:10000});
    await db.exec(`UPDATE whatsapp_links SET revogado_em=now() WHERE user_id='${A}'`);
    expect(await apply(db)).toBe("not_authorized");
    await db.exec(`UPDATE whatsapp_links SET revogado_em=NULL WHERE user_id='${A}';
      CREATE OR REPLACE FUNCTION public.has_feature_access(uuid,text) RETURNS boolean
      LANGUAGE sql AS $$ SELECT $2 <> 'metas' $$;`);
    expect(await apply(db)).toBe("not_authorized");
    expect((await db.query("SELECT id FROM metas_financeiras")).rows).toHaveLength(0);
  }finally{await db.close();}
});
