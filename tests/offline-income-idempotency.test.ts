import { expect, test } from "bun:test";
import { INCOME_FIELDS, persistOfflineRows } from "../src/lib/offline/expense-idempotency";
const expected = [
  {
    user_id: "B",
    offline_client_id: "stable",
    descricao: "Income",
    valor: 20,
    data: "2026-09-21",
    tipo: "outros",
    recorrente: false,
    mes: 9,
    ano: 2026,
    cliente_id: null,
  },
];
const constraint = "receitas_user_offline_client_id_uniq";
for (const [name, code, message, after, ok] of [
  [
    "known idempotency constraint with exact record",
    "23505",
    `violates unique constraint "${constraint}"`,
    expected,
    true,
  ],
  [
    "known constraint without record",
    "23505",
    `violates unique constraint "${constraint}"`,
    [],
    false,
  ],
  [
    "known constraint with different operation",
    "23505",
    `violates unique constraint "${constraint}"`,
    [{ ...expected[0], tipo: "vendas" }],
    false,
  ],
  [
    "unrelated constraint even if another matching read is possible",
    "23505",
    'violates unique constraint "receitas_pkey"',
    expected,
    false,
  ],
  ["unidentified constraint remains pending", "23505", "unique conflict", expected, false],
] as const) {
  test(name, async () => {
    let reads = 0;
    const result = await persistOfflineRows(
      expected,
      async () => ({ rows: ++reads === 1 ? [] : [...after] }),
      async () => ({ error: message, code }),
      { fields: INCOME_FIELDS, constraint },
    );
    expect(result.ok).toBe(ok);
  });
}
