import { afterEach, expect, mock, test } from "bun:test";
const session = {
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  user: { id: "synthetic-owner", email: "qa@example.invalid" },
};
mock.module("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
}));
const { enableLoginBio, LOGIN_BIO_SESSION_KEY, LOGIN_BIO_ENABLED_KEY } =
  await import("../src/lib/biometric-login");
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});
function setup(save: () => Promise<boolean>, success = true) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  };
  const target = new EventTarget();
  const saveSession = mock(save);
  Object.assign(target, {
    localStorage: storage,
    sessionStorage: storage,
    AndroidSecureSession: { saveSession },
    AndroidBiometric: {
      authenticate: () =>
        target.dispatchEvent(new CustomEvent("AndroidBiometricResult", { detail: { success } })),
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return { values, saveSession };
}
test("activation waits for native save and never persists plaintext tokens", async () => {
  let resolve!: (ok: boolean) => void;
  const { values, saveSession } = setup(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const task = enableLoginBio("qa@example.invalid");
  await new Promise((r) => setTimeout(r, 0));
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(values.get(LOGIN_BIO_ENABLED_KEY)).toBeUndefined();
  resolve(true);
  await task;
  expect(values.get(LOGIN_BIO_ENABLED_KEY)).toBe("true");
  expect(values.has(LOGIN_BIO_SESSION_KEY)).toBe(false);
  expect(JSON.stringify([...values])).not.toContain("synthetic-access");
});
test("native refusal never enables or falls back to plaintext", async () => {
  const { values } = setup(async () => false);
  await expect(enableLoginBio("qa@example.invalid")).rejects.toThrow("Não foi possível salvar");
  expect(values.has(LOGIN_BIO_ENABLED_KEY)).toBe(false);
  expect(values.has(LOGIN_BIO_SESSION_KEY)).toBe(false);
});
test("cancelled biometric never saves", async () => {
  const { saveSession } = setup(async () => true, false);
  await expect(enableLoginBio("qa@example.invalid")).rejects.toThrow();
  expect(saveSession).not.toHaveBeenCalled();
});
