#!/usr/bin/env bun
/**
 * Runner canônico da suíte (`bun run test:global`).
 *
 * Por que não usar apenas `bun test tests/*.test.ts`:
 *   O `bun test` carrega TODOS os arquivos de teste no MESMO processo antes de
 *   executá-los. `mock.module` é global e o último registro de cada
 *   especificador vence — mesmo que o arquivo dono do mock só rode depois.
 *   Arquivos como os testes HTTP de webhook/áudio precisam stubar
 *   `@/server/whatsapp.server` inteiro, o que substitui a implementação real
 *   para todos os demais arquivos do processo. Não existe API de "unmock" nem
 *   flag de isolamento no Bun 1.3.
 *
 * Este runner executa cada arquivo em um PROCESSO próprio, agrega os totais e
 * falha com exit code != 0 se houver qualquer fail/error.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = "tests";
const CONCURRENCY = Number(process.env.TEST_CONCURRENCY ?? 4);

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith(".test.ts"))
      .sort()
      .map((f) => join(TESTS_DIR, f));

type Result = {
  file: string;
  pass: number;
  fail: number;
  skip: number;
  errors: number;
  exitCode: number;
  failedNames: string[];
};

function parse(file: string, out: string, exitCode: number): Result {
  const num = (re: RegExp) => {
    const m = out.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    file,
    pass: num(/^\s*(\d+) pass$/m),
    fail: num(/^\s*(\d+) fail$/m),
    skip: num(/^\s*(\d+) skip$/m),
    errors: num(/^\s*(\d+) errors?$/m),
    exitCode,
    failedNames: [...out.matchAll(/^\(fail\) (.*)$/gm)].map((m) => m[1]!),
  };
}

async function run(file: string): Promise<Result> {
  const proc = Bun.spawn(["bun", "test", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return parse(file, `${stdout}\n${stderr}`, exitCode);
}

const results: Result[] = [];
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const r = await run(file);
      results.push(r);
      const tag = r.fail || r.errors || r.exitCode !== 0 ? "FAIL" : "ok";
      console.log(
        `[${tag}] ${file} — pass=${r.pass} fail=${r.fail} skip=${r.skip} errors=${r.errors}`,
      );
    }
  }),
);

const totals = results.reduce(
  (a, r) => ({
    pass: a.pass + r.pass,
    fail: a.fail + r.fail,
    skip: a.skip + r.skip,
    errors: a.errors + r.errors,
  }),
  { pass: 0, fail: 0, skip: 0, errors: 0 },
);

const red = results.filter((r) => r.fail || r.errors || r.exitCode !== 0);
console.log("\n================ RESUMO ================");
console.log(`arquivos: ${results.length}`);
console.log(`pass: ${totals.pass}`);
console.log(`fail: ${totals.fail}`);
console.log(`skip: ${totals.skip}`);
console.log(`errors: ${totals.errors}`);
if (red.length) {
  console.log(`\narquivos vermelhos (${red.length}):`);
  for (const r of red.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`  ${r.file} (fail=${r.fail}, errors=${r.errors}, exit=${r.exitCode})`);
    for (const n of r.failedNames) console.log(`     - ${n}`);
  }
}
process.exit(red.length ? 1 : 0);
