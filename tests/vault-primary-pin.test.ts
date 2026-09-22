import { expect, mock, test } from "bun:test";
import {
  createMasterKey,
  encryptSecret,
  decryptSecret,
  vaultB64encode,
  exportMasterKeyRaw,
} from "../src/lib/vault/crypto";
let row: Record<string, unknown> | null = null;
let successAttempts = 0;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "vault_pin_set")
        row = {
          user_id: "fixture-user",
          salt: args.p_salt,
          iterations: args.p_iterations,
          wrapped_key: args.p_wrapped_key,
          wrap_iv: args.p_wrap_iv,
          failed_attempts: 0,
          locked_until: null,
        };
      if (name === "vault_pin_record_attempt" && args.p_success) successAttempts++;
      return { error: null, data: [{ failed_attempts: 1, locked_until: null }] };
    },
  },
}));
const { enableServerPin, unlockWithServerPin } = await import("../src/lib/vault/server-pin");
test("existing PIN wrapping and normal vault data remain usable without native quick unlock", async () => {
  const created = await createMasterKey("synthetic fixture master password");
  const entry = await encryptSecret(created.key, { password: "existing encrypted entry" });
  await enableServerPin("123456", created.key);
  await expect(unlockWithServerPin("fixture-user", "654321")).rejects.toThrow("PIN incorreto");
  const key = await unlockWithServerPin("fixture-user", "123456");
  expect((await decryptSecret(key, entry)).password).toBe("existing encrypted entry");
  expect(successAttempts).toBe(1);
});

test("legacy migration accepts the key recovered with the legitimate existing PIN", async () => {
  const { migrateLegacyQuickUnlock, unlockWithBiometric } =
    await import("../src/lib/vault/quick-unlock");
  const created = await createMasterKey("synthetic second master password");
  const entry = await encryptSecret(created.key, { notes: "preserved during PIN migration" });
  await enableServerPin("123456", created.key);
  const recovered = await unlockWithServerPin("fixture-user", "123456");
  const disk = new Map([
    [
      "vault:quick:fixture-user",
      JSON.stringify({
        v: 1,
        kind: "android-bio",
        createdAt: 1,
        localKey: "do-not-use",
        wrapped: "do-not-use",
      }),
    ],
  ]);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let saved: string | undefined;
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => disk.get(key) ?? null,
        setItem: (key: string, value: string) => disk.set(key, value),
        removeItem: (key: string) => disk.delete(key),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        NativeVault: {
          version: 2,
          status: async () => ({ success: true, available: true }),
          enroll: async (userId: string, master_key: string) => {
            saved = master_key;
            return { success: true, userId, master_key };
          },
          unlock: async (userId: string) => ({ success: true, userId, master_key: saved }),
          clear: async () => ({ success: true }),
        },
      },
    });
    await migrateLegacyQuickUnlock("fixture-user", "fixture", recovered);
    expect(saved).toBe(vaultB64encode(await exportMasterKeyRaw(created.key)));
    expect(disk.get("vault:quick:fixture-user")).not.toContain("localKey");
    const opened = await unlockWithBiometric("fixture-user");
    expect((await decryptSecret(opened, entry)).notes).toBe("preserved during PIN migration");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
