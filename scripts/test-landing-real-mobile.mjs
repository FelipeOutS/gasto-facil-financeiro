import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const dir = process.argv[2];
if (!dir) throw Error("Provide evidence directory");
await mkdir(dir, { recursive: true });
const b = await chromium.launch({ channel: "chrome" });
const results = [];
try {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    const context = await b.newContext({
      viewport: { width, height },
      recordVideo: width === 1440 ? { dir: dir + "/video", size: { width, height } } : undefined,
    });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://127.0.0.1:3001/");
    await p.waitForTimeout(1200);
    const consent = p.getByRole("button", { name: "Recusar opcionais", exact: true });
    if (await consent.isVisible()) await consent.click();
    const section = p.locator("#demonstracoes"),
      tabs = section.getByRole("tab"),
      img = section.locator("img");
    await section.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await img.evaluate((e) => e.decode());
    const heights = [],
      sources = [];
    for (let i = 0; i < 4; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
      await expect(section.locator(".gi-real-copy.is-active")).toHaveAttribute(
        "id",
        `real-mobile-panel-${i}`,
      );
      await p.waitForTimeout(350);
      assert(await img.evaluate((e) => e.complete && e.naturalWidth === 780));
      assert.equal(await section.getByRole("tabpanel").count(), 1);
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      heights.push(await section.evaluate((e) => e.offsetHeight));
      sources.push(await img.getAttribute("src"));
      await section.screenshot({ path: `${dir}/after-${width}-${i}.png` });
    }
    assert.equal(new Set(sources).size, 4);
    assert(Math.max(...heights) - Math.min(...heights) < 2);
    await tabs.first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    const startY = await p.evaluate(() => scrollY);
    for (const i of [0, 2, 1, 3, 0, 3]) await tabs.nth(i).click({ force: true });
    await expect(section.locator(".gi-real-copy.is-active")).toHaveAttribute(
      "id",
      "real-mobile-panel-3",
    );
    await p.waitForTimeout(350);
    assert(Math.abs((await p.evaluate(() => scrollY)) - startY) < 3);
    await tabs.last().focus();
    await p.keyboard.press("Home");
    await expect(section.locator(".gi-real-copy.is-active")).toHaveAttribute(
      "id",
      "real-mobile-panel-0",
    );
    await expect(tabs.first()).toBeFocused();
    await p.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await p.keyboard.press("ArrowRight");
    await expect(tabs.first()).toBeFocused();
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.waitForTimeout(150);
    await tabs.nth(2).click();
    await expect(section.locator(".gi-real-copy.is-active")).toHaveAttribute(
      "id",
      "real-mobile-panel-2",
    );
    assert.equal(
      await section.locator(".gi-real-stage").evaluate((e) => e.getAnimations().length),
      0,
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      sectionHeight: heights[0],
      distinctScreens: sources.length,
      errors,
    });
    await context.close();
  }
} finally {
  await b.close();
}
await writeFile(dir + "/tests.json", JSON.stringify(results, null, 2));
console.log(results);
