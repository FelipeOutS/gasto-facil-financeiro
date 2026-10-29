import { spawn } from "node:child_process";
import { mkdtemp, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
// Native, isolated PostgreSQL. Never accepts a database URL; only loopback and a fresh cluster.
const bin = process.env.PG_BIN;
if (!bin) throw Error("Set PG_BIN to the native PostgreSQL bin directory");
const dir = await mkdtemp(join(tmpdir(), "gi-whatsapp-native-"));
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("PG") || k === "DATABASE_URL") delete env[k];
const password = randomBytes(24).toString("hex");
env.PGPASSWORD = password;
const exe = (n: string) => join(bin, n + (process.platform === "win32" ? ".exe" : ""));
async function run(file: string, args: string[]) {
  return await new Promise<string>((ok, fail) => {
    const p = spawn(file, args, { cwd: process.cwd(), env, windowsHide: true });
    let out = "";
    p.stdout.on("data", (x) => (out += x));
    p.stderr.on("data", (x) => (out += x));
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? ok(out) : fail(Error(out))));
  });
}
const port = await new Promise<number>((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => ok(p));
  });
});
const args = [
  "-X",
  "-q",
  "-v",
  "ON_ERROR_STOP=1",
  "-h",
  "127.0.0.1",
  "-p",
  String(port),
  "-U",
  "gi_test",
  "-d",
  "postgres",
];
const sql = (q: string) => run(exe("psql"), [...args, "-tAc", q]);
const file = async (p: string, extra: string[] = []) => {
  await run(exe("psql"), [...args, ...extra, "-f", resolve(p)]);
  console.log("PASS", p);
};
const assert = (v: boolean, s: string) => {
  if (!v) throw Error(s);
  console.log("PASS", s);
};
const race = (q: string) => Promise.all([sql(q), sql(q)]);

