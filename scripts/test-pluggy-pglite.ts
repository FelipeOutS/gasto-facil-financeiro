/** Local-only PostgreSQL WASM runner for the existing SQL assertions.
 * No URL, credentials, network or production client. Does not simulate parallel sessions.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const db = new PGlite();
const vars: Record<string, unknown> = {};
const literal = (v: unknown) => v == null ? "NULL" : "'" + (typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''") + "'";
const expand = (s: string) => s.replace(/:'([A-Za-z0-9_]+)'/g, (_, n) => { if (!(n in vars)) throw Error(`Unknown test variable ${n}`); return literal(vars[n]); }).replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, n) => n in vars ? String(vars[n]) : match);
async function run(path: string) {
  await db.exec("RESET ROLE; DROP FUNCTION IF EXISTS pg_temp.ok(boolean,text); DROP FUNCTION IF EXISTS pg_temp.err(text);");
  let pending = "";
  const flush = async () => { if (pending.trim()) await db.exec(expand(pending)); pending = ""; };
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const set = line.match(/^\\set (\w+) '(.*)'$/);
    if (set) { await flush(); vars[set[1]] = set[2]; continue; }
    if (line.startsWith("\\i ")) { await flush(); await db.exec(await readFile(line.slice(3).trim(), "utf8")); continue; }
    if (line.includes("\\gset")) {
      // gset appears after a single SELECT, preceded by complete statements.
      const select = line.slice(0, line.indexOf("\\gset"));
      await flush();
      const result = await db.query(expand(select));
      if (result.rows.length !== 1) throw Error(`gset expected one row in ${path}`);
      Object.assign(vars, result.rows[0]); continue;
    }
    pending += line + "\n";
  }
  await flush();
  if (path.endsWith("35-gi-stub.sql")) await db.exec("INSERT INTO public.categorias(user_id,nome,icon_name,color_var) VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','Outros','tag','gray');");
  console.log(`PASS ${path}`);
}
try {
  for (const path of [
    "tests/sql/pluggy/00-stub.sql",
    "docs/migrations-candidate/pluggy-open-finance.sql",
    "tests/sql/pluggy/10-tests.sql",
    "docs/migrations-candidate/pluggy-webhook-claim-max-attempts.sql",
    "tests/sql/pluggy/20-lease-max.sql",
    "tests/sql/pluggy/30-amount-original.sql",
    "tests/sql/pluggy/35-gi-stub.sql",
    "docs/migrations-candidate/pluggy-import-gi.sql",
    "tests/sql/pluggy/39-release-block.sql",
    "docs/migrations-candidate/pluggy-live-readonly.sql",
    "docs/migrations-candidate/pluggy-real-first-import.sql",
    "tests/sql/pluggy/50-real-once.sql",
    "docs/migrations-candidate/pluggy-real-batch-import.sql",
    "tests/sql/pluggy/60-real-batch.sql",
    "docs/migrations-candidate/pluggy-real-batch-partial-undo.sql",
    "docs/migrations-candidate/pluggy-real-automatic-closed-batch.sql",
    "tests/sql/pluggy/70-partial-automatic.sql",
    "docs/migrations-candidate/pluggy-real-card-links.sql",
    "tests/sql/pluggy/80-real-cards.sql",
    "docs/migrations-candidate/pluggy-real-card-batch.sql",
    "tests/sql/pluggy/90-real-card-batch.sql",
  ]) await run(path);
} finally { await db.close(); }
