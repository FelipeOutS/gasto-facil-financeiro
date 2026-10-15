import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
const output = process.argv[2];
if (!output) throw new Error("Pass a test-only output directory (never public/ or main/assets).");
const result = await Bun.build({
  entrypoints: ["tests/fixtures/mobile-navigation/entry.tsx"],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      name: "isolated-navigation",
      setup(build) {
        build.onResolve(
          { filter: /^(@\/lib\/(contas-alertas|product-analytics)|react-i18next)$/ },
          () => ({ path: resolve("tests/fixtures/mobile-navigation/mocks.ts") }),
        );
      },
    },
  ],
});
if (!result.success) throw new Error(String(result.logs));
const compiled = await compile(await readFile("src/styles.css", "utf8"), {
  base: resolve("src"),
  onDependency: () => {},
});
const classSources = await Promise.all([
  "src/components/BottomNav.tsx",
  "src/components/MobileQuickActionsSheet.tsx",
  "src/components/ui/sheet.tsx",
].map(path => readFile(path, "utf8")));
const candidates = classSources.flatMap(source =>
  [...source.matchAll(/"([^"\n]+)"/g)].flatMap(match => match[1].split(/\s+/)),
);
const css = compiled.build([...candidates, "lg:hidden", "sr-only", "bg-destructive", "bg-warning"]);
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "navigation.html"),
  `<!doctype html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body style="font-family:var(--font-sans)"><div id="root"></div><script>${(await result.outputs[0].text()).replaceAll("</script>", "<\\/script>")}</script></body></html>`,
);
console.log("Built isolated navigation fixture:", resolve(output, "navigation.html"));
