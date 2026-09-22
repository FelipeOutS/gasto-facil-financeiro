// PostgreSQL/WASM integration: executes the real migration without a remote database.
import { beforeAll, afterAll, beforeEach, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createMasterKey,
  decryptSecret,
  encryptSecret,
  unlockMasterKey,
  keyMatchesVaultSettings,
} from "../src/lib/vault/crypto";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let lostResponse = false;
let requests: any[] = [];
let beforeRpc: (() => Promise<void>) | null = null;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      if (!["vault_settings", "vault_entries"].includes(table)) throw new Error("Unexpected table");
      // Expose reads only: sequential client writes must fail the test.
      return {
        select: () => ({
          eq: (_column: string, id: string) => {
            const read = async (single: boolean) => {
              const result = await db.query(
                `SELECT * FROM public.${table} WHERE user_id = $1 ORDER BY user_id`,
                [id],
              );
              return { data: single ? (result.rows[0] ?? null) : result.rows, error: null };
            };
            const ordered = {
              order: () => ordered,
              then: (resolve: any, reject: any) => read(false).then(resolve, reject),
            };
            return { ...ordered, maybeSingle: () => read(true) };
          },
        }),
      };
    },
    async rpc(name: string, args: any) {
      expect(name).toBe("vault_rotate_master_key_atomic");
      requests.push(args);
      if (beforeRpc) {
        const action = beforeRpc;
        beforeRpc = null;
        await action();
      }
      try {
        const result = await callRpc(args);
        if (lostResponse) {
          lostResponse = false;
          throw new Error("connection lost after commit");
        }
        return { data: result, error: null };
      } catch {
        return { data: null, error: { message: "RPC failed" } };
      }
    },
  },
}));
const { rotateMasterKey, assertCurrentVaultKey } = await import("../src/lib/vault/service");
async function callRpc(a: any) {
  const result = await db.query(
    "SELECT public.vault_rotate_master_key_atomic($1::jsonb,$2::jsonb,$3::jsonb) AS result",
    [
      JSON.stringify(a.p_expected_settings),
      JSON.stringify(a.p_new_settings),
      JSON.stringify(a.p_entries),
    ],
  );
  return result.rows[0].result;
}
async function snapshot() {
  return {
    settings: (await db.query("SELECT * FROM vault_settings ORDER BY user_id")).rows,
    entries: (await db.query("SELECT * FROM vault_entries ORDER BY id")).rows,
    pin: (await db.query("SELECT * FROM vault_pin_settings ORDER BY user_id")).rows,
  };
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END';`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260522114730_20cbdb4a-f6a6-4e96-b73d-3ea6e6e7c761.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260523010517_9c718908-99dc-416a-9dcb-b313791458ff.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260922230000_vault_rotate_master_key_atomic.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`INSERT INTO auth.users VALUES ('${owner}'),('${other}');
    CREATE TABLE rotation_test_counter(n integer); INSERT INTO rotation_test_counter VALUES (0);
    CREATE FUNCTION rotation_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE rotation_test_counter SET n=n+1;
      IF (SELECT n FROM rotation_test_counter) = 2 THEN RAISE EXCEPTION 'synthetic second entry failure'; END IF;
      RETURN NEW; END $$;`);
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  requests = [];
  lostResponse = false;
  beforeRpc = null;
  await db.exec(
    "DROP TRIGGER IF EXISTS rotation_test_fail ON vault_entries; TRUNCATE vault_entries,vault_settings,vault_pin_settings; UPDATE rotation_test_counter SET n=0;",
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
});
async function seed() {
  const built = await createMasterKey("old synthetic password");
  await db.query(
    "INSERT INTO vault_settings(user_id,salt,iterations,verifier,verifier_iv,hint) VALUES ($1,$2,$3,$4,$5,$6)",
    [owner, built.salt, built.iterations, built.verifier, built.verifier_iv, "synthetic hint"],
  );
  for (let n = 1; n <= 3; n++) {
    const enc = await encryptSecret(built.key, {
      username: `user${n}`,
      password: `secret${n}`,
      notes: `note${n}`,
    });
    await db.query(
      "INSERT INTO vault_entries(id,user_id,name,username_cipher,password_cipher,notes_cipher,cipher_iv) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        `00000000-0000-4000-8000-00000000000${n}`,
        owner,
        `entry${n}`,
        enc.username_cipher,
        enc.password_cipher,
        enc.notes_cipher,
        enc.cipher_iv,
      ],
    );
  }
  await db.query(
    "INSERT INTO vault_pin_settings(user_id,salt,wrapped_key,wrap_iv) VALUES ($1,'synthetic salt','old wrapped key','synthetic iv')",
    [owner],
  );
  const state = await snapshot();
  return {
    built,
    state,
    args: {
      userId: owner,
      currentKey: built.key,
      currentSettings: state.settings[0],
      newPassword: "new synthetic password",
      hint: "new hint",
    },
  };
}

test("second-entry failure rolls back ALL entries/settings/PIN; retry commits three decryptable entries", async () => {
  const { state, args, built } = await seed();
  await db.exec(
    "CREATE TRIGGER rotation_test_fail AFTER UPDATE ON vault_entries FOR EACH ROW EXECUTE FUNCTION rotation_test_failure();",
  );
  await expect(rotateMasterKey(args)).rejects.toThrow();
  expect(await snapshot()).toEqual(state);
  expect((await db.query("SELECT n FROM rotation_test_counter")).rows[0].n).toBe(0);
  await db.exec("DROP TRIGGER rotation_test_fail ON vault_entries");
  const settings = await rotateMasterKey(args);
  const newKey = await unlockMasterKey(args.newPassword, settings);
  expect(newKey).not.toBeNull();
  expect(await unlockMasterKey("old synthetic password", settings)).toBeNull();
  const after = await snapshot();
  expect(after.pin).toHaveLength(0);
  for (let n = 0; n < 3; n++) {
    expect(await decryptSecret(newKey!, after.entries[n])).toEqual({
      username: `user${n + 1}`,
      password: `secret${n + 1}`,
      notes: `note${n + 1}`,
    });
    await expect(decryptSecret(built.key, after.entries[n])).rejects.toThrow();
  }
  // Request contains no secret/password/key material; only ciphertext/settings.
  const wire = JSON.stringify(requests);
  expect(wire).not.toContain("synthetic password");
  expect(wire).not.toContain('"currentKey"');
  expect(wire).not.toContain('"secret1"');
}, 30000);

test("two prepared rotations: only first generation commits; stale request changes nothing", async () => {
  const { args } = await seed();
  await rotateMasterKey(args);
  const committed = await snapshot();
  await expect(callRpc(requests[0])).rejects.toThrow("vault_rotation_conflict");
  expect(await snapshot()).toEqual(committed);
});

test("editing an entry during preparation rejects the entire stale snapshot", async () => {
  const { args } = await seed();
  beforeRpc = async () => {
    await db.exec("UPDATE vault_entries SET name='concurrent edit' WHERE name='entry1'");
  };
  await expect(rotateMasterKey(args)).rejects.toThrow();
  const after = await snapshot();
  expect(after.entries[0].name).toBe("concurrent edit");
  expect(after.settings[0].salt).toBe(args.currentSettings.salt);
  expect(after.pin).toHaveLength(1);
  for (const row of after.entries) expect(await decryptSecret(args.currentKey, row)).toBeDefined();
});

test("lost response AFTER commit is reconciled, without a second rotation", async () => {
  const { args } = await seed();
  lostResponse = true;
  const next = await rotateMasterKey(args);
  expect(requests).toHaveLength(1);
  expect(await unlockMasterKey(args.newPassword, next)).not.toBeNull();
});

test("old quick unlock key is rejected against the new settings", async () => {
  const { args } = await seed();
  await rotateMasterKey(args);
  await expect(assertCurrentVaultKey(owner, args.currentKey)).rejects.toThrow(
    "chave do Cofre mudou",
  );
  expect(await keyMatchesVaultSettings(args.currentKey, (await snapshot()).settings[0])).toBe(
    false,
  );
});

test("no session or another owner cannot rotate these entries", async () => {
  const { args } = await seed();
  await rotateMasterKey(args);
  const committed = await snapshot();
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await expect(callRpc(requests[0])).rejects.toThrow("unauthorized");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
  await expect(callRpc(requests[0])).rejects.toThrow("missing_settings");
  expect(await snapshot()).toEqual(committed);
  const grants = await db.query(
    "SELECT has_function_privilege('anon','vault_rotate_master_key_atomic(jsonb,jsonb,jsonb)','EXECUTE') AS anon, has_function_privilege('authenticated','vault_rotate_master_key_atomic(jsonb,jsonb,jsonb)','EXECUTE') AS authenticated",
  );
  expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
});

test("simultaneous client rotations cannot both commit from the same settings", async () => {
  const { args } = await seed();
  const outcomes = await Promise.allSettled([
    rotateMasterKey(args),
    rotateMasterKey({ ...args, newPassword: "competing synthetic password" }),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const state = await snapshot();
  const key = await unlockMasterKey(args.newPassword, state.settings[0]) ??
    await unlockMasterKey("competing synthetic password", state.settings[0]);
  expect(key).not.toBeNull();
  for (const row of state.entries) expect(await decryptSecret(key!, row)).toBeDefined();
});

test("failure at final PIN invalidation rolls back settings and every ciphertext", async () => {
  const { args, state } = await seed();
  await db.exec(`CREATE FUNCTION rotation_test_pin_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic final failure'; END $$;
    CREATE TRIGGER rotation_test_pin_fail BEFORE DELETE ON vault_pin_settings
    FOR EACH ROW EXECUTE FUNCTION rotation_test_pin_failure();`);
  try {
    await expect(rotateMasterKey(args)).rejects.toThrow();
    expect(await snapshot()).toEqual(state);
  } finally {
    await db.exec("DROP TRIGGER rotation_test_pin_fail ON vault_pin_settings; DROP FUNCTION rotation_test_pin_failure();");
  }
});

test("incomplete or duplicate entry payload cannot commit a partial rotation", async () => {
  const { args, state } = await seed();
  // Capture a prepared request while forcing a known transaction rollback.
  await db.exec("CREATE TRIGGER rotation_test_fail AFTER UPDATE ON vault_entries FOR EACH ROW EXECUTE FUNCTION rotation_test_failure();");
  await expect(rotateMasterKey(args)).rejects.toThrow();
  await db.exec("DROP TRIGGER rotation_test_fail ON vault_entries");
  const request = requests[0];
  await expect(callRpc({ ...request, p_entries: request.p_entries.slice(1) })).rejects.toThrow();
  await expect(callRpc({ ...request, p_entries: [request.p_entries[0], request.p_entries[0], request.p_entries[2]] })).rejects.toThrow();
  expect(await snapshot()).toEqual(state);
});
