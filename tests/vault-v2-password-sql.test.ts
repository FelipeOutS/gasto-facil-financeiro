import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("candidate SQL: single-use email, expiry, attempts, CAS, RLS and 14 legacy rows preserved", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("tests/sql/vault-v2/00-stub.sql", "utf8"));
    await db.exec(await readFile("docs/migrations-candidate/vault-v2-passwordless.sql", "utf8"));
    await db.exec(await readFile("tests/sql/vault-v2/01-email-queue-stub.sql", "utf8"));
    const before = await db.query("SELECT * FROM vault_entries ORDER BY id");
    await db.exec(await readFile("docs/migrations-candidate/vault-v2-password-email.sql", "utf8"));
    const uid = "aaaaaaaa-0000-0000-0000-000000000001",
      vault = "aaaaaaaa-1111-1111-1111-111111111111",
      nonce = "aaaaaaaa-2222-2222-2222-222222222222";
    await db.exec(
      `INSERT INTO vaults(id,user_id) VALUES('${vault}','${uid}'); INSERT INTO vault_keyslots(vault_id,user_id,kind,envelope) VALUES('${vault}','${uid}','recovery','{}'); SET request.jwt.claim.sub='${uid}';`,
    );
    const q = async (sql: string) =>
      (await db.query<{ v: unknown }>(`SELECT ${sql} AS v`)).rows[0].v;
    const begin = () =>
      q(`vault_v2_email_begin('${uid}','${vault}','${nonce}','hash','owner@example.com')`);
    const verify = (hash = "hash") =>
      q(`vault_v2_email_verify('${uid}','${nonce}','${hash}','owner@example.com')`);
    expect(await begin()).toBe(true);
    expect(await begin()).toBe(false);
    expect(await verify("wrong")).toBe(false);
    expect(await verify()).toBe(true);
    expect(await verify()).toBe(false);
    const env = {
      v: 1,
      kind: "password",
      kdf: "PBKDF2-SHA256",
      iterations: 600000,
      context: JSON.stringify(["gi-vault-v2-password", uid, vault]),
      salt: "a".repeat(44),
      iv: "b".repeat(16),
      ct: "c".repeat(64),
    };
    await db.exec("SET ROLE authenticated");
    await q(`vault_v2_password_replace('${vault}',NULL,'${JSON.stringify(env)}','${nonce}')`);
    const slot = (
      await db.query<{ id: string }>(
        "SELECT id FROM vault_keyslots WHERE kind='password' AND revoked_at IS NULL",
      )
    ).rows[0].id;
    await expect(
      q(`vault_v2_password_replace('${vault}','${slot}','${JSON.stringify(env)}','${nonce}')`),
    ).rejects.toThrow("recovery_expired");
    await expect(
      q(`vault_v2_password_replace('${vault}',NULL,'${JSON.stringify(env)}',NULL)`),
    ).rejects.toThrow("vault_changed");
    for (let i = 0; i < 5; i++)
      expect(await q(`vault_v2_password_attempt('${vault}')`)).not.toBeNull();
    expect(await q(`vault_v2_password_attempt('${vault}')`)).toBeNull();
    await expect(
      db.query("UPDATE vault_keyslots SET failed_attempts=0 WHERE kind='password'"),
    ).rejects.toThrow("password_rpc_required");
    await expect(db.query("SELECT * FROM vault_v2_email_challenges")).rejects.toThrow();
    await db.exec(
      "RESET ROLE; UPDATE vault_v2_email_challenges SET verified_at=NULL,consumed_at=NULL,code_hash='hash',attempts=0,expires_at=now()-interval '1 second'",
    );
    expect(await verify()).toBe(false);
    await db.exec("UPDATE vault_v2_email_challenges SET expires_at=now()+interval '10 minutes'");
    for (let i = 0; i < 5; i++) expect(await verify("wrong")).toBe(false);
    expect(await verify()).toBe(false);
    await db.exec(
      "SET request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-000000000002'; SET ROLE authenticated",
    );
    expect(await q(`vault_v2_password_attempt('${vault}')`)).toBeNull();
    await expect(q(`vault_v2_password_replace('${vault}',NULL,NULL,NULL)`)).rejects.toThrow(
      "unauthorized",
    );
    await db.exec("RESET ROLE");
    expect(
      (await db.query("SELECT payload->>'label' AS label FROM test_email_queue")).rows,
    ).toEqual([{ label: "vault-password-changed" }]);
    // A queue outage must roll back both the password replacement and grant use.
    await db.exec(
      `SET request.jwt.claim.sub='${uid}'; UPDATE vault_v2_email_challenges SET attempts=0,verified_at=now(),consumed_at=NULL,expires_at=now()+interval '10 minutes'; SET test.fail_queue='true'; SET ROLE authenticated;`,
    );
    const current = (
      await db.query<{ id: string }>(
        "SELECT id FROM vault_keyslots WHERE kind='password' AND revoked_at IS NULL",
      )
    ).rows[0].id;
    await expect(
      q(`vault_v2_password_replace('${vault}','${current}','${JSON.stringify(env)}','${nonce}')`),
    ).rejects.toThrow("queue_unavailable");
    expect(
      (
        await db.query<{ id: string }>(
          "SELECT id FROM vault_keyslots WHERE kind='password' AND revoked_at IS NULL",
        )
      ).rows[0].id,
    ).toBe(current);
    await db.exec("RESET ROLE");
    expect(
      (
        await db.query<{ consumed_at: unknown }>(
          "SELECT consumed_at FROM vault_v2_email_challenges",
        )
      ).rows[0].consumed_at,
    ).toBeNull();
    expect((await db.query("SELECT * FROM vault_entries ORDER BY id")).rows).toEqual(before.rows);
    expect(before.rows.length).toBe(14);
  } finally {
    await db.close();
  }
}, 30000);
