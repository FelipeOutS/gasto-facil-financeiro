import { expect, test } from "bun:test";
import { defaultDashboardLayout, normalizeDashboardLayout, moveDashboardBlock, readDashboardLayout, saveDashboardLayout, dashboardLayoutKey } from "../src/lib/dashboard-layout";

test("default keeps every existing block visible", () => {
  expect(defaultDashboardLayout().order).toHaveLength(6);
  expect(defaultDashboardLayout().hidden).toEqual([]);
});
test("invalid and future settings fall back safely", () => {
  for (const value of [null, {}, { version: 2 }, "broken"]) expect(normalizeDashboardLayout(value)).toEqual(defaultDashboardLayout());
  expect(readDashboardLayout({ getItem: () => "{broken" }, "a")).toEqual(defaultDashboardLayout());
});
test("normalization rejects unknown IDs and duplicates and adds missing blocks", () => {
  const layout = normalizeDashboardLayout({ version: 1, order: ["controle", "controle", "unknown"], hidden: ["radar", "radar", "unknown"] });
  expect(layout.order[0]).toBe("controle");
  expect(new Set(layout.order).size).toBe(6);
  expect(layout.hidden).toEqual(["radar"]);
});
test("reorder does not mutate original or escape boundaries", () => {
  const original = defaultDashboardLayout();
  expect(moveDashboardBlock(original, "radar", -1)).toBe(original);
  expect(moveDashboardBlock(original, "controle", 1)).toBe(original);
  expect(moveDashboardBlock(original, "radar", 1).order.slice(0, 2)).toEqual(["economia", "radar"]);
  expect(original.order[0]).toBe("radar");
});
test("preferences survive reread and remain isolated by account", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const layout = { ...moveDashboardBlock(defaultDashboardLayout(), "radar", 1), hidden: ["radar" as const] };
  saveDashboardLayout(storage, "account-a", layout);
  expect(readDashboardLayout(storage, "account-a")).toEqual(layout);
  expect(readDashboardLayout(storage, "account-b")).toEqual(defaultDashboardLayout());
  expect([...values.keys()]).toEqual([dashboardLayoutKey("account-a")]);
});
test("storage failures are reported on save and safe on read", () => {
  expect(() => saveDashboardLayout({ setItem: () => { throw new Error("quota"); } }, "a", defaultDashboardLayout())).toThrow("quota");
  expect(readDashboardLayout({ getItem: () => { throw new Error("denied"); } }, "a")).toEqual(defaultDashboardLayout());
  expect(() => saveDashboardLayout({ setItem: () => {} }, "", defaultDashboardLayout())).toThrow();
});
test("restore does not change other account settings or financial keys", () => {
  const values = new Map<string, string>([["financial", "untouched"], [dashboardLayoutKey("b"), "other"]]);
  saveDashboardLayout({ setItem: (key, value) => { values.set(key, value); } }, "a", defaultDashboardLayout());
  expect(values.get("financial")).toBe("untouched");
  expect(values.get(dashboardLayoutKey("b"))).toBe("other");
});
