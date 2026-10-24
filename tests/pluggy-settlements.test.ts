import { test, expect } from "bun:test";
import {
  confirmedBillPayment,
  PLUGGY_SETTLEMENTS_AUTHORIZED,
  PLUGGY_BILL_SNAPSHOTS_ENABLED,
  type BankBill,
} from "../src/lib/pluggy/settlements";
import { PLUGGY_CONTINUOUS_AUTHORIZED } from "../src/lib/pluggy/continuous-policy";
const previous: BankBill = {
  id: "old",
  dueDate: "2026-08-05",
  totalAmount: 10,
  totalAmountCurrencyCode: "BRL",
  payments: [],
  financeCharges: [],
};
const next: BankBill = {
  ...previous,
  id: "next",
  dueDate: "2026-09-05",
  totalAmount: 30,
  payments: [{ id: "p1", amount: 10, currencyCode: "BRL", paymentDate: "2026-08-05" }],
};
test("all new financial and snapshot gates remain off", () => {
  expect([
    PLUGGY_CONTINUOUS_AUTHORIZED,
    PLUGGY_SETTLEMENTS_AUTHORIZED,
    PLUGGY_BILL_SNAPSHOTS_ENABLED,
  ]).toEqual([false, false, false]);
});
test("next-cycle payment settles previous bill, not its own total", () => {
  expect(confirmedBillPayment(previous, next, "2026-09-06")).toEqual({
    amount: 10,
    date: "2026-08-05",
  });
});
test("partial payments can sum exactly to full principal", () => {
  expect(
    confirmedBillPayment(
      previous,
      {
        ...next,
        payments: [
          { ...next.payments[0], amount: 3 },
          { ...next.payments[0], id: "p2", amount: 7, paymentDate: "2026-08-06" },
        ],
      },
      "2026-09-06",
    ),
  ).toEqual({ amount: 10, date: "2026-08-06" });
});
for (const [name, changed] of Object.entries({
  fees: { financeCharges: [{ id: "fee", amount: 1, currencyCode: "BRL" }] },
  duplicate: { payments: [...next.payments, ...next.payments] },
  missing: { payments: [] },
  partial: { payments: [{ ...next.payments[0], amount: 9 }] },
  foreign: { payments: [{ ...next.payments[0], currencyCode: "USD" }] },
  future: { payments: [{ ...next.payments[0], paymentDate: "2026-10-01" }] },
  old: { payments: [{ ...next.payments[0], paymentDate: "2026-07-01" }] },
  fraction: { payments: [{ ...next.payments[0], amount: 10.001 }] },
  skippedCycle: { dueDate: "2026-10-05" },
  invalidDay: { dueDate: "2026-09-31" },
}))
  test("bill ambiguity rejected: " + name, () => {
    expect(confirmedBillPayment(previous, { ...next, ...changed }, "2026-09-06")).toBeNull();
  });
test("invalid closing date cannot authorize payment", () => {
  expect(
    confirmedBillPayment({ ...previous, billClosingDate: "bad" }, next, "2026-09-06"),
  ).toBeNull();
});
