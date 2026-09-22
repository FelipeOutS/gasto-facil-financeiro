import { expect, test } from "bun:test";
import {
  matchesOfflineRows,
  offlineRowKey,
  persistOfflineRows,
} from "../src/lib/offline/expense-idempotency";
const rows = [
  {
    user_id: "a",
    offline_client_id: "local",
    descricao: "Almoço",
    valor: 12.5,
    data: "2026-09-20",
  },
];
test("installments get distinct stable identifiers while first keeps compatibility", () => {
  expect([0, 1, 2].map((i) => offlineRowKey("local", i))).toEqual(["local", "local:1", "local:2"]);
});
test("replay confirms exact persisted expense without writing again", async () => {
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows }),
      async () => {
        throw Error("must not insert");
      },
    ),
  ).toEqual({ ok: true, duplicate: true });
});
test("unrelated unique error does not discard pending expense", async () => {
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows: [] }),
      async () => ({ error: "23505 unrelated constraint" }),
    ),
  ).toMatchObject({ ok: false });
});
test("lost response is confirmed by reading persisted data", async () => {
  let written = false;
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows: written ? rows : [] }),
      async () => {
        written = true;
        return { error: "timeout" };
      },
    ),
  ).toMatchObject({ ok: true, duplicate: true });
});
test("partial batch remains pending", () => {
  expect(matchesOfflineRows([...rows, { ...rows[0], offline_client_id: "local:1" }], rows)).toBe(
    false,
  );
});
test("different account, amount, category or description cannot acknowledge another expense", () => {
  for (const patch of [
    { user_id: "b" },
    { valor: 15 },
    { categoria_id: "other" },
    { descricao: "Outra" },
    { offline_client_id: "other" },
  ])
    expect(matchesOfflineRows(rows, [{ ...rows[0], ...patch }])).toBe(false);
});
test("conflicting persisted payload is not overwritten", async () => {
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows: [{ ...rows[0], valor: 99 }] }),
      async () => {
        throw Error("must not insert");
      },
    ),
  ).toMatchObject({ ok: false });
});
test("read failures preserve pending records", async () => {
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows: [], error: "offline" }),
      async () => {
        throw Error("must not insert");
      },
    ),
  ).toEqual({ ok: false, error: "offline" });
});
test("successful first insertion is acknowledged", async () => {
  expect(
    await persistOfflineRows(
      rows,
      async () => ({ rows: [] }),
      async () => ({}),
    ),
  ).toEqual({ ok: true });
});
