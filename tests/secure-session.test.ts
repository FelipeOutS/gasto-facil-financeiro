import { afterEach, expect, mock, test } from "bun:test";
import type { Session } from "@supabase/supabase-js";

mock.module("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
const { saveSecureSession, clearSecureSession, unlockSecureSession } =
  await import("../src/lib/secure-session");
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const session = {
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  user: { id: "synthetic-user", email: "test@example.invalid" },
} as Session;
function bridge(value: object) {
  const target = new EventTarget();
  Object.assign(target, { AndroidSecureSession: value });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return target;
}
afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("save waits for native persistence and propagates refusal", async () => {
  let finish!: (ok: boolean) => void;
  bridge({
    saveSession: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  });
  let completed = false;
  const result = saveSecureSession(session).then((ok) => {
    completed = true;
    return ok;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish(false);
  expect(await result).toBe(false);
});
test("save handles native failures without reporting success", async () => {
  bridge({
    saveSession: async () => {
      throw new Error("Synthetic failure");
    },
  });
  expect(await saveSecureSession(session)).toBe(false);
});
test("save accepts acknowledged persistence and legacy void bridges", async () => {
  for (const result of [true, undefined]) {
    bridge({ saveSession: () => result });
    expect(await saveSecureSession(session)).toBe(true);
  }
});
test("invalid sessions never call native persistence", async () => {
  let calls = 0;
  bridge({
    saveSession: () => {
      calls++;
      return true;
    },
  });
  expect(await saveSecureSession(null)).toBe(false);
  expect(await saveSecureSession({ ...session, refresh_token: "" })).toBe(false);
  expect(calls).toBe(0);
});
test("clear tolerates an asynchronous native rejection", async () => {
  let calls = 0;
  bridge({
    clearSession: async () => {
      calls++;
      throw new Error("Synthetic failure");
    },
  });
  clearSecureSession();
  await Promise.resolve();
  expect(calls).toBe(1);
});
test("unlock returns cancellation without tokens", async () => {
  const target = bridge({
    unlockSession: () => {
      target.dispatchEvent(
        new CustomEvent("AndroidSecureSessionResult", {
          detail: { success: false, error: "Canceled" },
        }),
      );
    },
  });
  expect(await unlockSecureSession()).toEqual({ success: false, error: "Canceled" });
});
test("unlock times out and ignores a late success", async () => {
  const target = bridge({ unlockSession: () => {} });
  expect(await unlockSecureSession(1)).toMatchObject({ success: false });
  target.dispatchEvent(
    new CustomEvent("AndroidSecureSessionResult", {
      detail: { success: true, access_token: "late" },
    }),
  );
});
