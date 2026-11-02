import { readFile, mkdir, writeFile, readdir, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { compile } from "@tailwindcss/node";
const output = process.argv[2];
if (!output) throw Error("Provide isolated output directory");
const adapter = resolve("tests/fixtures/landing-real-mobile/adapters.tsx");
const exportsOf = (s: string) =>
  [...s.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
const result = await Bun.build({
  entrypoints: ["tests/fixtures/landing-real-mobile/entry.tsx"],
  target: "browser",
  minify: false,
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": '{"DEV":false,"PROD":true}',
  },
  plugins: [
    {
      name: "isolated-real-routes",
      setup(build) {
        build.onResolve({ filter: /^\/public\/.*\?url$/ }, (a) => ({
          path: a.path,
          namespace: "public-asset",
        }));
        build.onLoad({ filter: /.*/, namespace: "public-asset" }, (a) => ({
          contents: `export default ${JSON.stringify(a.path.replace("/public", "").replace("?url", ""))}`,
          loader: "js",
        }));
        build.onLoad({ filter: /[\\/]lib[\\/]store\.ts$/ }, async (a) => ({
          contents:
            `import {dataFunctions} from ${JSON.stringify(adapter)};` +
            exportsOf(await readFile(a.path, "utf8"))
              .map((n) => `export const ${n}=dataFunctions.${n}??(()=>[]);`)
              .join("\n"),
          loader: "ts",
        }));
        build.onLoad(
          {
            filter:
              /[\\/](auth-context|use-plan|subscription-guard|contas-alertas|product-analytics|recorrencias)\.tsx?$/,
          },
          () => ({ contents: `export * from ${JSON.stringify(adapter)};`, loader: "tsx" }),
        );
        build.onLoad(
          { filter: /[\\/](AuthGate|ExpiredAccessBanner|ConnectedAccountSwitcher)\.tsx$/ },
          () => ({ contents: `export * from ${JSON.stringify(adapter)};`, loader: "tsx" }),
        );
        build.onLoad({ filter: /integrations[\\/]supabase[\\/]client\.ts$/ }, () => ({
          contents: `export {supabase} from ${JSON.stringify(adapter)};`,
          loader: "ts",
        }));
        build.onLoad({ filter: /\.functions\.ts$/ }, async (a) => ({
          contents: exportsOf(await readFile(a.path, "utf8"))
            .map(
              (n) =>
                `export const ${n}=async()=>({indicators:[],status:"cache",fetchedAt:"2026-10-28T12:00:00Z"});`,
            )
            .join("\n"),
          loader: "ts",
        }));
      },
    },
  ],
});
if (!result.success) throw Error(result.logs.join("\n"));
await mkdir(output, { recursive: true });
for (const file of result.outputs)
  await writeFile(join(output, file.path.split("/").pop()!), await file.arrayBuffer());
const compiler = await compile(await readFile("src/styles.css", "utf8"), {
  base: resolve("src"),
  onDependency() {},
});
async function texts(dir: string): Promise<string[]> {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((x) =>
        x.isDirectory()
          ? texts(join(dir, x.name))
          : /\.(tsx|ts)$/.test(x.name)
            ? readFile(join(dir, x.name), "utf8").then((s) => [s])
            : [],
      ),
    )
  ).flat();
}
const candidates = (await texts("src")).flatMap((s) =>
  [...s.matchAll(/["'`]([^"'`\n]+)["'`]/g)].flatMap((m) => m[1].split(/\s+/)),
);
await writeFile(
  join(output, "style.css"),
  compiler.build([...candidates, "font-sans", "font-display"]) +
    "\n" +
    (await readFile("src/premium.css", "utf8")),
);
await cp("public", output, { recursive: true });
await writeFile(
  join(output, "index.html"),
  '<!doctype html><html lang="pt" class="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script>localStorage.setItem("gf-theme","light");</script><script type="module" src="/entry.js"></script></body></html>',
);
console.log(output);
// Optional loopback-only server. No authentication, secrets or database connections.
if (process.argv.includes("--serve")) {
  const base = resolve(output);
  Bun.serve({
    hostname: "127.0.0.1",
    port: 3012,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const file = resolve(base, "." + pathname);
      if (!file.startsWith(base + "\\") && file !== base)
        return new Response("Not found", { status: 404 });
      const asset = Bun.file(file);
      const selected =
        (await asset.exists()) && pathname !== "/" ? asset : Bun.file(join(base, "index.html"));
      return new Response(selected, {
        headers: { "Content-Security-Policy": "connect-src 'none'; form-action 'none'" },
      });
    },
  });
  console.log("Capture fixture: http://127.0.0.1:3012/app");
}
