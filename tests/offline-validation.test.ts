import { expect, test } from "bun:test";
import { isValidOfflineDate } from "@/lib/offline/offline-validation";
import { readOfflineSnapshot } from "@/lib/offline/offline-snapshot";

test("offline dates reject impossible calendar dates without throwing", () => {
  for (const value of [
    null,
    undefined,
    "",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "20/09/2026",
    "garbage",
  ]) {
    expect(isValidOfflineDate(value)).toBe(false);
  }
  expect(isValidOfflineDate("2024-02-29")).toBe(true);
  expect(isValidOfflineDate("2026-09-21")).toBe(true);
});

test("malformed local snapshots are ignored so offline unlock can continue", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let raw = "";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => raw },
  });
  const valid = {
    savedAt: 123,
    categories: [{ id: "outros", nome: "Outros" }],
    expenses: [{ id: "1", descricao: "Almoço", valor: 12.5, data: "2026-09-21" }],
  };
  try {
    for (const value of [
      null,
      {},
      { ...valid, categories: null },
      { ...valid, expenses: [null] },
      { ...valid, expenses: [{ ...valid.expenses[0], data: "2026-02-30" }] },
      { ...valid, savedAt: "yesterday" },
    ]) {
      raw = JSON.stringify(value);
      expect(readOfflineSnapshot("a")).toBeNull();
    }
    raw = "invalid json";
    expect(readOfflineSnapshot("a")).toBeNull();
    raw = JSON.stringify(valid);
    expect(readOfflineSnapshot("a")).toEqual(valid);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
