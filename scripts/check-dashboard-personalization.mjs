import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const directory = process.argv[2];
const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(readFileSync(join(directory, "index.html"))); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const width of [375, 430, 768, 1024, 1366, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.route("**/*", r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const s = document.documentElement.style;
      s.setProperty("--android-safe-top", "48px");
      s.setProperty("--android-safe-bottom", "24px");
      s.setProperty("--android-safe-left", "32px");
      s.setProperty("--android-safe-right", "24px");
    }));
    await page.goto(origin);
    await page.getByRole("button", { name: "Personalizar Dashboard" }).click();
    await page.getByRole("dialog").waitFor();
    const panel = await page.getByRole("dialog").boundingBox();
    assert.ok(panel && panel.y >= 48, "Panel must remain below system status bar");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Descer Fluxo de caixa e resumo" }).click();
    await page.getByRole("checkbox", { name: "Fluxo de caixa e resumo" }).uncheck();
    if (width === 375 || width === 1440) await page.screenshot({ path: join(directory, `dashboard-customize-${width}.png`) });
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    assert.equal(await page.locator('[data-dashboard-block="radar"]').count(), 0);
    await page.reload();
    await page.getByRole("button", { name: "Personalizar Dashboard" }).click();
    assert.equal(await page.getByRole("checkbox", { name: "Fluxo de caixa e resumo" }).isChecked(), false);
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    assert.equal(await page.locator("[data-dashboard-block]").count(), 6);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.getByRole("button", { name: "Personalizar Dashboard" }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    console.log(`PASS ${width}px: reorder, hide, persistence, restore, light/dark and dismissal`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
