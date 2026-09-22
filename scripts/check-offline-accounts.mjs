import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const source = readFileSync(process.argv[2]);
const executablePath = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html");
  res.end(
    req.url === "/fixture.js" ? source : '<!doctype html><script src="/fixture.js"></script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "gi-offline-p1-"));
let context;
let passed = 0;
const pass = (label) => {
  passed++;
  console.log("PASS: " + label);
};
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath });
  let page = await context.newPage();
  await page.goto(url);
  const ids = await page.evaluate(async () => {
    const expense = {
      descricao: "Expense",
      valor: 10,
      data: "2026-09-21",
      formaPagamento: "pix",
      categoriaId: "outros",
    };
    const income = {
      descricao: "Income",
      valor: 50,
      data: "2026-09-21",
      tipo: "outros",
      recorrente: false,
    };
    const items = [];
    for (const owner of ["actor", "owner-b"]) {
      items.push(await expenses.enqueueExpense(owner, expense, "actor"));
      items.push(await incomes.enqueueIncome(owner, income, "actor"));
    }
    return items.map((x) => x.local_id);
  });
  assert.equal(ids.length, 4);
  pass("offline own and connected expense/income persisted");
  await context.close();
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath });
  page = await context.newPage();
  await page.goto(url);
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("actor", "actor", true)).length),
    2,
  );
  pass("full browser shutdown/reopen retains both destinations");
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("owner-b", "another-actor")).length),
    0,
  );
  pass("another logged-in actor cannot list creator queue");
  const another = await context.newPage();
  await another.goto(url);
  await Promise.all(
    [page, another].map((p) =>
      p.evaluate(async () => {
        await Promise.all([
          syncAllForUser("actor"),
          syncAllForUser("actor"),
          syncAllIncomesForUser("actor"),
          syncAllIncomesForUser("actor"),
        ]);
      }),
    ),
  );
  const writes = (await Promise.all([page, another].map((p) => p.evaluate(() => writes)))).flat();
  assert.equal(writes.length, 4);
  assert.equal(new Set(writes.map((x) => x.id)).size, 4);
  assert.equal(writes.filter((x) => x.owner === "owner-b").length, 2);
  pass("simultaneous triggers across tabs send each item once to persisted owner after restart");
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("actor", "actor", true)).length),
    0,
  );
  pass("confirmed writes remove matching queue items");
  const stale = await page.evaluate(async () => {
    const item = await incomes.enqueueIncome(
      "owner-b",
      { descricao: "Abandoned", valor: 5, data: "2026-09-21", tipo: "outros" },
      "actor",
    );
    await incomes.claimForSync(item.local_id, item.user_id, "actor");
    return item.local_id;
  });
  assert.equal(
    await page.evaluate((id) => incomes.claimForSync(id, "owner-b", "actor"), stale),
    null,
  );
  pass("live syncing lease cannot be claimed twice");
  await page.evaluate(async (id) => {
    await new Promise((resolve, reject) => {
      const r = indexedDB.open("gf_offline_income", 1);
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction("incomes", "readwrite");
        const s = t.objectStore("incomes");
        const q = s.get(id);
        q.onsuccess = () => s.put({ ...q.result, updated_at: Date.now() - 180000 });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }, stale);
  await page.reload();
  const recovered = await page.evaluate(
    (id) => incomes.claimForSync(id, "owner-b", "actor"),
    stale,
  );
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.user_id, "owner-b");
  pass("abandoned syncing recovered with incremented attempt and unchanged owner");
  await page.evaluate((id) => incomes.deleteIncomeSilent(id, "owner-b", 1, "actor"), stale);
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("owner-b", "actor")).length),
    1,
  );
  pass("late completion from previous attempt cannot delete current claim");
  await page.evaluate(
    (id) =>
      incomes.updateIncome(
        id,
        { status: "failed", actor_id: "attacker", user_id: "actor", local_id: "changed" },
        "owner-b",
        2,
        "actor",
      ),
    stale,
  );
  const kept = await page.evaluate(async () => (await incomes.listIncomes("owner-b", "actor"))[0]);
  assert.equal(kept.local_id, stale);
  assert.equal(kept.actor_id, "actor");
  assert.equal(kept.user_id, "owner-b");
  pass("update cannot overwrite owner actor or stable id");
  await page.evaluate(() => {
    networkFailure = true;
  });
  await page.evaluate(() => syncAllIncomesForUser("actor"));
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("owner-b", "actor"))[0].status),
    "failed",
  );
  pass("network failure preserves retryable income");
  await page.evaluate(() => {
    networkFailure = false;
    deny = true;
  });
  await page.evaluate(() => syncAllIncomesForUser("actor"));
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("owner-b", "actor")).length),
    1,
  );
  pass("permission rejection retains queued operation");
  await page.evaluate(() => {
    deny = false;
  });
  await page.evaluate(() => syncAllIncomesForUser("actor"));
  assert.equal(
    await page.evaluate(async () => (await incomes.listIncomes("owner-b", "actor")).length),
    0,
  );
  pass("retry succeeds after failure without changing destination");
  console.log(`RESULT: ${passed} scenarios passed; isolated profile ${profile}`);
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
}
