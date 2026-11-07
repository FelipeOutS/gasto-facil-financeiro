import {test,expect} from "bun:test";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
const user="11111111-1111-4111-8111-111111111111", hash="a".repeat(64);
test("batch item locking, correction, cancellation, replay and privacy",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${user}');
      CREATE TABLE whatsapp_messages(user_id uuid,status text,recebida_em timestamptz);`);
    await db.exec(await readFile("supabase/migrations/20261007130000_whatsapp_audio_batches.sql","utf8"));
    const inserted=await db.query<{id:string}>(`INSERT INTO whatsapp_audio_batches(user_id,phone_hash,source_external_id,items,expires_at)
      VALUES($1,$2,'wamid.test',$3::jsonb,now()+interval '30 minutes') RETURNING id`,[user,hash,JSON.stringify([
        {index:0,text:"gastei 85 mercado",state:"pending"},{index:1,text:"recebi 2300",state:"pending"},{index:2,text:"me lembra amanhã às 9 internet",state:"pending"}])]);
    const id=inserted.rows[0].id;
    async function action(index:number,act:string,text:string|null=null,owner=user) {
      return (await db.query<{r:any}>("SELECT whatsapp_audio_batch_item($1,$2,$3,$4,$5,$6) r",[owner,hash,id,index,act,text])).rows[0].r;
    }
    expect((await action(0,"pick",null,"22222222-2222-4222-8222-222222222222")).outcome).toBe("unavailable");
    expect((await action(0,"edit","gastei 80 mercado")).outcome).toBe("edited");
    expect((await action(0,"pick")).text).toBe("gastei 80 mercado");
    expect((await action(0,"pick")).outcome).not.toBe("picked");
    expect((await action(1,"pick")).outcome).toBe("pending_confirmation");
    const other=await db.query<{id:string}>(`INSERT INTO whatsapp_audio_batches(user_id,phone_hash,source_external_id,items,expires_at)
      VALUES($1,$2,'wamid.other','[{"index":0,"text":"gastei 10 almoço","state":"pending"}]',now()+interval '30 minutes') RETURNING id`,[user,hash]);
    const blocked=await db.query<{r:any}>("SELECT whatsapp_audio_batch_item($1,$2,$3,0,'pick',null) r",[user,hash,other.rows[0].id]);
    expect(blocked.rows[0].r.outcome).toBe("pending_confirmation");
    await action(0,"finish");
    expect((await action(2,"cancel")).outcome).toBe("cancelled");
    expect((await action(2,"pick")).outcome).toBe("unavailable");
    await db.query("INSERT INTO whatsapp_messages VALUES($1,'rec_aguardando_confirmacao',now())",[user]);
    expect((await action(1,"pick")).outcome).toBe("pending_confirmation");
    const rows=await db.query<{items:any[]}>("SELECT items FROM whatsapp_audio_batches WHERE id=$1",[id]);
    expect(rows.rows[0].items[0].text).toBe("");expect(rows.rows[0].items[2].text).toBe("");
    await db.exec("SET ROLE authenticated");
    await expect(action(1,"pick")).rejects.toThrow();
  } finally {await db.close();}
},30000);
