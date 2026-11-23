import { test, expect } from "bun:test";
import {
  generateDek,
  encryptEntry,
  decryptEntry,
  wrapDek,
  unwrapDek,
  randomBytes,
  generateRecoveryKey,
  recoveryMaterial,
} from "../src/lib/vault/v2/keyslots";
import { wrapPassword, unwrapPassword } from "../src/lib/vault/v2/password";
import {
  setPassword,
  unlockWithPassword,
  type VaultStore,
  type Slot,
} from "../src/lib/vault/v2/service";

test("password service preserves other slots, propagates persistence failure and disables without losing recovery", async () => {
  const dek = await generateDek();
  const vault = { id: "v", user_id: "u", name: "Cofre", auto_lock_minutes: 5 };
  const recovery = {
    id: "r",
    vault_id: "v",
    user_id: "u",
    kind: "recovery",
    envelope: await wrapDek(dek, randomBytes(32), "recovery"),
    revoked_at: null,
  } as Slot;
  let passwordSlot: Slot | undefined;
  let fail = false;
  const store = {
    listSlots: async () => [recovery, ...(passwordSlot ? [passwordSlot] : [])],
    replacePassword: async (
      _v: string,
      expected: string | null,
      envelope: Slot["envelope"] | null,
    ) => {
      expect(expected).toBe(passwordSlot?.id ?? null);
      if (fail) throw Error("write_failed");
      passwordSlot = envelope
        ? { ...recovery, id: crypto.randomUUID(), kind: "password", envelope }
        : undefined;
    },
    passwordAttempt: async () => passwordSlot!,
  } as unknown as VaultStore;
  await setPassword(store, vault, dek, "Senha longa e exclusiva para teste");
  const original = passwordSlot;
  fail = true;
  await expect(setPassword(store, vault, dek, "Outra senha longa e exclusiva")).rejects.toThrow(
    "write_failed",
  );
  expect(passwordSlot).toBe(original);
  const entry = await encryptEntry(dek, "original");
  expect(
    await decryptEntry(
      await unlockWithPassword(store, vault, "Senha longa e exclusiva para teste"),
      entry,
    ),
  ).toBe("original");
  fail = false;
  await setPassword(store, vault, dek, null);
  expect(passwordSlot).toBeUndefined();
  expect(recovery.revoked_at).toBeNull();
});

test("password envelope preserves existing data, passkey and recovery after password change and reload", async () => {
  const dek = await generateDek(),
    rec = generateRecoveryKey(),
    prf = randomBytes(32);
  const entry = await encryptEntry(
    dek,
    JSON.stringify({ password: "original encrypted credential" }),
  );
  const snapshot = JSON.stringify(entry);
  const bio = await wrapDek(dek, prf, "passkey_prf");
  const recovery = await wrapDek(dek, recoveryMaterial(rec), "recovery");
  const env = await wrapPassword(dek, "Uma frase segura de verdade!", "owner", "vault");
  const fromReload = JSON.parse(JSON.stringify(env));
  const opened = await unwrapPassword(fromReload, "Uma frase segura de verdade!", "owner", "vault");
  expect(await decryptEntry(opened, entry)).toContain("original encrypted credential");
  await expect(
    unwrapPassword(env, "Outra senha completamente diferente", "owner", "vault"),
  ).rejects.toThrow();
  for (const [u, v] of [
    ["other", "vault"],
    ["owner", "other"],
  ])
    await expect(unwrapPassword(env, "Uma frase segura de verdade!", u, v)).rejects.toThrow();
  const changed = await wrapPassword(opened, "Nova frase independente e segura!", "owner", "vault");
  expect(
    await decryptEntry(
      await unwrapPassword(changed, "Nova frase independente e segura!", "owner", "vault"),
      entry,
    ),
  ).toContain("original encrypted credential");
  await expect(
    unwrapPassword(changed, "Uma frase segura de verdade!", "owner", "vault"),
  ).rejects.toThrow();
  expect(await decryptEntry(await unwrapDek(bio, prf), entry)).toContain(
    "original encrypted credential",
  );
  expect(await decryptEntry(await unwrapDek(recovery, recoveryMaterial(rec)), entry)).toContain(
    "original encrypted credential",
  );
  expect(JSON.stringify(entry)).toBe(snapshot);
  await expect(
    unwrapPassword(
      { ...env, iterations: 1 } as never,
      "Uma frase segura de verdade!",
      "owner",
      "vault",
    ),
  ).rejects.toThrow("envelope_invalido");
  await expect(wrapPassword(dek, "curta", "owner", "vault")).rejects.toThrow("senha_minima");
});
