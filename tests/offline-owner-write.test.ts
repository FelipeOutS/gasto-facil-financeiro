import { beforeEach, expect, mock, test } from "bun:test";
type Row = Record<string, any>;
let actor = "actor",
  allowed = true,
  fail: any = null,
  loseResponse = false;
let database: Record<string, Row[]> = {},
  inserts = 0;
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: (_name: string, args: any) => ({
      abortSignal: async () => ({
        data: allowed && ["actor", "owner-b"].includes(args._owner),
        error: null,
      }),
    }),
    from: (table: string) => {
      let operation = "select",
        payload: Row[] = [],
        filters: ((r: Row) => boolean)[] = [];
      const query: any = {
        select: () => query,
        abortSignal: () => query,
        order: () => query,
        limit: () => query,
        eq: (k: string, v: any) => {
          filters.push((r) => r[k] === v);
          return query;
        },
        in: (k: string, v: any[]) => {
          filters.push((r) => v.includes(r[k]));
          return query;
        },
        is: () => query,
        not: () => query,
        insert: (rows: Row | Row[]) => {
          operation = "insert";
          payload = Array.isArray(rows) ? rows : [rows];
          return query;
        },
        then: (ok: any, bad: any) =>
          Promise.resolve()
            .then(() => {
              if (operation === "select")
                return {
                  data: (database[table] ?? []).filter((r) => filters.every((fn) => fn(r))),
                  error: null,
                };
              if (fail) return { error: fail };
              if (table === "gastos" || table === "receitas") inserts++;
              database[table] ??= [];
              database[table].push(...payload);
              return {
                data: payload,
                error: loseResponse ? { message: "network response lost", code: "network" } : null,
              };
            })
            .then(ok, bad),
      };
      return query;
    },
  },
}));
const store = await import("../src/lib/store");
const income = {
  descricao: "Serviço",
  valor: 100,
  data: "2026-09-21",
  tipo: "outros" as const,
  recorrente: false,
};
const expense = {
  descricao: "Compra",
  valor: 20,
  data: "2026-09-21",
  categoriaId: "outros",
  formaPagamento: "pix" as const,
};
beforeEach(() => {
  actor = "actor";
  allowed = true;
  fail = null;
  loseResponse = false;
  inserts = 0;
  database = {
    categorias: [
      { id: "category-b", user_id: "owner-b", legacy_id: "outros" },
      { id: "category-a", user_id: "actor", legacy_id: "outros" },
    ],
  };
  store.setActiveUserId(null);
});
for (const owner of ["actor", "owner-b"]) {
  test(`online income writes explicitly to authorized ${owner}`, async () => {
    expect((await store.addReceitaAwait(income, owner, undefined, "actor")).ok).toBe(true);
    expect(database.receitas[0].user_id).toBe(owner);
  });
  test(`online expense writes explicitly to authorized ${owner} without active hydration`, async () => {
    expect((await store.addGastoAwait(expense, owner, undefined, "actor")).ok).toBe(true);
    expect(database.gastos[0].user_id).toBe(owner);
    expect(database.gastos[0].categoria_id).toBe(owner === "actor" ? "category-a" : "category-b");
  });
}
test("connected income retries ten times with one persisted record and original owner", async () => {
  store.setActiveUserId("actor");
  for (let i = 0; i < 10; i++)
    expect((await store.addReceitaAwait(income, "owner-b", "stable-income", "actor")).ok).toBe(
      true,
    );
  expect(inserts).toBe(1);
  expect(database.receitas[0].user_id).toBe("owner-b");
  expect(store.getReceitas()).toEqual([]);
});
test("connected expense retries while another account is active with original category", async () => {
  store.setActiveUserId("actor");
  for (let i = 0; i < 3; i++)
    expect((await store.addGastoAwait(expense, "owner-b", "stable-expense", "actor")).ok).toBe(
      true,
    );
  expect(inserts).toBe(1);
  expect(database.gastos[0].categoria_id).toBe("category-b");
});
test("lost response is confirmed against exact income before acknowledging", async () => {
  loseResponse = true;
  expect(await store.addReceitaAwait(income, "owner-b", "lost", "actor")).toEqual({
    ok: true,
    duplicate: true,
  });
  expect(inserts).toBe(1);
});
test("network failure with no persisted row remains retryable", async () => {
  fail = { message: "network error" };
  expect((await store.addReceitaAwait(income, "owner-b", "retry", "actor")).ok).toBe(false);
  fail = null;
  expect((await store.addReceitaAwait(income, "owner-b", "retry", "actor")).ok).toBe(true);
  expect(inserts).toBe(1);
});
test("unrelated 23505 and textual unique are never acknowledged", async () => {
  for (const error of [
    { code: "23505", message: 'violates unique constraint "other_constraint"' },
    { message: "unique failure" },
  ]) {
    fail = error;
    expect((await store.addReceitaAwait(income, "owner-b", "conflict", "actor")).ok).toBe(false);
  }
});
test("same id with different operation remains pending", async () => {
  await store.addReceitaAwait(income, "owner-b", "stable", "actor");
  expect(
    (await store.addReceitaAwait({ ...income, valor: 99 }, "owner-b", "stable", "actor")).ok,
  ).toBe(false);
  expect(inserts).toBe(1);
});
test("revoked permission prevents income and expense insertion", async () => {
  allowed = false;
  expect((await store.addReceitaAwait(income, "owner-b", "i", "actor")).ok).toBe(false);
  expect((await store.addGastoAwait(expense, "owner-b", "e", "actor")).ok).toBe(false);
  expect(inserts).toBe(0);
});
test("another authenticated actor cannot send the previous actor's queue", async () => {
  actor = "other";
  expect((await store.addReceitaAwait(income, "owner-b", "i", "actor")).ok).toBe(false);
  expect(inserts).toBe(0);
});
test("cross-owner client reference is rejected", async () => {
  database.clientes = [{ id: "client-a", user_id: "actor" }];
  expect(
    (await store.addReceitaAwait({ ...income, clienteId: "client-a" }, "owner-b", "i", "actor")).ok,
  ).toBe(false);
  expect(inserts).toBe(0);
});
test("refresh of same authenticated actor preserves selected owner data", async () => {
  store.setAuthenticatedUserId("actor");
  store.setActiveUserId("owner-b");
  await store.addReceitaAwait(income, "owner-b", "i", "actor");
  expect(store.getReceitas()).toHaveLength(1);
  store.setAuthenticatedUserId("actor");
  expect(store.getReceitas()).toHaveLength(1);
  store.setAuthenticatedUserId("other");
  expect(store.getReceitas()).toHaveLength(0);
});

test("online form income keeps explicit owner even with another active account", async () => {
  store.setStoreCanWriteBasic(true);
  store.setActiveUserId("actor");
  await store.addReceita(income, "owner-b", "actor");
  expect(database.receitas[0].user_id).toBe("owner-b");
  expect(store.getReceitas()).toEqual([]);
  store.setStoreCanWriteBasic(false);
});
test("online form income cannot bypass connected-account permission", async () => {
  store.setStoreCanWriteBasic(true);
  allowed = false;
  await expect(store.addReceita(income, "owner-b", "actor")).rejects.toThrow("Sem permissão");
  expect(inserts).toBe(0);
  store.setStoreCanWriteBasic(false);
});
test("confirmed replay also restores the current owner's income cache", async () => {
  await store.addReceitaAwait(income, "owner-b", "confirmed", "actor");
  store.setActiveUserId("owner-b");
  expect(store.getReceitas()).toHaveLength(0);
  expect((await store.addReceitaAwait(income, "owner-b", "confirmed", "actor")).duplicate).toBe(
    true,
  );
  expect(store.getReceitas()).toHaveLength(1);
  expect(inserts).toBe(1);
});
