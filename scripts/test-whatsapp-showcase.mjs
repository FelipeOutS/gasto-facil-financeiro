import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const output = process.argv[2] || "test-results/whatsapp-showcase";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: false });
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [768, 1024],
    [1920, 1080],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      ...(width === 1440
        ? { recordVideo: { dir: path.join(output, "video"), size: { width, height } } }
        : {}),
    });
    const page = await context.newPage(),
      errors = [],
      mutations = [],
      cspReports = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", (route) => {
      const r = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(r.method())) {
        if (new URL(r.url()).pathname === "/api/public/csp-report") cspReports.push(r.url());
        else mutations.push(r.url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("http://127.0.0.1:3001/");
    await page.waitForTimeout(1500);
    const cookies = page.getByRole("button", { name: "Recusar opcionais" });
    if (await cookies.isVisible()) await cookies.click();
    const demo = page.locator(".gi-wa-showcase");
    await expect(demo).toHaveAttribute("data-running", "false");
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute("data-running", "true");
    await page.getByRole("button", { name: "Reiniciar demonstração" }).click();
    const phases = new Set(),
      heights = [],
      geometry = [];
    const initialCycle = Number(await demo.getAttribute("data-cycle"));
    const until = Date.now() + (width === 1440 ? 27800 : 8500);
    let captured = false;
    while (Date.now() < until) {
      const state = await demo.evaluate((el) => ({
        phase: el.dataset.phase,
        height: el.getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth,
        cycle: Number(el.dataset.cycle),
        messages: [...el.querySelectorAll(".gi-wa-message[data-visible=true]")].map((c) => ({
          top: c.offsetTop,
          bottom: c.offsetTop + c.clientHeight,
        })),
        chatHeight: el.querySelector(".gi-wa-conversation").clientHeight,
      }));
      phases.add(state.phase);
      heights.push(state.height);
      expect(state.overflow).toBe(false);
      for (let i = 0; i < state.messages.length; i++) {
        expect(state.messages[i].bottom).toBeLessThanOrEqual(state.chatHeight);
        if (i) expect(state.messages[i].top).toBeGreaterThanOrEqual(state.messages[i - 1].bottom);
      }
      if (state.phase === "complete" && !captured) {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(output, `after-${width}.png`) });
        await demo.screenshot({ path: path.join(output, `phone-${width}.png`) });
        geometry.push(state);
        captured = true;
      }
      await page.waitForTimeout(100);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    if (width === 1440) {
      expect([...phases].sort()).toEqual(
        [
          "intro",
          "typing",
          "sent",
          "processing",
          "review",
          "confirming",
          "complete",
          "reset",
        ].sort(),
      );
      expect(Number(await demo.getAttribute("data-cycle")) - initialCycle).toBeGreaterThanOrEqual(
        2,
      );
    }
    await page.getByRole("button", { name: "Pausar demonstração" }).click();
    await expect(demo).toHaveAttribute("data-running", "false");
    const pausedPhase = await demo.getAttribute("data-phase");
    await page.waitForTimeout(1000);
    expect(await demo.getAttribute("data-phase")).toBe(pausedPhase);
    await page.getByRole("button", { name: "Reiniciar demonstração" }).press("Enter");
    await expect(demo).toHaveAttribute("data-phase", "intro");
    await expect(demo).toHaveAttribute("data-running", "false");
    await page.getByRole("button", { name: "Reproduzir demonstração" }).press("Enter");
    await expect(demo).toHaveAttribute("data-running", "true");
    await expect(demo).toHaveAttribute("data-phase", "typing", { timeout: 3000 });
    await page.evaluate(() => scrollTo(0, 0));
    await expect(demo).toHaveAttribute("data-running", "false");
    const offPhase = await demo.getAttribute("data-phase");
    await page.waitForTimeout(500);
    expect(await demo.getAttribute("data-phase")).toBe(offPhase);
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute("data-running", "true");
    // Chromium under automation keeps both real tabs visible in this environment.
    // Exercise visibilitychange independently; record this as simulated, never real-tab proof.
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    const actualBackgroundState = await page.evaluate(() => document.visibilityState);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(demo).toHaveAttribute("data-running", "false");
    const hiddenPhase = await demo.getAttribute("data-phase");
    await page.waitForTimeout(700);
    expect(await demo.getAttribute("data-phase")).toBe(hiddenPhase);
    await page.bringToFront();
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(demo).toHaveAttribute("data-running", "true");
    await other.close();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(demo).toHaveAttribute("data-phase", "complete");
    await expect(demo).toHaveAttribute("data-running", "false");
    await expect(page.getByRole("button", { name: "Reiniciar demonstração" })).toBeDisabled();
    expect(await demo.locator(".gi-wa-phone").getAttribute("aria-hidden")).toBe("true");
    expect(await demo.locator("[aria-live]").count()).toBe(0);
    expect(await demo.locator("input,form,a").count()).toBe(0);
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
    results.push({
      width,
      height,
      phases: [...phases],
      stableHeight: heights[0],
      twoCycles: width === 1440,
      controls: true,
      viewportPause: true,
      visibilityEventSimulation: true,
      actualBackgroundState,
      reducedMotion: true,
      noMutations: true,
      blockedAmbientCspReports: cspReports.length,
      errors,
      geometry,
    });
    await context.close();
    console.log(`PASS ${width}x${height}`);
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
