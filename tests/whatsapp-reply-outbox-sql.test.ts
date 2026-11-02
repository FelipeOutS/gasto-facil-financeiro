import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const U = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  await db.exec(readFileSync("tests/sql/whatsapp/00-reply-fixture.sql", "utf8"));
  await db.exec(readFileSync("docs/migrations-candidate/whatsapp-reply-outbox.sql", "utf8"));
  await db.exec("SET ROLE service_role");
  return db;
}
async function enqueue(db: PGlite) {
  return (
    await db.query<{ id: string }>(
      `SELECT wa_reply_enqueue('${U}','fixture-message',left(encode(sha256(convert_to('5511900000000','UTF8')),'hex'),32),'fixture-cipher',now()+interval '1 hour') id`,
    )
  ).rows[0].id;
}
const claim = (db: PGlite, id: string, u = U) =>
  db.query<{ claim_token: string }>(`SELECT * FROM wa_reply_claim('${id}','${u}','5511900000000')`);
test("SQL: dedupe, owner, one claim, expired lease never retries", async () => {
  const db = await fixture();
  try {
    const id = await enqueue(db);
    expect(await enqueue(db)).toBe(id);
    expect((await claim(db, id, B)).rows).toHaveLength(0);
    expect((await claim(db, id)).rows).toHaveLength(1);
    expect((await claim(db, id)).rows).toHaveLength(0);
    await db.exec(
      `UPDATE whatsapp_reply_outbox SET lease_until=now()-interval '1 second' WHERE id='${id}'`,
    );
    expect((await db.query(`SELECT wa_reply_quarantine_expired('${U}') n`)).rows[0]).toEqual({n:1});
    expect((await claim(db, id)).rows).toHaveLength(0);
    expect((await db.query(`SELECT state FROM whatsapp_reply_outbox`)).rows[0]).toEqual({
      state: "ambiguous",
    });
    expect((await db.query(`SELECT wa_reply_retry_rejected('${id}','${U}') ok`)).rows[0]).toEqual({
      ok: false,
    });
  } finally {
    await db.close();
  }
}, 15000);
test("SQL: callback before finish; duplicate and out-of-order never regress read", async () => {
  const db = await fixture();
  try {
    const id = await enqueue(db);
    const token = (await claim(db, id)).rows[0].claim_token;
    await db.exec(
      `SELECT wa_reply_reconcile('${id}','wamid.fixture','read'); SELECT wa_reply_reconcile('${id}','wamid.fixture','sent'); SELECT wa_reply_reconcile('${id}','wamid.fixture','failed')`,
    );
    expect(
      (await db.query(`SELECT wa_reply_finish('${id}','${token}','ambiguous') ok`)).rows[0],
    ).toEqual({ ok: false });
    expect(
      (await db.query(`SELECT state,provider_message_id FROM whatsapp_reply_outbox`)).rows[0],
    ).toEqual({ state: "read", provider_message_id: "wamid.fixture" });
    expect(
      (await db.query(`SELECT wa_reply_reconcile('${id}','wamid.other','read') ok`)).rows[0],
    ).toEqual({ ok: false });
  } finally {
    await db.close();
  }
}, 15000);
test.each(["revoked", "plan", "expired"])(
  "SQL: %s stops sending",
  async (reason) => {
    const db = await fixture();
    try {
      const id = await enqueue(db);
      await db.exec("RESET ROLE");
      if (reason === "revoked") await db.exec("UPDATE whatsapp_links SET revogado_em=now()");
      if (reason === "plan") await db.exec("UPDATE fixture_entitlements SET allowed=false");
      if (reason === "expired")
        await db.exec(
          "UPDATE whatsapp_reply_outbox SET window_expires_at=now()-interval '1 second'",
        );
      await db.exec("SET ROLE service_role");
      expect((await claim(db, id)).rows).toHaveLength(0);
    } finally {
      await db.close();
    }
  },
  15000,
);
test("SQL: anon/authenticated cannot access table or RPC", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query(
        `SELECT has_table_privilege('${role}','whatsapp_reply_outbox','SELECT') tab,has_function_privilege('${role}','wa_reply_claim(uuid,uuid,text)','EXECUTE') fn`,
      );
      expect(r.rows[0]).toEqual({ tab: false, fn: false });
    }
  } finally {
    await db.close();
  }
}, 15000);

test("SQL: transition history is durable and cannot be edited by service role", async()=>{
 const db=await fixture();try{
 const id=await enqueue(db);await claim(db,id);
 await db.exec(`SELECT wa_reply_reconcile('${id}','wamid.audit','read'); SELECT wa_reply_reconcile('${id}','wamid.audit','read')`);
 expect((await db.query("SELECT state FROM whatsapp_reply_outbox_events ORDER BY id")).rows).toEqual([{state:"pending"},{state:"sending"},{state:"read"}]);
 const rights=await db.query("SELECT has_table_privilege('service_role','whatsapp_reply_outbox_events','UPDATE') upd,has_table_privilege('service_role','whatsapp_reply_outbox_events','DELETE') del,has_table_privilege('authenticated','whatsapp_reply_outbox_events','SELECT') usr");
 expect(rights.rows[0]).toEqual({upd:false,del:false,usr:false});
 }finally{await db.close();}
},15000);
