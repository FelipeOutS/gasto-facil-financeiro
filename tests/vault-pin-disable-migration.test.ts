import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const migration = new URL(
  "../supabase/migrations/20260928120000_disable_legacy_vault_pin_enrollment.sql",
  import.meta.url,
);

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END';
  `);
  for (const path of [
    "../supabase/migrations/20260522114730_20cbdb4a-f6a6-4e96-b73d-3ea6e6e7c761.sql",
    "../supabase/migrations/20260523010517_9c718908-99dc-416a-9dcb-b313791458ff.sql",
  ]) {
    await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  }
  // Espelha os grants e as policies de escrita que podem existir no Cloud.
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_pin_settings TO authenticated;
    CREATE POLICY vault_pin_insert_own ON public.vault_pin_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY vault_pin_update_own ON public.vault_pin_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY vault_pin_delete_own ON public.vault_pin_settings FOR DELETE USING (auth.uid() = user_id);
    INSERT INTO auth.users VALUES ('${owner}');
    INSERT INTO public.vault_pin_settings(user_id,salt,iterations,wrapped_key,wrap_iv)
      VALUES ('${owner}','synthetic-salt-1234',600000,'synthetic-wrapped-key','synthetic-iv-1234');
  `);
  const before = await db.query<{ allowed: boolean }>(
    "SELECT has_function_privilege('authenticated','public.vault_pin_set(text,integer,text,text)','EXECUTE') AS allowed",
  );
  expect(before.rows[0].allowed).toBe(true);
  await db.exec(await readFile(migration, "utf8"));
}, 30000);

afterAll(async () => db.close());

test("authenticated loses RPC enrollment and all direct writes, while legacy read and RPCs remain", async () => {
  for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
    const result = await db.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('authenticated','public.vault_pin_settings','${privilege}') AS allowed`,
    );
    expect(result.rows[0].allowed).toBe(false);
  }
  for (const privilege of ["SELECT"]) {
    const result = await db.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('authenticated','public.vault_pin_settings','${privilege}') AS allowed`,
    );
    expect(result.rows[0].allowed).toBe(true);
  }
  for (const [signature, expected] of [
    ["vault_pin_set(text,integer,text,text)", false],
    ["vault_pin_delete()", true],
    ["vault_pin_record_attempt(boolean)", true],
  ] as const) {
    const result = await db.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed",
      [`public.${signature}`],
    );
    expect(result.rows[0].allowed).toBe(expected);
  }
  const policies = await db.query<{ policyname: string }>(
    "SELECT policyname FROM pg_policies WHERE tablename='vault_pin_settings' ORDER BY policyname",
  );
  expect(policies.rows.map(row => row.policyname)).toEqual(["vault_pin_select_own"]);
});

test("authenticated cannot create or overwrite a legacy PIN but can detect and retire its old row", async () => {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("SET ROLE authenticated");
  try {
    await expect(db.query("SELECT public.vault_pin_set($1,$2,$3,$4)",
      ["synthetic-salt-5678", 600000, "synthetic-wrapped-key", "synthetic-iv-5678"])).rejects.toThrow();
    await expect(db.exec(`INSERT INTO public.vault_pin_settings(user_id,salt,wrapped_key,wrap_iv)
      VALUES ('${owner}','new-salt','new-wrapped-key','new-iv')`)).rejects.toThrow();
    await expect(db.exec("UPDATE public.vault_pin_settings SET salt='changed' WHERE user_id=auth.uid()"))
      .rejects.toThrow();
    await expect(db.exec("DELETE FROM public.vault_pin_settings WHERE user_id=auth.uid()"))
      .rejects.toThrow();
    const old = await db.query<{ salt: string }>("SELECT salt FROM public.vault_pin_settings WHERE user_id=auth.uid()");
    expect(old.rows.map(row => row.salt)).toEqual(["synthetic-salt-1234"]);
    const attempts = await db.query("SELECT * FROM public.vault_pin_record_attempt(false)");
    expect(attempts.rows).toHaveLength(1);
    await db.exec("SELECT public.vault_pin_delete()");
    const after = await db.query("SELECT * FROM public.vault_pin_settings WHERE user_id=auth.uid()");
    expect(after.rows).toHaveLength(0);
  } finally {
    await db.exec("RESET ROLE");
  }
});
