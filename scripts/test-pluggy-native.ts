import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
// Native, isolated PostgreSQL. Never accepts a database URL; only loopback and a fresh cluster.
const bin = process.env.PG_BIN;
if (!bin) throw Error("Set PG_BIN to the native PostgreSQL bin directory");
const dir = await mkdtemp(join(tmpdir(), "gi-pluggy-native-"));
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
const F = "3324b9f8-ea68-465c-8e1e-ab1cc8caebf1";
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
  await file("tests/sql/pluggy/00-stub.sql");
  await file("docs/migrations-candidate/pluggy-open-finance.sql");
  await file("tests/sql/pluggy/10-tests.sql");
  await sql(
    "SET ROLE service_role; SELECT pluggy_webhook_enqueue('native-r'||g,'item/updated','iM','{}') FROM generate_series(1,6) g;",
  );
  const claims = (
    await race(
      "SET ROLE service_role; BEGIN; SELECT id FROM pluggy_webhook_claim(50,60); SELECT pg_sleep(0.3); COMMIT;",
    )
  )
    .join("\n")
    .split(/\s+/)
    .filter((x) => /^[a-f0-9-]{36}$/.test(x));
  assert(claims.length === 6 && new Set(claims).size === 6, "concurrent claims unique");
  for (const p of [
    "docs/migrations-candidate/pluggy-webhook-claim-max-attempts.sql",
    "tests/sql/pluggy/20-lease-max.sql",
    "tests/sql/pluggy/30-amount-original.sql",
    "tests/sql/pluggy/35-gi-stub.sql",
    "docs/migrations-candidate/pluggy-import-gi.sql",
    "tests/sql/pluggy/39-release-block.sql",
    "tests/sql/pluggy/39-test-only-unlock.sql",
  ])
    await file(p);
  const seed = join(dir, "seed.sql").replaceAll("\\", "/");
  await writeFile(seed, await run(process.execPath, ["tests/sql/pluggy/gen-import-fixture.ts"]));
  await file("tests/sql/pluggy/40-import.sql", ["-v", "seed_file=" + seed]);
  await file("docs/migrations-candidate/gastos-delete-atomic-f4.sql");
  await file("tests/sql/pluggy/41-f4-guard.sql");
  await file("tests/sql/pluggy/42-import-race.sql");
  await race(
    "SET ROLE service_role; BEGIN; SELECT pluggy_import_apply('47df50ce-df1e-4c54-8fae-0ffb5105478d',gen_random_uuid(),(SELECT plan FROM test_import_race)); SELECT pg_sleep(0.3); COMMIT;",
  );
  assert(
    (
      await sql("SELECT count(*) FROM receitas WHERE id_operacao_banco='pluggy:acc1:race-income'")
    ).trim() === "1",
    "concurrent generic import unique",
  );
  const undo = await race(
    "SET ROLE service_role; BEGIN; SELECT pluggy_import_revert('47df50ce-df1e-4c54-8fae-0ffb5105478d',(SELECT batch_id FROM pluggy_import_entries WHERE transaction_id='race-income')); SELECT pg_sleep(0.3); COMMIT;",
  );
  assert(undo.join("").includes('"replay": true'), "concurrent generic undo replay");
  await sql(
    "CREATE OR REPLACE FUNCTION pluggy_assert_financial_release() RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'pluggy_gravacao_financeira_bloqueada' USING ERRCODE='42501'; END $$;",
  );
  for (const p of [
    "docs/migrations-candidate/pluggy-live-readonly.sql",
    "docs/migrations-candidate/pluggy-real-first-import.sql",
    "tests/sql/pluggy/50-real-once.sql",
    "docs/migrations-candidate/pluggy-real-batch-import.sql",
    "tests/sql/pluggy/60-real-batch.sql",
  ])
    await file(p);
  const batch = "00000000-0000-0000-0000-00000000ba05";
  const rows = JSON.stringify(
    ["c1", "c2"].map((transaction_id) => ({
      account_id: "aReal",
      transaction_id,
      descricao: "Rendimentos",
    })),
  );
  const b = await race(
    `SET ROLE service_role; BEGIN; SELECT pluggy_import_apply_real_batch('${F}','${batch}','${rows}'); SELECT pg_sleep(0.3); COMMIT;`,
  );
  assert(
    b.join("").includes('"replay": true') &&
      (await sql(`SELECT count(*) FROM receitas WHERE import_batch_id='${batch}'`)).trim() === "2",
    "concurrent real batch unique and replay",
  );
  await sql(
    `INSERT INTO categorias(user_id,nome,icon_name,color_var) SELECT '${F}','Outros','tag','gray' WHERE NOT EXISTS(SELECT 1 FROM categorias WHERE user_id='${F}');`,
  );
  for (const p of [
    "docs/migrations-candidate/pluggy-real-batch-partial-undo.sql",
    "docs/migrations-candidate/pluggy-real-automatic-closed-batch.sql",
    "tests/sql/pluggy/70-partial-automatic.sql",
    "docs/migrations-candidate/pluggy-real-card-links.sql",
    "tests/sql/pluggy/80-real-cards.sql",
    "docs/migrations-candidate/pluggy-real-card-batch.sql",
    "tests/sql/pluggy/90-real-card-batch.sql",
  ])
    await file(p);
  await file("docs/migrations-candidate/pluggy-continuous-policy.sql");
  await file("tests/sql/pluggy/100-continuous.sql");
  await race(
    `SET ROLE service_role; BEGIN; SELECT pluggy_continuous_process('${F}','aReal',false); SELECT pg_sleep(0.3); COMMIT;`,
  );
  assert(
    (
      await sql("SELECT count(*) FROM receitas WHERE id_operacao_banco='pluggy:aReal:policy-race'")
    ).trim() === "1",
    "continuous two sessions import once",
  );
  await sql(
    `SELECT pluggy_continuous_set('${F}','aReal',false,ARRAY['interest'],null,10,15,10,true);`,
  );
  assert(
    (await sql(`SELECT pluggy_continuous_process('${F}','aReal',false)->>'blocked'`)).trim() ===
      "true",
    "continuous pause blocks subsequent worker",
  );

  await sql(`SELECT pluggy_continuous_set('${F}','aReal',true,ARRAY['interest'],null,10,40,4,true);
    INSERT INTO pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox,operation_type)
    SELECT '${F}','iReal','aReal',id,id,'Rendimento',amount,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,'POSTED','CREDIT','receita','credito_conta',false,'RENDIMENTO' FROM (VALUES('quota-a',7.11),('quota-b',7.22)) v(id,amount);`);
  await race(`SET ROLE service_role; SELECT pluggy_continuous_process('${F}','aReal',false);`);
  assert(
    Number(
      await sql(
        "SELECT count(*) FROM receitas WHERE id_operacao_banco IN('pluggy:aReal:quota-a','pluggy:aReal:quota-b')",
      ),
    ) === 1,
    "concurrent workers respect remaining daily quota",
  );
  // A pause holds the same lock as writers; the waiting writer sees the committed pause.
  const paused = sql(
    `BEGIN; SELECT pluggy_continuous_set('${F}','aReal',false,ARRAY['interest'],null,10,40,4,true); SELECT pg_advisory_xact_lock(987654321); SELECT pg_sleep(1); COMMIT;`,
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (
        await sql(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=987654321 AND granted)",
        )
      ).trim() === "t"
    )
      break;
    if (attempt === 99) throw Error("pause coordination timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
  const blocked = await sql(`SELECT pluggy_continuous_process('${F}','aReal',false)->>'blocked';`);
  await paused;
  assert(blocked.trim() === "true", "worker queued behind pause cannot import");
  await file("tests/sql/pluggy/105-settlement-stub.sql");
  await file("docs/migrations-candidate/pluggy-confirmed-settlements.sql");
  await file("tests/sql/pluggy/110-settlements.sql");
  const settlementRace = await race(
    `SET ROLE service_role; SELECT pluggy_settlement_apply('${F}','aReal','race-refund','refund',id,updated_at,true,(SELECT jsonb_build_object('transaction',updated_at) FROM pluggy_transactions WHERE transaction_id='race-refund')) FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03';`,
  );
  assert(
    settlementRace[0].trim() === settlementRace[1].trim() &&
      Number(
        await sql("SELECT valor FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03'"),
      ) === 8,
    "concurrent settlement applies once",
  );
  const settlementUndo = await race(
    `SET ROLE service_role; SELECT pluggy_settlement_undo('${F}',id) FROM pluggy_settlements WHERE source_id='race-refund';`,
  );
  assert(
    settlementUndo.join("").includes("replay") &&
      Number(
        await sql("SELECT valor FROM gastos WHERE id='00000000-0000-0000-0000-00000000ee03'"),
      ) === 10,
    "concurrent settlement undo applies once",
  );
  console.log("PASS native PostgreSQL suite complete");
} finally {
  if (started) await run(exe("pg_ctl"), ["-D", join(dir, "data"), "-w", "stop", "-m", "immediate"]);
  // Only the exact fresh directory returned by mkdtemp is removed.
  if (
    !resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")) ||
    !dir.includes("gi-pluggy-native-")
  )
    throw Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
