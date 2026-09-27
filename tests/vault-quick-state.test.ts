import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { createMasterKey, keyMatchesVaultSettings } from "../src/lib/vault/crypto";
import type { VaultSettingsRow } from "../src/lib/vault/service";

let settings: VaultSettingsRow;
mock.module("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settings, error: null }) }) }) }),
} }));
const { assertCurrentVaultKey } = await import("../src/lib/vault/service");
const { invalidateQuickCredentials, rememberQuickCredential, syncQuickCredentials, VaultKeyChangedError } =
  await import("../src/lib/vault/quick-unlock-state");
const { enrollNativePin, unlockWithNativePin } = await import("../src/lib/vault/native-pin");
const { enableBiometricUnlock } = await import("../src/lib/vault/quick-unlock");

const uid = "state-fixture";
const original = new Map(["window", "localStorage"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
let old: Awaited<ReturnType<typeof createMasterKey>>;
let fresh: Awaited<ReturnType<typeof createMasterKey>>;
let disk: Map<string, string>;
let pins: Map<string, { pin: string; raw: string }>;
let bios: Map<string, string>;
let refuseClear = false;
function row(key: typeof old, userId = uid): VaultSettingsRow {
  return { user_id: userId, salt: key.salt, verifier: key.verifier, verifier_iv: key.verifier_iv, iterations: key.iterations, hint: null };
}
beforeAll(async () => {
  old = await createMasterKey("synthetic old master password");
  fresh = await createMasterKey("synthetic new master password");
});
beforeEach(() => {
  settings = row(old); refuseClear = false; disk = new Map(); pins = new Map(); bios = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => disk.set(k, v),
    removeItem: (k: string) => disk.delete(k),
  } });
  // Transport fixture, not a replacement for Android Keystore acceptance.
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    NativeVaultPin: { version: 1,
      status: async (id: string) => ({ success: true, userId: id, configured: pins.has(id), failed_attempts: 0 }),
      enroll: async (id: string, pin: string, raw: string) => { pins.set(id, { pin, raw }); return { success: true, userId: id, configured: true }; },
      unlock: async (id: string, pin: string) => pins.get(id)?.pin === pin
        ? { success: true, userId: id, master_key: pins.get(id)!.raw }
        : { success: false, userId: id, error: "PIN incorreto" },
      clear: async (id: string) => { if (!refuseClear) pins.delete(id); return { success: !refuseClear, userId: id }; },
    },
    NativeVault: { version: 2,
      status: async () => ({ success: true, available: true }),
      enroll: async (id: string, raw: string) => { bios.set(id, raw); return { success: true, userId: id, master_key: raw }; },
      unlock: async (id: string) => ({ success: true, userId: id, master_key: bios.get(id) }),
      clear: async (id: string) => { if (!refuseClear) bios.delete(id); return { success: !refuseClear }; },
    },
  } });
});
afterEach(() => { for (const [k, d] of original) { if (d) Object.defineProperty(globalThis, k, d); else Reflect.deleteProperty(globalThis, k); } });
async function configured() {
  await enrollNativePin(uid, "123456", old.key);
  rememberQuickCredential(uid, "pin", row(old));
  await enableBiometricUnlock(uid, "Fixture", old.key);
  rememberQuickCredential(uid, "biometric", row(old));
}

test("confirmed rotation invalidates native PIN and biometric enrollment before next settings read", async () => {
  await configured();
  expect((await syncQuickCredentials(uid, settings)).nativePin?.configured).toBe(true);
  settings = row(fresh);
  await invalidateQuickCredentials(uid, settings);
  const state = await syncQuickCredentials(uid, settings);
  expect(state.nativePin?.configured).toBe(false);
  expect(state.biometric).toBeNull();
  expect(state.needsReconfiguration).toBe(true);
  expect(pins.has(uid)).toBe(false); expect(bios.has(uid)).toBe(false);
  await expect(unlockWithNativePin(uid, "123456")).rejects.toThrow();
});
test("another device rotated: fresh settings reconcile without trying the previous PIN", async () => {
  await configured(); settings = row(fresh);
  const state = await syncQuickCredentials(uid, settings);
  expect(state.nativePin?.configured).toBe(false);
  expect(state.biometric).toBeNull(); expect(pins.size).toBe(0);
});
test("new enrollment binds the current configuration, opens with new PIN and rejects old PIN", async () => {
  await configured(); settings = row(fresh); await invalidateQuickCredentials(uid, settings);
  await enrollNativePin(uid, "654321", fresh.key);
  const recovered = await unlockWithNativePin(uid, "654321");
  rememberQuickCredential(uid, "pin", await assertCurrentVaultKey(uid, recovered));
  expect(await keyMatchesVaultSettings(recovered, settings)).toBe(true);
  expect((await syncQuickCredentials(uid, settings)).nativePin?.configured).toBe(true);
  await expect(unlockWithNativePin(uid, "123456")).rejects.toThrow();
});
test("cleanup refusal cannot resurrect stale credentials after navigation or persisted-state reload", async () => {
  await configured(); refuseClear = true; settings = row(fresh);
  await invalidateQuickCredentials(uid, settings);
  expect(pins.has(uid)).toBe(true); // refusal is not misreported as physical deletion
  expect((await syncQuickCredentials(uid, settings)).nativePin?.configured).toBe(false);
  const serialized = JSON.parse(disk.get(`vault:quick-state:${uid}`)!);
  expect(serialized.reset).toBe(true); expect(serialized.pin).toBeUndefined(); expect(serialized.biometric).toBeUndefined();
  expect((await syncQuickCredentials(uid, settings)).biometric).toBeNull();
});
test("late mismatch stays rejected and invalidates all stale quick unlock state", async () => {
  await configured(); settings = row(fresh);
  await expect(assertCurrentVaultKey(uid, old.key)).rejects.toBeInstanceOf(VaultKeyChangedError);
  expect(await keyMatchesVaultSettings(old.key, settings)).toBe(false);
  expect((await syncQuickCredentials(uid, settings)).nativePin?.configured).toBe(false);
});
test("unbound pre-update credentials require setup without deleting unknown valid native material", async () => {
  await enrollNativePin(uid, "123456", old.key);
  const state = await syncQuickCredentials(uid, settings);
  expect(state.nativePin?.configured).toBe(false); expect(state.pinNeedsSetup).toBe(true);
  expect(pins.has(uid)).toBe(true);
});
test("account configuration never binds or clears another user's credentials", async () => {
  await configured();
  await expect(syncQuickCredentials("other", settings)).rejects.toThrow("outro Cofre");
  expect(pins.has(uid)).toBe(true);
  const state = await syncQuickCredentials("other", row(fresh, "other"));
  expect(state.nativePin?.configured).toBe(false); expect(state.biometric).toBeNull();
  expect(pins.has(uid)).toBe(true);
});
test("metadata contains public configuration only, never native key material or PIN", async () => {
  await configured();
  const metadata = disk.get(`vault:quick-state:${uid}`)!;
  expect(metadata).not.toContain(pins.get(uid)!.raw);
  expect(metadata).not.toContain('"123456"'); expect(metadata).not.toContain("master_key");
});
