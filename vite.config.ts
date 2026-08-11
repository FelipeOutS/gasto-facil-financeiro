// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Load all env vars (no prefix) into process.env so server routes can read
// secrets like SUPABASE_SERVICE_ROLE_KEY. Do NOT expose these to the client.
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// BUILD_ID gerado UMA vez por build (no carregamento deste config) e injetado no
// bundle do cliente, no servidor e no endpoint /api/public/app-version.
// Ver docs/INCIDENTE_P0_CARREGAMENTO_RECORRENTE_2026-08-07.md.
const BUILD_TIMESTAMP = new Date();
const GI_BUILD_ID = `${BUILD_TIMESTAMP.toISOString().slice(0, 10)}-${BUILD_TIMESTAMP.getTime().toString(36)}`;

export default defineConfig({
  vite: {
    define: {
      __GI_BUILD_ID__: JSON.stringify(GI_BUILD_ID),
      __GI_DEPLOYED_AT__: JSON.stringify(BUILD_TIMESTAMP.toISOString()),
    },
    resolve: {
      alias: {
        // entities v7 moveu os arquivos: não existe mais `lib/`.
        "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/decode.js"),
        "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/escape.js"),
        entities: path.resolve(__dirname, "node_modules/entities"),
      },
    },

  },
});
