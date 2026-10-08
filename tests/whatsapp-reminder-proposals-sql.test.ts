import {test, expect} from "bun:test";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
const user="11111111-1111-4111-8111-111111111111";
test("reminder transaction: confirmation, ownership, replay and cancellation",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${user}');
      CREATE TABLE agenda_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
        kind text NOT NULL,titulo text NOT NULL,starts_at timestamptz,timezone text NOT NULL,
        recurrence_freq text,origem text NOT NULL,source_type text,source_id uuid,aviso_dias_antes integer,aviso_hora_local integer);
      CREATE TABLE cartoes(id uuid,user_id uuid);CREATE TABLE contas_a_pagar(id uuid,user_id uuid,status text);CREATE TABLE recorrencias(id uuid,user_id uuid);
      CREATE TABLE whatsapp_notification_templates(key text PRIMARY KEY,category text,default_priority text,
        requires_template_window boolean,meta_template_name text,payload_schema jsonb,active boolean);`);
    await db.exec(await readFile("supabase/migrations/20261007120000_whatsapp_reminder_proposals.sql","utf8"));
    const p=await db.query<{id:string}>(`INSERT INTO whatsapp_reminder_proposals(user_id,source_external_id,draft,expires_at)
      VALUES($1,'test',jsonb_build_object('kind','lembrete','titulo','Pagar energia','starts_at',now()+interval '2 hours','timezone','America/Sao_Paulo'),now()+interval '30 minutes') RETURNING id`,[user]);
    const id=p.rows[0].id;
    const wrong=await db.query<{result:any}>("SELECT whatsapp_reminder_resolve($1,$2,true) result",["22222222-2222-4222-8222-222222222222",id]);
    expect(wrong.rows[0].result.outcome).toBe("unavailable");
    const results=await Promise.all([db.query<{result:any}>("SELECT whatsapp_reminder_resolve($1,$2,true) result",[user,id]),
      db.query<{result:any}>("SELECT whatsapp_reminder_resolve($1,$2,true) result",[user,id])]);
    expect(results[0].rows[0].result.item.id).toBe(results[1].rows[0].result.item.id);
    expect((await db.query<{n:number}>("SELECT count(*)::int n FROM agenda_items")).rows[0].n).toBe(1);
    expect((await db.query<{draft:any}>("SELECT draft FROM whatsapp_reminder_proposals")).rows[0].draft).toEqual({});
    const c=await db.query<{id:string}>(`INSERT INTO whatsapp_reminder_proposals(user_id,source_external_id,draft,expires_at)
      VALUES($1,'cancel','{}',now()+interval '30 minutes') RETURNING id`,[user]);
    await db.query("SELECT whatsapp_reminder_resolve($1,$2,false)",[user,c.rows[0].id]);
    const cancelled=await db.query<{r:any}>("SELECT whatsapp_reminder_resolve($1,$2,true) r",[user,c.rows[0].id]);
    expect(cancelled.rows[0].r.outcome).toBe("cancelled");
    const source="33333333-3333-4333-8333-333333333333";
    await db.query("INSERT INTO contas_a_pagar VALUES($1,$2,'pendente')",[source,user]);
    const financial=await db.query<{id:string}>(`INSERT INTO whatsapp_reminder_proposals(user_id,source_external_id,draft,expires_at)
      VALUES($1,'financial',jsonb_build_object('kind','lembrete','titulo','Conta Energia','timezone','America/Sao_Paulo',
        'source_type','conta_a_pagar','source_id',$2::text,'aviso_dias_antes',3),now()+interval '30 minutes') RETURNING id`,[user,source]);
    const fr=await db.query<{r:any}>("SELECT whatsapp_reminder_resolve($1,$2,true) r",[user,financial.rows[0].id]);
    expect(fr.rows[0].r.item.source_id).toBe(source);
    expect(fr.rows[0].r.item.starts_at).toBeNull();
    expect((await db.query<{status:string}>("SELECT status FROM contas_a_pagar")).rows[0].status).toBe("pendente");
    await db.exec("SET ROLE authenticated");
    await expect(db.query("SELECT whatsapp_reminder_resolve($1,$2,true)",[user,id])).rejects.toThrow();
  } finally {await db.close();}
},30000);
