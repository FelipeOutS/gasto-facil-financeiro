import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const output = process.argv[2] || "test-results/landing-closing";
await fs.mkdir(output, { recursive: true });
const faqs = JSON.parse(await fs.readFile("src/i18n/locales/pt/landing.json", "utf8")).faq.items;
const b = await chromium.launch({ channel: "chrome" });
const results = [];
try {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    const p = await b.newPage({ viewport: { width, height } });
    const errors = [],
      mutations = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("**/*", (r) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(r.request().method())) {
        if (!r.request().url().endsWith("/api/public/csp-report"))
          mutations.push(r.request().url());
        return r.abort();
      }
      return r.continue();
    });
    await p.goto("http://127.0.0.1:3001/");
    await p.waitForTimeout(1300);
    const consent = p.getByRole("button", { name: "Recusar opcionais" });
    if (await consent.isVisible()) await consent.click();
    const sizes = {};
    for (const [name, selector] of [
      ["how", "#como-funciona"],
      ["faq", "#duvidas"],
      ["cta", "#comece-agora"],
    ]) {
      const el = p.locator(selector);
      await el.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const box = await el.boundingBox();
      sizes[name] = box.height;
      await el.screenshot({ path: path.join(output, `after-${name}-${width}.png`) });
    }
    const faq = p.locator("#duvidas");
    const visited = new Set();
    const heights = [];
    for (const title of ["Primeiros passos", "Suas finanças", "Acesso e uso", "MEI e empresa"]) {
      await faq.getByRole("tab", { name: title, exact: true }).click();
      await p.waitForTimeout(280);
      await expect(faq.getByRole("tabpanel")).toHaveCount(1);
      const items = faq.locator("[data-faq-item]");
      for (let n = 0; n < (await items.count()); n++) {
        const item = items.nth(n),
          index = Number(await item.getAttribute("data-faq-item"));
        visited.add(index);
        const button = item.getByRole("button");
        await expect(button).toHaveText(faqs[index].q);
        if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
        await expect(button).toHaveAttribute("aria-expanded", "true");
        await p.waitForTimeout(280);
        await expect(item.getByRole("region")).toHaveText(faqs[index].a);
        const measure = await faq
          .locator(".gi-faq-panel-viewport")
          .evaluate((el) => ({
            height: el.clientHeight,
            content: el.firstElementChild.getBoundingClientRect().height,
          }));
        expect(Math.abs(measure.height - measure.content)).toBeLessThan(2);
      }
      heights.push({ title, height: (await faq.boundingBox()).height });
    }
    expect([...visited].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    const last = faq.getByRole("tab", { name: "MEI e empresa", exact: true });
    await last.focus();
    await p.keyboard.press("Home");
    await expect(faq.getByRole("tab", { name: "Primeiros passos", exact: true })).toBeFocused();
    await p.keyboard.press("ArrowRight");
    await expect(faq.getByRole("tab", { name: "Suas finanças", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const q = faq.locator('[data-faq-item="2"] button');
    await q.focus();
    const prior = await q.getAttribute("aria-expanded");
    await p.keyboard.press("Enter");
    await expect(q).toHaveAttribute("aria-expanded", prior === "true" ? "false" : "true");
    await p.emulateMedia({ reducedMotion: "reduce" });
    await faq.getByRole("tab", { name: "Acesso e uso", exact: true }).click();
    await p.waitForTimeout(100);
    expect(
      await faq.evaluate(
        (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      ),
    ).toBe(0);
    await expect(faq.locator('a[href="mailto:contato@gastointeligente.com.br"]')).toHaveCount(1);
    await p.locator("#comece-agora").getByRole("link", { name: "Ver planos", exact: true }).click();
    await expect(p).toHaveURL(/#planos$/);
    await p.waitForTimeout(800);
    expect(
      await p.locator("#planos").evaluate((el) => el.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(0);
    await expect(p.locator("#como-funciona a")).toHaveAttribute("href", "/cadastro");
    await p
      .locator("#comece-agora")
      .getByRole("link", { name: "Criar minha conta", exact: true })
      .click();
    await expect(p).toHaveURL(/\/cadastro$/);
    expect(errors).toEqual([]);
    expect(mutations).toEqual([]);
    results.push({
      width,
      height,
      sizes,
      faqHeights: heights,
      questionsVerified: visited.size,
      keyboard: true,
      reducedMotion: true,
      registrationRoute: true,
      plansAnchor: true,
      errors,
    });
    await p.close();
    console.log(`PASS ${width}x${height}`);
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await b.close();
}
