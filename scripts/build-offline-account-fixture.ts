import { resolve } from "node:path";
const result = await Bun.build({
  entrypoints: ["tests/fixtures/offline-accounts/entry.ts"],
  target: "browser",
  plugins: [
    {
      name: "synthetic-store",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/store$/ }, () => ({
          path: resolve("tests/fixtures/offline-accounts/store.ts"),
        }));
      },
    },
  ],
});
if (!result.success) throw new Error(String(result.logs));
await Bun.write(process.argv[2], result.outputs[0]);
