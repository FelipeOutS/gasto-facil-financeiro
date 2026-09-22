import { expect, mock, test } from "bun:test";

let resolveRead: (value: unknown) => void;
let read = Promise.resolve<unknown>({ data: [] });
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: () => query,
        insert: () => query,
        then: (ok: any, fail: any) => read.then(ok, fail),
      };
      return query;
    },
  },
}));
const { setActiveUserId, refreshGastos, getGastos, hydrateUser, getHydrationStatus } =
  await import("@/lib/store");

test("an old expense response cannot populate another account or a new session of the same account", async () => {
  setActiveUserId("account-a");
  read = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const pending = refreshGastos();
  setActiveUserId("account-b");
  setActiveUserId("account-a");
  resolveRead({
    data: [{ id: "old-expense", descricao: "Private", valor: 10, data: "2026-09-20" }],
  });
  await pending;
  expect(getGastos()).toEqual([]);
  setActiveUserId(null);
});

test("a hydration failure from the previous account cannot change the active account state", async () => {
  setActiveUserId("account-a");
  let rejectRead!: (error: Error) => void;
  read = new Promise((_, reject) => {
    rejectRead = reject;
  });
  const pending = hydrateUser("account-a");
  setActiveUserId("account-b");
  rejectRead(new Error("Previous account request failed"));
  await pending;
  expect(getHydrationStatus()).toBe("idle");
  expect(getGastos()).toEqual([]);
  setActiveUserId(null);
});

test("hung hydration expires and late response cannot overwrite a newer hydration", async () => {
  setActiveUserId("account-a");
  let release!: (value: unknown) => void;
  read = new Promise((resolve) => {
    release = resolve;
  });
  const nativeTimeout = globalThis.setTimeout;
  let expire!: () => void;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    if (ms === 30000) {
      expire = callback;
      return nativeTimeout(() => {}, 60000);
    }
    return nativeTimeout(callback, ms);
  }) as typeof setTimeout;
  try {
    const old = hydrateUser("account-a");
    expire();
    await old;
    expect(getHydrationStatus()).toBe("error");
    setActiveUserId("account-b");
    release({ data: [] });
    await Promise.resolve();
    expect(getHydrationStatus()).toBe("idle");
    expect(getGastos()).toEqual([]);
  } finally {
    globalThis.setTimeout = nativeTimeout;
    setActiveUserId(null);
  }
});
