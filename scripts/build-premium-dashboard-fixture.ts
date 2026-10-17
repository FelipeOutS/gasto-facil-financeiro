import { readFile, mkdir, writeFile, readdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { compile } from "@tailwindcss/node";
const output = process.argv[2];
if (!output) throw Error("Provide a temporary output directory");
const result = await Bun.build({
  entrypoints: ["tests/fixtures/premium-dashboard/entry.tsx"],
  target: "browser",
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env": JSON.stringify({ DEV: false, PROD: true }),
  },
  plugins: [
    {
      name: "isolated-premium",
      setup(build) {
        build.onResolve({ filter: /^\/public\/.*\?url$/ }, (args) => ({
          path: args.path,
          namespace: "fixture-asset",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture-asset" }, (args) => ({
          contents: `export default ${JSON.stringify(args.path.replace("/public", "").replace("?url", ""))}`,
          loader: "js",
        }));
        build.onResolve(
          {
            filter:
              /^(@\/lib\/(auth-context|use-plan|subscription-guard|contas-alertas|product-analytics|store)|@\/components\/(ConnectedAccountSwitcher|AuthGate|ExpiredAccessBanner|MobileNotificationsFab)|\.\/(ConnectedAccountSwitcher|AuthGate|ExpiredAccessBanner|MobileNotificationsFab))$/,
          },
          () => ({ path: resolve("tests/fixtures/premium-dashboard/mocks.tsx") }),
        );
      },
    },
  ],
});
if (!result.success) throw Error(String(result.logs));
const compiled = await compile(await readFile("src/styles.css", "utf8"), {
  base: resolve("src"),
  onDependency: () => {},
});
async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? sources(join(dir, e.name))
          : /\.(tsx|ts)$/.test(e.name)
            ? readFile(join(dir, e.name), "utf8").then((s) => [s])
            : Promise.resolve([]),
      ),
    )
  ).flat();
}
const texts = [
  ...(await sources("src/components")),
  ...(await sources("tests/fixtures/premium-dashboard")),
];
const candidates = texts.flatMap((s) =>
  [...s.matchAll(/"([^"\n]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
);
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "app.js"),
  await result.outputs.find((o) => o.path.endsWith(".js"))!.text(),
);
await writeFile(
  resolve(output, "style.css"),
  compiled.build(candidates) + "\n" + (await readFile("src/premium.css", "utf8")),
);
await writeFile(
  resolve(output, "index.html"),
  '<!doctype html><html class="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Prévia isolada — Gasto Inteligente</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
console.log(output);
