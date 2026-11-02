import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const phase = process.argv[2] || "after";
const output = process.argv[3] || "test-results/landing-cta";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
try {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:3001/");
    await page.waitForTimeout(1000);
    const reject = page.getByRole("button", { name: "Recusar opcionais" });
    if (await reject.isVisible()) await reject.click();
    await page.evaluate(() => {
      const e = document.querySelector("#comece-agora");
      window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 170);
    });
    await page.waitForTimeout(400);
    const cta = page.locator("#comece-agora");
    await cta.screenshot({ path: path.join(output, `${phase}-cta-${width}.png`) });
    await page.screenshot({ path: path.join(output, `${phase}-context-${width}.png`) });
    const box = await cta.boundingBox();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (phase === "after") {
      await expect(cta.getByRole("heading", { level: 2 })).toHaveText(
        "Veja para onde seu dinheiro vai.",
      );
      await expect(cta.locator("img")).toHaveCount(0);
      const primary = cta.getByRole("link", { name: "Criar minha conta", exact: true });
      const plans = cta.getByRole("link", { name: "Ver planos", exact: true });
      await expect(primary).toHaveAttribute("href", "/cadastro");
      await expect(plans).toHaveAttribute("href", "#planos");
      for (const link of [primary, plans]) {
        expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await link.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(link).toBeFocused();
        expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await cta.evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
        ),
      ).toBe(0);
      await plans.click();
      await expect(page).toHaveURL(/#planos$/);
      expect(
        await page.locator("#planos").evaluate((el) => el.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(0);
      await primary.click();
      await expect(page).toHaveURL(/\/cadastro$/);
      expect(errors).toEqual([]);
    }
    results.push({ width, height, sectionHeight: box.height, errors });
    await page.close();
    console.log(`PASS ${phase} ${width}x${height}`);
  }
  await fs.writeFile(path.join(output, `${phase}-results.json`), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