let started = false;
try {
  await writeFile(join(dir, "password"), password);
  await run(exe("initdb"), [
    "-D",
    join(dir, "data"),
    "-U",
    "gi_test",
    "--auth=scram-sha-256",
    "--pwfile=" + join(dir, "password"),
    "--encoding=UTF8",
    "--locale=C",
  ]);
  // TCP only: distribution defaults may point Unix sockets at /var/run/postgresql.
  // Write the empty setting to config, avoiding shell quoting differences on Windows.
  await appendFile(join(dir, "data", "postgresql.conf"), "\nunix_socket_directories = ''\n");
  try {
    await run(exe("pg_ctl"), [
      "-D",
      join(dir, "data"),
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-l",
      join(dir, "server.log"),
      "-w",
      "start",
    ]);
  } catch (error) {
    const sanitize = (text: string) => text.split(password).join("[REDACTED]")
      .split(dir).join("[TEST_TMP]").split(dir.replace(/\\/g, "/")).join("[TEST_TMP]").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    let log = "server.log unavailable";
    try { log = await readFile(join(dir, "server.log"), "utf8"); } catch { /* Startup may fail before log creation. */ }
    console.error("PostgreSQL startup server.log (sanitized):\n" + sanitize(log));
    // A timed-out start can still leave a server alive. Stop only our fresh cluster.
    try { await run(exe("pg_ctl"), ["-D", join(dir, "data"), "-w", "stop", "-m", "immediate"]); }
    catch { /* Normally no server was started; preserve the original diagnostic. */ }
    throw new Error("PostgreSQL startup failed: " + sanitize(String(error)));
  }
  started = true;
  assert((await sql("SHOW unix_socket_directories")).trim() === "", "Unix sockets disabled");
  assert((await sql("SHOW listen_addresses")).trim() === "127.0.0.1", "TCP restricted to loopback");
  await file("tests/sql/whatsapp/00-reply-fixture.sql");
  await file("docs/migrations-candidate/whatsapp-reply-outbox.sql");
  const uid = "11111111-1111-4111-8111-111111111111";
  const enqueue =
    "SET ROLE service_role; SELECT wa_reply_enqueue('" +
    uid +
    "','fixture-message',left(encode(sha256(convert_to('5511900000000','UTF8')),'hex'),32),'cipher-fixture',now()+interval '1 hour')";
  const ids = (await race(enqueue)).map((s) => s.trim());
  assert(ids[0] === ids[1], "two simultaneous enqueues deduplicate");
  const id = ids[0];
  const results = await race(
    "SET ROLE service_role; BEGIN; SELECT claim_token FROM wa_reply_claim('" +
      id +
      "','" +
      uid +
      "','5511900000000'); SELECT pg_sleep(0.2); COMMIT;",
  );
  const tokens = results.join(" ").match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) || [];
  assert(tokens.length === 1, "two simultaneous claims produce one sender");
  await race(
    "SET ROLE service_role; SELECT wa_reply_reconcile('" + id + "','wamid.native','read');",
  );
  await sql(
    "SET ROLE service_role; SELECT wa_reply_finish('" +
      id +
      "','" +
      tokens[0] +
      "','ambiguous'); SELECT wa_reply_reconcile('" +
      id +
      "','wamid.native','sent');",
  );
  assert(
    (await sql("SELECT state FROM whatsapp_reply_outbox WHERE id='" + id + "'")).trim() === "read",
    "callback before completion remains read",
  );
  assert(
    (await sql("SELECT attempts FROM whatsapp_reply_outbox WHERE id='" + id + "'")).trim() === "1",
    "single HTTP attempt allocation",
  );
  await file("tests/sql/whatsapp/10-undo-fixture.sql");
  await file("supabase/migrations/20261004130000_whatsapp_postlaunch_actions.sql");
  await file("tests/sql/whatsapp/11-f2-prerequisites.sql");
  await file("docs/migrations-candidate/whatsapp-v2-preflight-readonly.sql");
  let noF2=false;
  try { await file("docs/migrations-candidate/whatsapp-entry-mutations-v2.sql"); } catch(error) {noF2=String(error).includes("F2_required");}
  assert(noF2,"missing F2 aborts candidate atomically");
  await file("docs/migrations-candidate/gastos-soft-delete-f2.sql");
  await file("docs/migrations-candidate/whatsapp-entry-mutations-v2.sql");
  await file("docs/migrations-candidate/whatsapp-undo-soft-delete.sql");
  await file("docs/migrations-candidate/whatsapp-entry-mutations-v2.sql");
  await file("docs/migrations-candidate/whatsapp-undo-soft-delete.sql");
  const expense="33333333-3333-4333-8333-333333333333";
  const action="44444444-4444-4444-8444-444444444444";
  await sql(`INSERT INTO gastos(id,user_id,origem,descricao,valor,data,mes,ano,forma_pagamento) VALUES ('${expense}','${uid}','whatsapp','Fixture',10,'2026-10-25',10,2026,'pix'); INSERT INTO whatsapp_recent_actions(id,user_id,telefone,source_external_id,entity_kind,entity_id) VALUES ('${action}','${uid}','5511900000000','native-undo','expense','${expense}')`);
  const undos=await race(`SELECT whatsapp_undo_recent_action_v2('${uid}','5511900000000','${action}')`);
  assert(undos.some(s=>s.trim()==="undone") && undos.some(s=>s.trim()==="already_undone"),"two simultaneous undos apply once");
  assert((await sql(`SELECT count(*) FROM gastos WHERE id='${expense}' AND deleted_at IS NOT NULL`)).trim()==="1","undo preserves physical row");
  await file("tests/sql/whatsapp/20-entry-v2-tests.sql");
  const single="aaaaaaaa-0000-4000-8000-000000000001";
  const stamp=(await sql(`SELECT updated_at::text FROM gastos WHERE id='${single}'`)).trim();
  const changes=await race(`SET ROLE service_role; SELECT whatsapp_entry_mutate_v2('${uid}','5511900000000','gastos','${single}','${stamp}','delete','concurrent-single')`);
  assert(changes.some(x=>x.trim()==="deleted") && changes.some(x=>x.trim()==="gone"),"two individual deletions apply once");
  assert((await sql("SELECT count(*) FROM whatsapp_entry_mutations WHERE request_id='concurrent-single'")).trim()==="1","single audit record for concurrent command");
  await file("docs/migrations-candidate/whatsapp-v2-preflight-readonly.sql");
  console.log("PASS native WhatsApp concurrency complete");
} finally {
  if (started) await run(exe("pg_ctl"), ["-D", join(dir, "data"), "-w", "stop", "-m", "immediate"]);
  await cleanup();
}
async function cleanup() {
  // Only the exact fresh directory returned by mkdtemp is removed.
  if (
    !resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")) ||
    !dir.includes("gi-whatsapp-native-")
  )
    throw Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
