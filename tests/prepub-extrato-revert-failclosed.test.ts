import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
// Regressão de pré-publicação: o desfazer de extrato NÃO volta ao DELETE sequencial
// (não atômico) da versão publicada; sem a RPC transacional ele falha fechado.
const src = readFileSync("src/lib/store.ts", "utf8");
const i = src.indexOf("export async function revertExtratoImportadoSeguro");
const bloco = src.slice(i, src.indexOf("\nexport ", i + 10));
describe("Desfazer extrato: sem fallback destrutivo", () => {
  it("usa só a RPC transacional", () => expect(bloco).toContain('rpc("reverter_extrato_atomic"'));
  it("não faz DELETE direto em tabelas financeiras", () => expect(bloco).not.toMatch(/\.delete\(\)/));
});
