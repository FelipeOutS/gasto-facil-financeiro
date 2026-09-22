import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
GlobalRegistrator.register();
const { renderHook, act, waitFor, cleanup } = await import("@testing-library/react");
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let failure: "network" | "supabase" | "undefined" | "timeout" | null = null;
let writes = 0;
const row = {
  user_id: owner,
  salt: "synthetic-salt",
  verifier: "synthetic-verifier",
  verifier_iv: "synthetic-iv",
  iterations: 250000,
  hint: "synthetic",
};
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      expect(table).toBe("vault_settings");
      return {
        select: () => ({
          eq: (_: string, id: string) => ({
            maybeSingle: async () => {
              if (failure === "network") throw new Error("network unavailable");
              if (failure === "supabase") return { data: null, error: { message: "read failed" } };
              if (failure === "undefined") return { data: undefined, error: null };
              if (failure === "timeout") return new Promise(() => {});
              return {
                data:
                  (await db.query("SELECT * FROM vault_settings WHERE user_id=$1", [id])).rows[0] ??
                  null,
                error: null,
              };
            },
          }),
        }),
        // No upsert: real PostgreSQL INSERT validates PK and RLS.
        insert: async (value: typeof row) => {
          writes++;
          try {
            await db.query(
              "INSERT INTO vault_settings(user_id,salt,verifier,verifier_iv,iterations,hint) VALUES ($1,$2,$3,$4,$5,$6)",
              [
                value.user_id,
                value.salt,
                value.verifier,
                value.verifier_iv,
                value.iterations,
                value.hint,
              ],
            );
            return { error: null };
          } catch (error) {
            return { error };
          }
        },
      };
    },
  },
}));
const { createVaultSettings, fetchVaultSettings } = await import("../src/lib/vault/service");
const { useVaultBootstrap } = await import("../src/lib/vault/use-vault-bootstrap");
beforeAll(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'',true), '''')::uuid';
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END';`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260522114730_20cbdb4a-f6a6-4e96-b73d-3ea6e6e7c761.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`INSERT INTO auth.users VALUES ('${owner}'),('${other}');
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT,INSERT ON public.vault_settings TO authenticated;
    SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';`);
}, 30000);
beforeEach(async () => {
  failure = null;
  writes = 0;
  await db.exec("RESET ROLE; DELETE FROM vault_settings; SET ROLE authenticated;");
});
afterEach(cleanup);
afterAll(async () => db.close());
test("confirmed absence permits setup", async () => {
  const { result } = renderHook(() => useVaultBootstrap(owner, false));
  await waitFor(() => expect(result.current.bootstrapState).toBe("needs_setup"));
  expect(result.current.settings).toBeNull();
  expect(writes).toBe(0);
});
test("existing vault requires normal unlock", async () => {
  await createVaultSettings(row);
  const { result } = renderHook(() => useVaultBootstrap(owner, false));
  await waitFor(() => expect(result.current.bootstrapState).toBe("needs_unlock"));
  expect(result.current.settings?.salt).toBe(row.salt);
});
for (const kind of ["network", "supabase", "undefined"] as const) {
  test(`${kind} read failure never permits setup; retry finds existing vault`, async () => {
    await createVaultSettings(row);
    failure = kind;
    const { result } = renderHook(() => useVaultBootstrap(owner, false));
    await waitFor(() => expect(result.current.bootstrapState).toBe("error"));
    expect(writes).toBe(1);
    failure = null;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.bootstrapState).toBe("needs_unlock"));
    expect(result.current.settings?.verifier).toBe(row.verifier);
  });
}
test("refresh failure preserves loaded settings and unlocked input", async () => {
  await createVaultSettings(row);
  const { result } = renderHook(() => useVaultBootstrap(owner, true));
  await waitFor(() => expect(result.current.bootstrapState).toBe("ready"));
  const saved = result.current.settings;
  failure = "network";
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.bootstrapState).toBe("error"));
  expect(result.current.settings).toBe(saved);
  failure = null;
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.bootstrapState).toBe("ready"));
});
test("timeout presents error rather than setup", async () => {
  failure = "timeout";
  const { result } = renderHook(() => useVaultBootstrap(owner, false));
  await waitFor(() => expect(result.current.bootstrapState).toBe("error"), { timeout: 17000 });
  expect(writes).toBe(0);
}, 20000);
test("concurrent setup has exactly one winner and never overwrites settings", async () => {
  const competing = { ...row, salt: "different-salt", verifier: "different-verifier" };
  const results = await Promise.allSettled([
    createVaultSettings(row),
    createVaultSettings(competing),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  const saved = await fetchVaultSettings(owner);
  await expect(createVaultSettings({ ...row, salt: "overwrite-attempt" })).rejects.toBeDefined();
  expect(await fetchVaultSettings(owner)).toEqual(saved);
});
test("INSERT RLS rejects creating another user's settings", async () => {
  await expect(createVaultSettings({ ...row, user_id: other })).rejects.toBeDefined();
  expect(await fetchVaultSettings(owner)).toBeNull();
});
