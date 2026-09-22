import { afterEach, beforeAll, expect, test } from "bun:test";
import {
  createMasterKey,
  unlockMasterKey,
  encryptSecret,
  decryptSecret,
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64encode,
} from "../src/lib/vault/crypto";
import {
  disableQuickUnlock,
  enableBiometricUnlock,
  getQuickUnlock,
  isPlatformAuthenticatorAvailable,
  migrateLegacyQuickUnlock,
  needsQuickUnlockMigration,
  unlockWithBiometric,
} from "../src/lib/vault/quick-unlock";
import type { NativeVaultBridge, NativeVaultResult } from "../src/lib/vault/native-vault";

const uid = "vault-fixture-user";
const storageId = "vault:quick:" + uid;
const originals = new Map(
  ["window", "localStorage", "navigator"].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ]),
);
let settings: Awaited<ReturnType<typeof createMasterKey>>;
beforeAll(async () => {
  settings = await createMasterKey("synthetic master password");
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function environment(native?: NativeVaultBridge) {
  const disk = new Map<string, string>();
  const storage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => {
      disk.set(k, v);
    },
    removeItem: (k: string) => {
      disk.delete(k);
    },
  };
  const win = Object.assign(new EventTarget(), { NativeVault: native });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  return { disk, storage, win };
}
function nativeFixture() {
  const keys = new Map<string, string>();
  const state = { authorized: true, available: true, enrollments: 0, unlocks: 0 };
  const bridge: NativeVaultBridge = {
    version: 2,
    status: async () => ({ success: true, available: state.available }),
    enroll: async (userId, master_key) => {
      state.enrollments++;
      if (!state.authorized) return { success: false };
      keys.set(userId, master_key);
      return { success: true, userId, master_key };
    },
    unlock: async (userId) => {
      state.unlocks++;
      return state.authorized
        ? { success: true, userId, master_key: keys.get(userId) }
        : { success: false };
    },
    clear: async (userId) => {
      keys.delete(userId);
      return { success: true, userId };
    },
  };
  return { bridge, keys, state };
}
function legacy(disk: Map<string, string>) {
  // Deliberately unusable wrapper: migration must use the independently recovered primary key.
  const old = JSON.stringify({
    v: 1,
    kind: "android-bio",
    createdAt: 1,
    attempts: 0,
    localKey: "legacy-secret-must-not-be-used",
    iv: "invalid",
    wrapped: "invalid",
  });
  disk.set(storageId, old);
  disk.set("vault_android_biometric_enabled", "true");
  return old;
}

test("new native enrollment persists only metadata and requires successful round trip", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  await enableBiometricUnlock(uid, "fixture", settings.key);
  expect(getQuickUnlock(uid)?.kind).toBe("native-vault");
  const saved = JSON.parse(disk.get(storageId)!);
  expect(Object.keys(saved).sort()).toEqual(["createdAt", "kind", "userId", "v"]);
  expect(disk.get(storageId)).not.toContain(vaultB64encode(await exportMasterKeyRaw(settings.key)));
  expect(n.state.enrollments).toBe(1);
});
test("approved biometric returns the exact key and decrypts existing content", async () => {
  const n = nativeFixture();
  environment(n.bridge);
  const entry = await encryptSecret(settings.key, { password: "existing fixture data" });
  await enableBiometricUnlock(uid, "fixture", settings.key);
  expect((await decryptSecret(await unlockWithBiometric(uid), entry)).password).toBe(
    "existing fixture data",
  );
});
test("legacy record is detected but never decrypted or sent to old biometrics", async () => {
  const n = nativeFixture();
  const { disk, win } = environment(n.bridge);
  const old = legacy(disk);
  Object.assign(win, {
    AndroidBiometric: {
      authenticate: () => {
        throw new Error("Must never call legacy bridge");
      },
    },
  });
  expect(needsQuickUnlockMigration(uid)).toBe(true);
  expect(getQuickUnlock(uid)).not.toHaveProperty("localKey");
  await expect(unlockWithBiometric(uid)).rejects.toThrow("senha mestra");
  expect(n.state.unlocks).toBe(0);
  expect(disk.get(storageId)).toBe(old);
});
test("migration after legitimate password authentication preserves entries and removes all legacy material", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  legacy(disk);
  const entry = await encryptSecret(settings.key, { username: "existing", notes: "unchanged" });
  const key = await unlockMasterKey("synthetic master password", settings);
  expect(await migrateLegacyQuickUnlock(uid, "fixture", key!)).toBe(true);
  expect(needsQuickUnlockMigration(uid)).toBe(false);
  expect(disk.has("vault_android_biometric_enabled")).toBe(false);
  expect([...disk.values()].join()).not.toContain("localKey");
  expect([...disk.values()].join()).not.toContain("wrapped");
  expect((await decryptSecret(await unlockWithBiometric(uid), entry)).notes).toBe("unchanged");
});
test("canceled migration keeps the old record for explicit retry and password access still works", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  const old = legacy(disk);
  n.state.authorized = false;
  await expect(migrateLegacyQuickUnlock(uid, "fixture", settings.key)).rejects.toThrow();
  expect(disk.get(storageId)).toBe(old);
  expect(await unlockMasterKey("synthetic master password", settings)).not.toBeNull();
  await expect(unlockWithBiometric(uid)).rejects.toThrow();
});
test("biometric cancellation does not unlock even if an old success event is forged", async () => {
  const n = nativeFixture();
  const { win } = environment(n.bridge);
  await enableBiometricUnlock(uid, "fixture", settings.key);
  n.state.authorized = false;
  win.dispatchEvent(new Event("AndroidBiometricResult"));
  await expect(unlockWithBiometric(uid)).rejects.toThrow();
});
test("native failure is not replaced by web authentication or a local key", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  n.bridge.enroll = async () => {
    throw new Error("hardware failure");
  };
  await expect(enableBiometricUnlock(uid, "fixture", settings.key)).rejects.toThrow(
    "hardware failure",
  );
  expect(disk.size).toBe(0);
});
test("no enrolled strong biometric keeps the primary fallback and writes nothing", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  n.state.available = false;
  expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  await expect(enableBiometricUnlock(uid, "fixture", settings.key)).rejects.toThrow();
  expect(disk.size).toBe(0);
  expect(n.state.enrollments).toBe(0);
});
test("older Android is fail-closed and never enrolls an event-only local wrapper", async () => {
  const { win, disk } = environment();
  Object.assign(win, { AndroidBiometric: { authenticate: () => true } });
  expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  await expect(enableBiometricUnlock(uid, "fixture", settings.key)).rejects.toThrow();
  expect(disk.size).toBe(0);
});
test("corrupt local records fail closed without touching vault data", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  for (const raw of [
    "{",
    "null",
    "[]",
    JSON.stringify({ v: 1, kind: "webauthn", createdAt: 1, iv: "bad" }),
  ]) {
    disk.set(storageId, raw);
    expect(getQuickUnlock(uid)).toBeNull();
    await expect(unlockWithBiometric(uid)).rejects.toThrow();
  }
  expect(n.state.unlocks).toBe(0);
});
test("corrupt, wrong-user or absent native results never import a key", async () => {
  const n = nativeFixture();
  environment(n.bridge);
  await enableBiometricUnlock(uid, "fixture", settings.key);
  const responses: NativeVaultResult[] = [
    { success: true, userId: "other", master_key: n.keys.get(uid) },
    { success: true, userId: uid, master_key: "bad" },
    { success: false, userId: uid, master_key: n.keys.get(uid) },
    { success: true, userId: uid },
  ];
  for (const response of responses) {
    n.bridge.unlock = async () => response;
    await expect(unlockWithBiometric(uid)).rejects.toThrow();
  }
});
test("enrollment refuses a different key returned by the native round trip", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  n.bridge.enroll = async (userId) => ({
    success: true,
    userId,
    master_key: vaultB64encode(new Uint8Array(32)),
  });
  await expect(enableBiometricUnlock(uid, "fixture", settings.key)).rejects.toThrow();
  expect(disk.size).toBe(0);
});
test("storage failure never removes the legacy record before native success can be committed", async () => {
  const n = nativeFixture();
  const { disk, storage } = environment(n.bridge);
  const old = legacy(disk);
  storage.setItem = () => {
    throw new Error("quota");
  };
  await expect(migrateLegacyQuickUnlock(uid, "fixture", settings.key)).rejects.toThrow("quota");
  expect(disk.get(storageId)).toBe(old);
});
test("removal clears native and legacy material, and failed native clear is reported", async () => {
  const n = nativeFixture();
  const { disk } = environment(n.bridge);
  await enableBiometricUnlock(uid, "fixture", settings.key);
  await disableQuickUnlock(uid);
  expect(disk.size).toBe(0);
  expect(n.keys.size).toBe(0);
  legacy(disk);
  n.bridge.clear = async () => ({ success: false });
  await expect(disableQuickUnlock(uid)).rejects.toThrow();
  expect(needsQuickUnlockMigration(uid)).toBe(true);
});
test("normal vault password flow works without any quick unlock", async () => {
  const { disk } = environment();
  const entry = await encryptSecret(settings.key, { password: "fixture secret" });
  expect(await unlockMasterKey("incorrect", settings)).toBeNull();
  const key = await unlockMasterKey("synthetic master password", settings);
  expect((await decryptSecret(key!, entry)).password).toBe("fixture secret");
  expect(disk.size).toBe(0);
});
test("browser without PRF fails enrollment instead of storing an equivalent secret", async () => {
  const { win, disk } = environment();
  Object.assign(win, { PublicKeyCredential: function () {} });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: {
        create: async () => ({ rawId: new ArrayBuffer(16), getClientExtensionResults: () => ({}) }),
        get: async () => ({ getClientExtensionResults: () => ({}) }),
      },
    },
  });
  await expect(enableBiometricUnlock(uid, "fixture", settings.key)).rejects.toThrow("PRF");
  expect(disk.size).toBe(0);
});
test("web PRF is required again for decrypting the persisted wrapped key", async () => {
  const { win, disk } = environment();
  const secret = crypto.getRandomValues(new Uint8Array(32)).buffer;
  Object.assign(win, { PublicKeyCredential: function () {} });
  let approved = true;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: {
        create: async () => ({
          rawId: new ArrayBuffer(16),
          getClientExtensionResults: () => ({ prf: { results: { first: secret } } }),
        }),
        get: async () =>
          approved
            ? { getClientExtensionResults: () => ({ prf: { results: { first: secret } } }) }
            : null,
      },
    },
  });
  await enableBiometricUnlock(uid, "fixture", settings.key);
  expect(getQuickUnlock(uid)?.kind).toBe("webauthn");
  expect(disk.get(storageId)).not.toContain(vaultB64encode(secret));
  expect(await exportMasterKeyRaw(await unlockWithBiometric(uid))).toEqual(
    await exportMasterKeyRaw(settings.key),
  );
  approved = false;
  await expect(unlockWithBiometric(uid)).rejects.toThrow();
});
test("missing native storage after reinstall falls back safely", async () => {
  const n = nativeFixture();
  environment(n.bridge);
  await enableBiometricUnlock(uid, "fixture", settings.key);
  n.keys.clear();
  await expect(unlockWithBiometric(uid)).rejects.toThrow();
  expect(await unlockMasterKey("synthetic master password", settings)).not.toBeNull();
});
