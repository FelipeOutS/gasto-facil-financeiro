import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const result = spawnSync(
  process.execPath,
  ["--max-old-space-size=8192", vite, "build", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
if (result.error) console.error("Não foi possível iniciar o build:", result.error.message);
process.exit(result.status ?? 1);
