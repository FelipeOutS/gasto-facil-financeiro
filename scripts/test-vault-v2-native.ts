import { spawn } from "node:child_process";
import { mkdtemp, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { generateDek } from "../src/lib/vault/v2/keyslots";
import { wrapPassword } from "../src/lib/vault/v2/password";

// Never accepts a URL or an existing cluster. Synthetic data, loopback only.
const bin = process.env.PG_BIN;
if (!bin) throw Error("PG_BIN required");
const dir = await mkdtemp(join(tmpdir(), "gi-vault-v2-native-"));
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("PG") || /DATABASE_URL/.test(k)) delete env[k];
env.PGCLIENTENCODING = "UTF8";
const port = await new Promise<number>((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const n = (s.address() as { port: number }).port;
    s.close(() => ok(n));
  });
});
const exe = (name: string) => join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
function run(name: string, args: string[], input?: string) {
  return new Promise<string>((ok, fail) => {
    const p = spawn(exe(name), args, { env, windowsHide: true });
    let out = "";
    p.stdout.on("data", (x) => (out += x));
    p.stderr.on("data", (x) => (out += x));
    p.on("error", fail);
    p.on("exit", (c) => (c === 0 ? ok(out) : fail(Error(out))));
    p.stdin.end(input ? Buffer.from(input, "utf8") : undefined);
  });
}
const sql = (q: string) =>
  run(
    "psql",
    [
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
      "-tA",
    ],
    q,
  );
const assert = (yes: boolean, label: string) => {
  if (!yes) throw Error(label);
  console.log("PASS", label);
};
let started = false;
try {
  await run("initdb", [
    "-D",
    join(dir, "data"),
    "-U",
    "gi_test",
    "--auth=trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  await appendFile(join(dir, "data", "postgresql.conf"), "\nunix_socket_directories = ''\n");
  try {
    await run("pg_ctl", [
      "-D",
      join(dir, "data"),
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-l",
      join(dir, "server.log"),
      "-w",
      "start",
    ]);
    started = true;
  } catch (e) {
    const log = await readFile(join(dir, "server.log"), "utf8").catch(
      () => "server.log unavailable",
    );
    console.error(log.split(dir).join("[TEST_TMP]"));
    throw e;
  }
  for (const f of [
    "tests/sql/vault-v2/00-stub.sql",
    "docs/migrations-candidate/vault-v2-passwordless.sql",
    "tests/sql/vault-v2/01-email-queue-stub.sql",
    "docs/migrations-candidate/vault-v2-password-email.sql",
  ])
    await sql(await readFile(f, "utf8"));
  const uid = "aaaaaaaa-0000-0000-0000-000000000001",
    v = "aaaaaaaa-1111-1111-1111-111111111111",
    nonce = "aaaaaaaa-2222-2222-2222-222222222222";
  const before = await sql(
    "SELECT md5(string_agg(id::text||ciphertext,',' ORDER BY id)) FROM vault_entries",
  );
  await sql(
    `INSERT INTO vaults(id,user_id) VALUES('${v}','${uid}'); INSERT INTO vault_keyslots(vault_id,user_id,kind,envelope) VALUES('${v}','${uid}','recovery','{}');`,
  );
  const asUser = `SET request.jwt.claim.sub='${uid}'; SET ROLE authenticated;`;
  const envelope = JSON.stringify(
    await wrapPassword(await generateDek(), "Senha de teste isolada!42", uid, v),
  );
  const race = await Promise.allSettled(
    [1, 2].map(() =>
      sql(`${asUser} SELECT vault_v2_password_replace('${v}',NULL,'${envelope}',NULL)`),
    ),
  );
  assert(
    race.filter((x) => x.status === "fulfilled").length === 1 &&
      race.filter((x) => x.status === "rejected" && String(x.reason).includes("vault_changed"))
        .length === 1,
    "concurrent password replacement: one commit, one CAS refusal",
  );
  await sql(
    `SELECT vault_v2_email_begin('${uid}','${v}','${nonce}','hash','test@example.invalid')`,
  );
  const verified = await Promise.all(
    [1, 2].map(() =>
      sql(`SELECT vault_v2_email_verify('${uid}','${nonce}','hash','test@example.invalid')`),
    ),
  );
  assert(
    verified
      .map((s) => s.trim())
      .sort()
      .join(",") === "f,t",
    "concurrent OTP verification: exactly one success",
  );
  const slot = (
    await sql("SELECT id FROM vault_keyslots WHERE kind='password' AND revoked_at IS NULL")
  ).trim();
  const consume = await Promise.allSettled(
    [1, 2].map(() =>
      sql(`${asUser} SELECT vault_v2_password_replace('${v}','${slot}','${envelope}','${nonce}')`),
    ),
  );
  assert(
    consume.filter((x) => x.status === "fulfilled").length === 1,
    "concurrent recovery: one replacement only",
  );
  assert(
    (
      await sql(
        "SELECT count(*) FROM test_email_queue WHERE payload->>'label'='vault-password-changed'",
      )
    ).trim() === "1",
    "concurrent recovery queues exactly one durable notification",
  );
  assert(
    (await sql("SELECT access_version FROM vaults")).trim() === "2",
    "two committed changes increment session version twice",
  );
  const attempts = await Promise.all(
    [1, 2, 3, 4, 5, 6, 7, 8].map(() =>
      sql(`${asUser} SELECT (vault_v2_password_attempt('${v}') IS NOT NULL)::int`),
    ),
  );
  assert(
    attempts.filter((x) => x.trim() === "1").length === 5,
    "concurrent attempts enforce five per window",
  );
  const forbidden = await Promise.allSettled([
    sql(`${asUser} UPDATE vault_keyslots SET failed_attempts=0 WHERE kind='password'`),
    sql("SET ROLE anon; SELECT vault_v2_password_attempt('" + v + "')"),
  ]);
  assert(
    forbidden.every((x) => x.status === "rejected"),
    "direct counter bypass and anonymous RPC refused",
  );
  assert(
    (await sql(
      "SELECT md5(string_agg(id::text||ciphertext,',' ORDER BY id)) FROM vault_entries",
    )) === before && (await sql("SELECT count(*) FROM vault_entries")).trim() === "14",
    "14 synthetic legacy rows identical after migration and races",
  );
} finally {
  if (started) await run("pg_ctl", ["-D", join(dir, "data"), "-w", "stop", "-m", "immediate"]);
  await cleanup();
}
async function cleanup() {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !dir.includes("gi-vault-v2-native-"))
    throw Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
