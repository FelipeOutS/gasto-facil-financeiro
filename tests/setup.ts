import { randomBytes } from "node:crypto";

// Local fixtures only. Missing/invalid configuration tests explicitly unset
// these values. Never persist or reuse production secrets.
process.env.WHATSAPP_GRAPH_VERSION = "v25.0";
process.env.WHATSAPP_FINANCIAL_MUTATIONS_VERSION = "2"; // isolated test environment only
process.env.WHATSAPP_PIX_KEY_ENC_SECRET = randomBytes(32).toString("hex");

// Vite resolve `import x from "/public/...svg?url"` para a URL do arquivo; o
// Bun não. Somente nos testes, devolvemos a mesma URL pública como string
// (o comportamento real dos logos no site continua sendo o do Vite).
import { plugin } from "bun";
plugin({
  name: "vite-url-assets-test",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "vite-url" }));
    build.onLoad({ filter: /.*/, namespace: "vite-url" }, (args) => ({
      contents: `export default ${JSON.stringify(args.path.replace(/\?url$/, "").replace(/^\/public(?=\/)/, ""))};`,
      loader: "js",
    }));
  },
});
