import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const out = process.argv[2];
if (!out) throw Error("Provide evidence directory");
await mkdir("public/images/landing/mobile", { recursive: true });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const manifest = [];
try {
  for (const [name, route] of [
    ["dashboard", "app"],
    ["metas", "metas"],
    ["investimentos", "investimentos"],
    ["guardado", "guardado"],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    await page.clock.setFixedTime(new Date("2026-10-28T15:00:00Z"));
    await page.route("**/*", (r) => {
      const u = new URL(r.request().url());
      return u.hostname === "127.0.0.1" ||
        (r.request().resourceType() === "image" && u.hostname === "images.unsplash.com") ||
        u.hostname.startsWith("fonts.")
        ? r.continue()
        : r.abort();
    });
    await page.goto("http://127.0.0.1:3012/" + route);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1800);

    await page.waitForTimeout(500);
    const body = await page.locator("body").innerText();
    if (/Something went wrong|tipo\.undefined|tipo\.reserva_emergencia/.test(body))
      throw Error("Invalid rendered route " + name);
    const file = `gasto-inteligente-mobile-${name}`;
    await page.screenshot({ path: out + "/" + file + ".png" });
    await sharp(out + "/" + file + ".png")
      .webp({ quality: 93, effort: 6 })
      .toFile("public/images/landing/mobile/" + file + ".webp");
    manifest.push({
      file: file + ".webp",
      route: "/" + route,
      platform: "responsive web — actual route component in isolated fixture",
      viewport: "390x844 @2x",
      date: "2026-10-28",
      synthetic: true,
      sourceFile: `src/routes/${route === "metas" || route === "investimentos" ? route + ".index" : route}.tsx`,
      sourceSha256: createHash("sha256")
        .update(
          await readFile(
            `src/routes/${route === "metas" || route === "investimentos" ? route + ".index" : route}.tsx`,
          ),
        )
        .digest("hex"),
      scrollY: await page.evaluate(() => scrollY),
      sha256: createHash("sha256")
        .update(await readFile("public/images/landing/mobile/" + file + ".webp"))
        .digest("hex"),
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(out + "/manifest.json", JSON.stringify(manifest, null, 2));
console.log(manifest);
