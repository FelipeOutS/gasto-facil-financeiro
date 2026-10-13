// P0: reversão de extrato nunca apaga gasto soft-excluído. Cliente simulado, sem rede.
import { describe, expect, it, mock } from "bun:test";

type Call = { table: string; op: string; filters: string[] };
const calls: Call[] = [];
let excluidos: string[] = [];
let leituraFalha = false;
function chain(table: string) {
  const c: Call = { table, op: "select", filters: [] };
  const api: Record<string, unknown> = {};
  const rec = (n: string) => (...a: unknown[]) => { c.filters.push(`${n}:${a.map(String).join(",")}`); return api; };
  for (const n of ["eq", "in", "is", "not", "limit", "select", "order", "maybeSingle"]) api[n] = rec(n);
  api.delete = () => { c.op = "delete"; calls.push(c); return api; };
  api.update = () => { c.op = "update"; calls.push(c); return api; };
  api.then = (res: (v: unknown) => void) => {
    if (c.op === "select") return res(leituraFalha ? { data: null, error: { message: "x" } } : { data: excluidos.map((id) => ({ id })), error: null });
    return res({ data: [], error: null });
  };
  return api;
}
mock.module("@/integrations/supabase/client", () => ({ supabase: { from: chain } }));
const store = await import("../src/lib/store");

describe("P0 reversão de extrato × soft-delete", () => {
  it("lote com gasto excluído → bloqueia antes de qualquer DELETE", async () => {
    excluidos = ["g-del"]; leituraFalha = false; calls.length = 0;
    expect(await store.loteTemGastoExcluido("b1", "u1")).toBe(true);
    expect(calls.filter((c) => c.op === "delete")).toEqual([]);
  });
  it("erro de leitura → bloqueia (fail-closed)", async () => {
    excluidos = []; leituraFalha = true;
    expect(await store.loteTemGastoExcluido("b1", "u1")).toBe(true);
  });
  it("lote limpo → liberado", async () => {
    excluidos = []; leituraFalha = false;
    expect(await store.loteTemGastoExcluido("b1", "u1")).toBe(false);
  });
  it("fonte: DELETE de gastos no extrato sempre condicionado a deleted_at IS NULL", async () => {
    const src = await Bun.file("src/lib/store.ts").text();
    const ini = src.indexOf("export async function loteTemGastoExcluido");
    const fim = src.indexOf("export async function deleteExtratoImportado");
    const bloco = src.slice(ini, fim);
    expect(bloco.match(/loteTemGastoExcluido\(batchId, activeUserId\)/g)?.length).toBe(2);
    expect(bloco.match(/=== "gastos"\) q = q\.is\("deleted_at", null\)/g)?.length).toBe(2);
  });
});
