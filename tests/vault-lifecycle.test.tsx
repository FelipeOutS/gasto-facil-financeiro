import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, act, cleanup } = await import("@testing-library/react");
const vault = await import("../src/lib/vault/use-vault");
const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
  "encrypt",
  "decrypt",
]);
const anotherKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
  "encrypt",
  "decrypt",
]);
let now = 1_800_000_000_000;
let nextId = 1;
let jobs = new Map<number, { at: number; fn: () => void }>();
let spies: Array<{ mockRestore: () => void }> = [];
let visible = "visible";
let exposed: boolean[] = [];
function session(id = "alice", seconds = 3600) {
  return { user: { id }, expires_at: now / 1000 + seconds };
}
function unlock() {
  vault.setVaultSession(session());
  vault.setMasterKey(key, "alice");
  vault.setCachedSecret("entry", { password: "synthetic" }, key);
}
function Screen({ route }: { route: string }) {
  return route === "cofre" ? <VaultScreen /> : <div>Dashboard</div>;
}
function VaultScreen() {
  const state = vault.useVaultKey();
  exposed.push(state.isUnlocked);
  return <div>{state.isUnlocked ? "sensitive" : "locked"}</div>;
}
function advance(ms: number, run = true) {
  now += ms;
  if (run)
    for (const [id, job] of [...jobs])
      if (job.at <= now) {
        jobs.delete(id);
        job.fn();
      }
}
function visibility(value: string) {
  visible = value;
  document.dispatchEvent(new Event("visibilitychange"));
}
beforeEach(() => {
  now = 1_800_000_000_000;
  jobs = new Map();
  visible = "visible";
  exposed = [];
  spies = [
    spyOn(Date, "now").mockImplementation(() => now),
    spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay: number) => {
      const id = nextId++;
      jobs.set(id, { at: now + delay, fn });
      return id;
    }) as any),
    spyOn(globalThis, "clearTimeout").mockImplementation(((id: number) => {
      jobs.delete(id);
    }) as any),
  ];
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible });
  vault.setVaultSession(null);
});
afterEach(() => {
  cleanup();
  vault.setVaultSession(null);
  for (const spy of spies) spy.mockRestore();
});
test("route unmount retains watchdog; deadline clears key and cache off-route", () => {
  unlock();
  const ui = render(<Screen route="cofre" />);
  ui.rerender(<Screen route="dashboard" />);
  expect(jobs.size).toBe(1);
  act(() => advance(300000));
  expect(jobs.size).toBe(0);
  expect(vault.getCachedSecret("entry")).toBeUndefined();
  exposed = [];
  ui.rerender(<Screen route="cofre" />);
  expect(exposed.every((value) => !value)).toBe(true);
  expect(ui.container.textContent).toBe("locked");
});
test("suspended timers cannot expose key on first reentry render", () => {
  unlock();
  const ui = render(<Screen route="cofre" />);
  ui.rerender(<Screen route="dashboard" />);
  advance(300001, false);
  exposed = [];
  ui.rerender(<Screen route="cofre" />);
  expect(exposed).toEqual([false]);
  expect(ui.container.textContent).toBe("locked");
});
test("return before deadline retains valid unlock", () => {
  unlock();
  const ui = render(<Screen route="cofre" />);
  ui.rerender(<Screen route="dashboard" />);
  advance(299999, false);
  ui.rerender(<Screen route="cofre" />);
  expect(ui.container.textContent).toBe("sensitive");
  expect(vault.getMasterKey()).toBe(key);
});
test("off-route activity extends inactivity but cannot revive expired key", () => {
  unlock();
  advance(240000, false);
  window.dispatchEvent(new Event("pointerdown"));
  advance(120000, false);
  expect(vault.getMasterKey()).toBe(key);
  advance(300001, false);
  window.dispatchEvent(new Event("keydown"));
  expect(vault.getMasterKey()).toBeNull();
});
test("background locks off-route after one minute", () => {
  unlock();
  visibility("hidden");
  advance(60000);
  expect(vault.getMasterKey()).toBeNull();
  expect(vault.getCachedSecret("entry")).toBeUndefined();
});
test("foreground validates hidden deadline even with suspended timers", () => {
  unlock();
  visibility("hidden");
  advance(60001, false);
  visibility("visible");
  expect(vault.getMasterKey()).toBeNull();
});
test("brief background preserves current policy", () => {
  unlock();
  visibility("hidden");
  advance(59000, false);
  visibility("visible");
  expect(vault.getMasterKey()).toBe(key);
});
test("logout clears key and cache and rejects pending unlock", () => {
  unlock();
  vault.setVaultSession(null);
  expect(vault.getMasterKey()).toBeNull();
  expect(vault.getCachedSecret("entry")).toBeUndefined();
  expect(() => vault.setMasterKey(key, "alice")).toThrow();
});
test("user switch cannot inherit key or a late decrypted secret", () => {
  unlock();
  vault.setVaultSession(session("bob"));
  expect(vault.getMasterKey()).toBeNull();
  expect(() => vault.setMasterKey(key, "alice")).toThrow();
  vault.setMasterKey(anotherKey, "bob");
  vault.setCachedSecret("entry", { password: "late-alice" }, key);
  expect(vault.getCachedSecret("entry")).toBeUndefined();
});
test("session expiration clears memory without an auth event", () => {
  vault.setVaultSession(session("alice", 30));
  vault.setMasterKey(key, "alice");
  vault.setCachedSecret("entry", { password: "synthetic" }, key);
  advance(30000);
  expect(vault.getMasterKey()).toBeNull();
  expect(vault.getCachedSecret("entry")).toBeUndefined();
});
test("session deadline is checked synchronously when timers are suspended", () => {
  vault.setVaultSession(session("alice", 30));
  vault.setMasterKey(key, "alice");
  advance(30001, false);
  expect(vault.getMasterKey()).toBeNull();
});
test("valid token refresh preserves key without resetting inactivity", () => {
  unlock();
  advance(240000, false);
  vault.setVaultSession(session());
  expect(vault.getMasterKey()).toBe(key);
  advance(60000);
  expect(vault.getMasterKey()).toBeNull();
});
test("already expired session cannot unlock", () => {
  vault.setVaultSession(session("alice", -1));
  expect(() => vault.setMasterKey(key, "alice")).toThrow();
});
