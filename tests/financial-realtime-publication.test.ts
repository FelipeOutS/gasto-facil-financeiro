import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
test("publication migration is additive and idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE gastos(id uuid); CREATE TABLE receitas(id uuid); CREATE TABLE existing_table(id uuid); CREATE PUBLICATION supabase_realtime FOR TABLE existing_table,gastos;",
    );
    const sql = await readFile(
      new URL("../supabase/migrations/20260924140000_financial_realtime.sql", import.meta.url),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const result = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename",
    );
    expect(result.rows.map((r) => r.tablename)).toEqual(["existing_table", "gastos", "receitas"]);
  } finally {
    await db.close();
  }
});
