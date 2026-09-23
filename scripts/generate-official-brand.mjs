// Raster derivatives only. The supplied official SVG bytes are never modified.
import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const android = process.argv[2];
if (!android) throw new Error("Pass the Android project directory");
const source = "public/logos/brand/icone-gasto-inteligente-dark.svg";
const background = "#0B0F14";
async function icon(size, ratio, bg = background) {
  const glyph = await sharp(source, { density: 1200 })
    .resize(Math.round(size * ratio), Math.round(size * ratio), { fit: "inside" })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toBuffer();
}
for (const size of [192, 512]) {
  await writeFile(`public/pwa-${size}.png`, await icon(size, 0.7));
  await writeFile(`public/maskable-${size}.png`, await icon(size, 0.6));
}
await writeFile("public/apple-touch-icon.png", await icon(180, 0.68));
for (const size of [16, 32]) {
  await sharp("public/logos/brand/favicon-light-32.svg", { density: 1200 })
    .resize(size, size)
    .png()
    .toFile(`public/favicon-${size}x${size}.png`);
}
await sharp(source, { density: 1200 })
  .resize(256, 256, { fit: "inside" })
  .png()
  .toFile("public/logos/brand/icone-gasto-inteligente-export.png");
const res = path.join(android, "app/src/main/res");
// Exact SVG paths, transformed into Android's 288dp splash canvas.
// A fixed 80dp drawing avoids the platform enlarging an 80dp bitmap to its icon box.
const svgText = await readFile(source, "utf8");
const fills = Object.fromEntries([...svgText.matchAll(/\.(st\d+)\s*\{\s*fill:\s*([^;]+);/g)].map(m => [m[1], m[2]]));
const paths = [...svgText.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)].map(m => `    <path android:fillColor="${fills[m[1]] === "#fff" ? "#FFFFFF" : fills[m[1]]}" android:pathData="${m[2]}" />`).join("\n");
if (!paths) throw new Error("Official SVG paths missing");
await writeFile(path.join(res, "drawable/splash_logo.xml"), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="288dp" android:height="288dp" android:viewportWidth="288" android:viewportHeight="288">\n  <group android:scaleX="2.6666667" android:scaleY="2.6666667" android:translateX="105.9467" android:translateY="104">\n${paths}\n  </group>\n</vector>\n`);
for (const [density, scale] of Object.entries({
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
})) {
  const dir = path.join(res, `mipmap-${density}`);
  await mkdir(dir, { recursive: true });
  const foreground = await icon(108 * scale, 60 / 108, { r: 0, g: 0, b: 0, alpha: 0 });
  await sharp(foreground)
    .webp({ lossless: true })
    .toFile(path.join(dir, "ic_launcher_foreground.webp"));
  const legacy = await icon(48 * scale, 0.62);
  await sharp(legacy).webp({ lossless: true }).toFile(path.join(dir, "ic_launcher.webp"));
  const mask = Buffer.from(
    `<svg width="${48 * scale}" height="${48 * scale}"><circle cx="${24 * scale}" cy="${24 * scale}" r="${24 * scale}" fill="white"/></svg>`,
  );
  await sharp(legacy)
    .composite([{ input: mask, blend: "dest-in" }])
    .webp({ lossless: true })
    .toFile(path.join(dir, "ic_launcher_round.webp"));
}
const drawable = path.join(res, "drawable-nodpi");
await mkdir(drawable, { recursive: true });
await writeFile(
  path.join(drawable, "brand_symbol.png"),
  await icon(384, 1, { r: 0, g: 0, b: 0, alpha: 0 }),
);
const fg = await icon(432, 60 / 108, { r: 0, g: 0, b: 0, alpha: 0 });
const alpha = await sharp(fg).extractChannel(3).raw().toBuffer();
await sharp({ create: { width: 432, height: 432, channels: 3, background: "white" } })
  .joinChannel(alpha, { raw: { width: 432, height: 432, channels: 1 } })
  .png()
  .toFile(path.join(drawable, "ic_launcher_monochrome.png"));
// Review masks at a useful size, never included in app assets.
await mkdir("artifacts/brand-mobile", { recursive: true });
const review = await icon(432, 60 / 108);
for (const [name, shape] of [
  ["circle", '<circle cx="216" cy="216" r="216" fill="white"/>'],
  ["rounded", '<rect width="432" height="432" rx="96" fill="white"/>'],
]) {
  await sharp(review)
    .composite([
      { input: Buffer.from(`<svg width="432" height="432">${shape}</svg>`), blend: "dest-in" },
    ])
    .png()
    .toFile(`artifacts/brand-mobile/launcher-${name}.png`);
}
