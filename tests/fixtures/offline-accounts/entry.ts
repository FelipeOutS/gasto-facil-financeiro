import * as expenses from "../../../src/lib/offline/offline-expense-queue";
import * as incomes from "../../../src/lib/offline/offline-income-queue";
import { syncAllForUser } from "../../../src/lib/offline/use-offline-sync";
import { syncAllIncomesForUser } from "../../../src/lib/offline/use-offline-income-sync";
Object.assign(window, {
  expenses,
  queue: expenses,
  incomes,
  syncAllForUser,
  syncAllIncomesForUser,
  writes: [],
  deny: false,
  networkFailure: false,
});
