import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
// Native, isolated PostgreSQL. Never accepts a database URL; only loopback and a fresh cluster.
const bin = process.env.PG_BIN;
if (!bin) throw Error("Set PG_BIN to the native PostgreSQL bin directory");
const dir = await mkdtemp(join(tmpdir(), "gi-financial-native-"));
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
  started = true;
  await file("tests/sql/gastos-soft-delete-f2/00-stub.sql");
  await file("docs/migrations-candidate/gastos-soft-delete-f2.sql");
  await file("tests/sql/gastos-delete-atomic-f4/00-stub.sql");
  await file("docs/migrations-candidate/gastos-delete-atomic-f4.sql");
  await file("docs/migrations-candidate/gastos-delete-atomic-f4.sql");
  for (const name of ["10-tests.sql","20-reverter-paridade.sql","30-complementar.sql","40-rollback.sql"])
    await file("tests/sql/gastos-delete-atomic-f4/"+name);
  console.log("PASS native F2/F4 financial regression complete");
} finally {
  if (started) await run(exe("pg_ctl"), ["-D", join(dir, "data"), "-w", "stop", "-m", "immediate"]);
  await cleanup();
}
async function cleanup() {
  // Only the exact fresh directory returned by mkdtemp is removed.
  if (
    !resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")) ||
    !dir.includes("gi-financial-native-")
  )
    throw Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
