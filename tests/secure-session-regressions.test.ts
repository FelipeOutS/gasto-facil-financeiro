import { afterEach, expect, mock, test } from "bun:test";
let failure: unknown = null;
let restored: any = null;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      setSession: async () => {
        if (failure instanceof Error) throw failure;
        return { error: failure };
      },
      getSession: async () => ({ data: { session: restored } }),
    },
  },
}));
const { loginWithSecureSession, unlockSecureSession } = await import("../src/lib/secure-session");
const { clearLoginBio, LOGIN_BIO_ENABLED_KEY } = await import("../src/lib/biometric-login");
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  failure = null;
  restored = null;
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});
function setup(auto = true, clearOk = true) {
  const target = new EventTarget();
  const values = new Map([[LOGIN_BIO_ENABLED_KEY, "true"]]);
  let saved = true;
  const clear = mock(async () => {
    if (clearOk) saved = false;
    return { success: clearOk };
  });
  const unlock = mock(() => {
    if (auto)
      target.dispatchEvent(
        new CustomEvent("AndroidSecureSessionResult", {
          detail: { success: true, access_token: "synthetic", refresh_token: "synthetic-refresh" },
        }),
      );
  });
  Object.assign(target, {
    localStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
    sessionStorage: { removeItem: () => {} },
    AndroidSecureSession: {
      clearSession: clear,
      unlockSession: unlock,
      hasSession: () => saved,
      saveSession: async () => false,
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return { target, clear, unlock, values };
}
test("network failure preserves credentials and refuses login", async () => {
  failure = new TypeError("Failed to fetch");
  const { clear } = setup();
  const r = await loginWithSecureSession();
  expect(r.session).toBeNull();
  expect(r.error).toContain("preservado");
  expect(clear).not.toHaveBeenCalled();
});
test("503 preserves saved access", async () => {
  failure = { status: 503, message: "temporary outage" };
  const { clear } = setup();
  await loginWithSecureSession();
  expect(clear).not.toHaveBeenCalled();
});
test("revoked refresh token clears saved access and denies login", async () => {
  failure = { code: "refresh_token_not_found" };
  const { clear } = setup();
  expect((await loginWithSecureSession()).session).toBeNull();
  expect(clear).toHaveBeenCalledTimes(1);
});
test("disable waits for native deletion before clearing preference", async () => {
  const { clear, values } = setup();
  await clearLoginBio();
  expect(values.has(LOGIN_BIO_ENABLED_KEY)).toBe(false);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(window.AndroidSecureSession!.hasSession!()).toBe(false);
});
test("failed deletion does not falsely report disabled", async () => {
  const { values } = setup(true, false);
  await expect(clearLoginBio()).rejects.toThrow("Não foi possível desativar");
  expect(values.get(LOGIN_BIO_ENABLED_KEY)).toBe("true");
});
test("concurrent unlock callers launch one native prompt", async () => {
  const { target, unlock } = setup(false);
  const a = unlockSecureSession(1000);
  const b = unlockSecureSession(1000);
  target.dispatchEvent(
    new CustomEvent("AndroidSecureSessionResult", {
      detail: { success: false, error: "cancelled" },
    }),
  );
  expect(await a).toEqual(await b);
  expect(unlock).toHaveBeenCalledTimes(1);
});
test("correlated native response ignores an unrelated event", async () => {
  const { target } = setup(false);
  let finish!: (v: any) => void;
  window.AndroidSecureSession!.unlockSession = () => new Promise((r) => (finish = r));
  const task = unlockSecureSession(1000);
  target.dispatchEvent(
    new CustomEvent("AndroidSecureSessionResult", {
      detail: { success: true, access_token: "wrong" },
    }),
  );
  finish({ success: false, error: "cancelled" });
  expect(await task).toEqual({ success: false, error: "cancelled" });
});
test("late native result cannot complete the next request", async () => {
  const { target } = setup(false);
  let old!: (v: any) => void;
  let fresh!: (v: any) => void;
  window.AndroidSecureSession!.unlockSession = () => new Promise((r) => (old = r));
  await unlockSecureSession(1);
  window.AndroidSecureSession!.unlockSession = () => new Promise((r) => (fresh = r));
  const task = unlockSecureSession(1000);
  old({ success: true, access_token: "old" });
  target.dispatchEvent(
    new CustomEvent("AndroidSecureSessionResult", {
      detail: { success: true, access_token: "old" },
    }),
  );
  fresh({ success: false });
  expect(await task).toEqual({ success: false });
});
test("renewal failure is surfaced while keeping valid online session", async () => {
  restored = {
    access_token: "new",
    refresh_token: "new-refresh",
    user: { id: "synthetic", email: "qa@example.invalid" },
  };
  const { clear } = setup();
  const result = await loginWithSecureSession();
  expect(result.session).toBe(restored);
  expect(result.warning).toContain("atualizar");
  expect(clear).not.toHaveBeenCalled();
});
