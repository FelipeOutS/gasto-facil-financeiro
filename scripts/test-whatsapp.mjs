#!/usr/bin/env bun
/**
 * WA-B5 — Runner único da suíte de testes do WhatsApp.
 *
 * Executa cada arquivo de teste em um processo `bun test` separado para:
 *  - evitar poluição de `mock.module(...)` entre arquivos (limitação do bun:test);
 *  - garantir que uma falha de qualquer arquivo retorne código != 0;
 *  - manter o resumo do runner legado (whatsapp-flow.test.ts) visível.
 *
 * Nenhum teste chama Meta, Graph API, Gemini, OCR real ou Supabase real:
 * cada arquivo mocka as bordas externas (vide `mock.module(...)` em cada
 * teste e os stubs de `globalThis.fetch` no webhook HTTP).
 *
 * Uso:
 *   bun run test:whatsapp
 *   bun run test:whatsapp:ci   (mesmo runner; código de saída != 0 falha o CI)
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const TESTS_DIR = "tests";

// Arquivos que compõem a suíte de WhatsApp + dependências relacionadas.
const INCLUDE = [
  "admin-master-server.test.ts",
  "whatsapp-audio.test.ts",
  "whatsapp-audio-duration.test.ts",
  "whatsapp-authz.test.ts",
  "whatsapp-beta.test.ts",
  "whatsapp-bugfixes.test.ts",
  "whatsapp-comprovantes.test.ts",
  "whatsapp-consultas-especificas.test.ts",
  "whatsapp-consultas.test.ts",
  "whatsapp-conversational.test.ts",
  "whatsapp-flow.test.ts",
  "whatsapp-hardening-b3.test.ts",
  "whatsapp-media-blindagem.test.ts",
  "whatsapp-pending-expense-session.test.ts",
  "whatsapp-pipeline.test.ts",
  "whatsapp-receitas.test.ts",
  "whatsapp-reset.test.ts",
  "whatsapp-session.test.ts",
  "whatsapp-webhook-http.test.ts",
  "whatsapp-voice-number-normalizer.test.ts",
  "whatsapp-voice-description-cleanup.test.ts",
  "whatsapp-voice-category-suggestion.test.ts",
  "whatsapp-merchant-memory.test.ts",
  "whatsapp-merchant-memory-evidence.test.ts",
  "whatsapp-comprovante-categoria-manual.test.ts",
  "whatsapp-categoria-manual-gasto.test.ts",
  "whatsapp-faturas.test.ts",
  "whatsapp-faturas-detalhe.test.ts",
  "whatsapp-faturas-futuras.test.ts",
  "whatsapp-limites.test.ts",
  "whatsapp-contas.test.ts",
  "whatsapp-contas-criar.test.ts",
  "whatsapp-contas-pagar.test.ts",
  "whatsapp-contas-pagar-data.test.ts",
  "whatsapp-contas-pagar-preserve-name.test.ts",
  "whatsapp-contas-editar.test.ts",

  "whatsapp-parcelamento.test.ts",
  "whatsapp-parcelamento-categoria-integracao.test.ts",
  "whatsapp-ux-c6.test.ts",
  "whatsapp-pix-favorecidos.test.ts",
  "whatsapp-pix-c72a.test.ts",
  "whatsapp-pix-c72b.test.ts",
  "whatsapp-notifications-c8.test.ts",
  "whatsapp-contas-lembretes-c9.test.ts",
  "whatsapp-c91-lifecycle.test.ts",
  "whatsapp-boleto-c10a.test.ts",
  "whatsapp-boleto-c10a-1.test.ts",
  "whatsapp-boleto-c10b.test.ts",
  "whatsapp-boleto-c10b-integration.test.ts",
  "whatsapp-boleto-c10b-hardening.test.ts",
  "free-ads-plan.test.ts",
];

// Validação: arquivos listados existem; reporta extras WhatsApp não cobertos.
const onDisk = new Set(
  readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts")),
);
const missing = INCLUDE.filter((f) => !onDisk.has(f));
if (missing.length > 0) {
  console.error(`[WA-B5] arquivos esperados ausentes: ${missing.join(", ")}`);
  process.exit(2);
}
const extras = [...onDisk].filter(
  (f) =>
    (f.startsWith("whatsapp-") ||
      f.startsWith("admin-master-") ||
      f.startsWith("free-ads-")) &&
    !INCLUDE.includes(f),
);
if (extras.length > 0) {
  console.error(
    `[WA-B5] arquivos WhatsApp/admin/free-ads não incluídos no runner: ${extras.join(", ")}`,
  );
  process.exit(2);
}

const env = {
  ...process.env,
  // Configuração mínima para que os bypasses de Admin Master usados pelos
  // testes (canary) sejam reconhecidos. Não é um segredo de produção.
  ADMIN_MASTER_EMAILS:
    process.env.ADMIN_MASTER_EMAILS ??
    "felipe.out.silva@outlook.com,michael@medeiroscenografia.com.br",
  // Garantia explícita: nenhum teste deve falar com rede real.
  WHATSAPP_DISABLE_NETWORK: "1",
};

let totalPass = 0;
let totalFail = 0;
const failedFiles = [];
const startedAt = Date.now();

for (const file of INCLUDE) {
  const rel = path.join(TESTS_DIR, file);
  process.stdout.write(`\n▶ ${rel}\n`);
  const result = spawnSync("bun", ["test", rel], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // Bun imprime: ` N pass\n N fail\n` no relatório final.
  const both = stdout + "\n" + stderr;
  const passMatch = both.match(/^\s*(\d+)\s+pass\s*$/m);
  const failMatch = both.match(/^\s*(\d+)\s+fail\s*$/m);
  const filePass = passMatch ? Number(passMatch[1]) : 0;
  const fileFail = failMatch ? Number(failMatch[1]) : 0;
  totalPass += filePass;
  totalFail += fileFail;

  const exitedOk = result.status === 0 && fileFail === 0;
  if (!exitedOk) {
    failedFiles.push({ file: rel, status: result.status, fail: fileFail });
  }
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);

console.log("\n========================================");
console.log(`WA-B5 — runner único da suíte de WhatsApp`);
console.log(`Arquivos executados : ${INCLUDE.length}`);
console.log(`Aprovados (testes)  : ${totalPass}`);
console.log(`Falhos    (testes)  : ${totalFail}`);
console.log(`Arquivos com falha  : ${failedFiles.length}`);
console.log(`Duração total       : ${seconds}s`);
if (failedFiles.length > 0) {
  console.log("\nFalhas por arquivo:");
  for (const f of failedFiles) {
    console.log(`  - ${f.file} (exit=${f.status}, fail=${f.fail})`);
  }
}

process.exit(failedFiles.length === 0 ? 0 : 1);
