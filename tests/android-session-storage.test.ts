import { expect, test } from "bun:test";
import { androidSessionStorage } from "../src/lib/android-session-storage";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("browser and Lovable preview keep their existing storage", () => {
  const fallback = storage();
  expect(androidSessionStorage(fallback, false)).toBe(fallback);
  expect(androidSessionStorage(undefined, false)).toBeUndefined();
});
test("native SDK session is memory-only and legacy copies are removed", async () => {
  const fallback = storage();
  fallback.setItem("app_android_biometric_session", "old-refresh");
  fallback.setItem("sb-test-auth-token", "old-session");
  fallback.setItem("user-theme", "dark");
  const native = androidSessionStorage(fallback, true)!;
  expect(await native.getItem("sb-test-auth-token")).toBeNull();
  expect(fallback.getItem("sb-test-auth-token")).toBeNull();
  expect(fallback.getItem("app_android_biometric_session")).toBeNull();
  await native.setItem("sb-test-auth-token", "unlocked-session");
  expect(await native.getItem("sb-test-auth-token")).toBe("unlocked-session");
  expect(fallback.getItem("sb-test-auth-token")).toBeNull();
  expect(fallback.getItem("user-theme")).toBe("dark");
  expect(await androidSessionStorage(fallback, true)!.getItem("sb-test-auth-token")).toBeNull();
  await native.removeItem("sb-test-auth-token");
  expect(await native.getItem("sb-test-auth-token")).toBeNull();
});
test("inaccessible persistent storage does not downgrade native protection", async () => {
  const native = androidSessionStorage(
    {
      getItem: () => "must-not-read",
      setItem: () => {
        throw Error();
      },
      removeItem: () => {
        throw Error();
      },
    },
    true,
  )!;
  await native.setItem("session", "memory");
  expect(await native.getItem("session")).toBe("memory");
});
