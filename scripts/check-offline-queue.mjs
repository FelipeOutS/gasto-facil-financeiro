import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
const source = readFileSync(process.argv[2]);
const executablePath = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/queue.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/queue.js" ? source : '<!doctype html><script src="/queue.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const id = await page.evaluate(async () => {
    const input = {
      descricao: "Almoço",
      valor: 12.5,
      data: "2026-09-20",
      categoriaId: "outros",
      formaPagamento: "pix",
    };
    const a = await window.queue.enqueueExpense("account-a", input);
    await window.queue.enqueueExpense("account-b", { ...input, descricao: "Outra conta" });
    return a.local_id;
  });
  await page.reload();
  assert.deepEqual(
    await page.evaluate(async () =>
      (await window.queue.listExpenses("account-a")).map((x) => x.descricao),
    ),
    ["Almoço"],
  );
  console.log("PASS: persistence after reload and account isolation");
  assert.equal(await page.evaluate((id) => window.queue.claimForSync(id, "account-b"), id), null);
  await page.evaluate(async (id) => {
    const old = (await window.queue.listExpenses("account-a"))[0];
    await window.queue.updateExpense(
      id,
      { input: { ...old.input, descricao: "Atualizado" }, descricao: "Atualizado" },
      "account-a",
    );
  }, id);
  const other = await context.newPage();
  await other.goto(page.url());
  const claims = await Promise.all(
    [page, other].map((p) => p.evaluate((id) => window.queue.claimForSync(id, "account-a"), id)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).input.descricao, "Atualizado");
  console.log("PASS: claim returns the latest persisted input");
  console.log("PASS: atomic claim across two tabs and wrong-account rejection");
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await window.queue.updateExpense(id, { input: { valor: 99 } }, "account-a");
        return false;
      } catch {
        return true;
      }
    }, id),
    true,
  );
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await window.queue.removeExpense(id, "account-a");
        return false;
      } catch {
        return true;
      }
    }, id),
    true,
  );
  assert.equal((await page.evaluate(() => window.queue.listExpenses("account-a")))[0].valor, 12.5);
  console.log("PASS: ambiguous in-flight expense cannot be edited or removed");
  await page.evaluate(async (id) => {
    await window.queue.updateExpense(
      id,
      { status: "pending", user_id: "account-b", local_id: "changed" },
      "account-a",
    );
  }, id);
  assert.equal((await page.evaluate(() => window.queue.listExpenses("account-a")))[0].local_id, id);
  assert.equal((await page.evaluate(() => window.queue.listExpenses("account-b"))).length, 1);
  console.log("PASS: identity is immutable");
  await page.evaluate(async (id) => {
    await window.queue.claimForSync(id, "account-a");
    await new Promise((resolve, reject) => {
      const r = indexedDB.open("gf_offline", 1);
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction("expenses", "readwrite");
        const s = t.objectStore("expenses");
        const g = s.get(id);
        g.onsuccess = () => s.put({ ...g.result, updated_at: Date.now() - 180000 });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }, id);
  await page.reload();
  assert.equal(
    (await page.evaluate((id) => window.queue.claimForSync(id, "account-a"), id)).attempts,
    3,
  );
  console.log("PASS: expired claim recovered after restart");
  const current = (await page.evaluate(() => window.queue.listExpenses("account-a")))[0];
  await page.evaluate(
    async ({ id, attempt }) => {
      await window.queue.updateExpense(id, { status: "failed" }, "account-a", attempt - 1);
      await window.queue.deleteExpenseSilent(id, "account-a", attempt - 1);
      await window.queue.deleteExpenseSilent(id, "account-b", attempt);
    },
    { id, attempt: current.attempts },
  );
  assert.equal(
    (await page.evaluate(() => window.queue.listExpenses("account-a")))[0].status,
    "syncing",
  );
  console.log("PASS: stale completions and other accounts cannot overwrite or delete current work");
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await window.queue.updateExpense(id, { status: "failed" }, "account-b");
        return false;
      } catch {
        return true;
      }
    }, id),
    true,
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.queue.enqueueExpense("account-a", { valor: 1, data: "2026-02-30" });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  console.log("PASS: invalid dates and wrong-account updates rejected");
  await page.evaluate(
    ({ id, attempt }) => window.queue.deleteExpenseSilent(id, "account-a", attempt),
    { id, attempt: current.attempts },
  );
  assert.equal((await page.evaluate(() => window.queue.listExpenses("account-a"))).length, 0);
  console.log("PASS: current successful attempt can remove its own queued expense");
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
