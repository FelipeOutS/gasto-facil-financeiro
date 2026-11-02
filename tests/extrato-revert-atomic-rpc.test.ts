// P1: reversão de extrato no site só via RPC transacional, sem fallback de DELETE.
// Cliente Supabase simulado, sem rede.
import { beforeEach, describe, expect, it, mock } from "bun:test";

type Op = { table: string; op: string };
const ops: Op[] = [];
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResp: { data: unknown; error: unknown } = { data: null, error: null };

function chain(table: string) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const n of ["eq", "in", "is", "not", "limit", "select", "order", "maybeSingle", "single"]) api[n] = self;
  for (const n of ["delete", "update", "upsert"]) api[n] = () => { ops.push({ table, op: n }); return api; };
  api.insert = () => { ops.push({ table, op: "insert" }); return api; };
  api.then = (res: (v: unknown) => void) => res({ data: [], error: null });
  return api;
}
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: chain,
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return rpcResp; },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  },
}));
const store = await import("../src/lib/store");

let n = 0;
async function novoLote() {
  const id = `b0000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await store.createExtratoImportado({ id, tipoOrigem: "pdf", qtdMovimentacoes: 3 } as never);
  ops.length = 0; rpcCalls = [];
  return id;
}
const status = (id: string) => store.getExtratosImportados().find((e) => e.id === id)?.status;

beforeEach(() => { store.setActiveUserId(null); store.setActiveUserId("aaaaaaaa-0000-0000-0000-000000000001"); });

describe("revertExtratoImportadoSeguro via RPC", () => {
  it("(10) RPC inexistente → falha fechada, nenhum DELETE/UPDATE local, cache intacto", async () => {
    const id = await novoLote();
    rpcResp = { data: null, error: { code: "PGRST202", message: "function not found" } };
    const r = await store.revertExtratoImportadoSeguro(id);
    expect(r.ok).toBe(false);
    expect(rpcCalls).toEqual([{ fn: "reverter_extrato_atomic", args: { p_batch_id: id } }]);
    expect(ops.filter((o) => o.op === "delete" || o.op === "update")).toEqual([]);
    expect(status(id)).toBe("importado");
  });

  it("(11) erro do banco (rollback) → não declara ok, cache intacto", async () => {
    const id = await novoLote();
    rpcResp = { data: null, error: { code: "40001", message: "contagem" } };
    expect((await store.revertExtratoImportadoSeguro(id)).ok).toBe(false);
    expect(status(id)).toBe("importado");
  });

  it("(11) resposta malformada → falha fechada", async () => {
    const id = await novoLote();
    rpcResp = { data: { ok: true, status: "talvez", ids: [] }, error: null };
    expect((await store.revertExtratoImportadoSeguro(id)).ok).toBe(false);
    expect(status(id)).toBe("importado");
  });

  it("(4) sucesso parcial → reflete 'parcial', removidos/mantidos do banco", async () => {
    const id = await novoLote();
    rpcResp = { data: { ok: true, status: "parcial", removidos: 6, mantidos: 3, ids: ["x1"] }, error: null };
    const r = await store.revertExtratoImportadoSeguro(id);
    expect(r).toEqual({ ok: true, removidos: 6, mantidos: 3, status: "parcial" });
    expect(status(id)).toBe("parcial");
    expect(ops.filter((o) => o.op === "delete")).toEqual([]);
  });

  it("(12) repetir após parcial chama a RPC de novo (sem DELETE local)", async () => {
    const id = await novoLote();
    rpcResp = { data: { ok: true, status: "parcial", removidos: 6, mantidos: 3, ids: [] }, error: null };
    await store.revertExtratoImportadoSeguro(id);
    rpcResp = { data: { ok: true, status: "parcial", removidos: 0, mantidos: 3, ids: [] }, error: null };
    const r = await store.revertExtratoImportadoSeguro(id);
    expect(r.status).toBe("parcial");
    expect(rpcCalls.length).toBe(2);
    expect(ops.filter((o) => o.op === "delete")).toEqual([]);
  });

  it("(6)(7) revertido → status 'revertido'; nova chamada não toca o banco", async () => {
    const id = await novoLote();
    rpcResp = { data: { ok: true, status: "revertido", removidos: 5, mantidos: 0, ids: [] }, error: null };
    expect((await store.revertExtratoImportadoSeguro(id)).status).toBe("revertido");
    rpcCalls = [];
    expect((await store.revertExtratoImportadoSeguro(id)).ok).toBe(true);
    expect(rpcCalls).toEqual([]);
  });

  it("legado revertExtratoImportado delega à RPC (sem hard delete sequencial)", async () => {
    const id = await novoLote();
    rpcResp = { data: null, error: { code: "PGRST202" } };
    expect(await store.revertExtratoImportado(id)).toBe(false);
    expect(ops.filter((o) => o.op === "delete")).toEqual([]);
  });
});

describe("estrutural (só leitura de fonte; não prova comportamento)", () => {
  it("nenhum .delete() nos caminhos de reversão de extrato", async () => {
    const src = await Bun.file("src/lib/store.ts").text();
    const ini = src.indexOf("export async function revertExtratoImportadoSeguro");
    const fim = src.indexOf("export async function deleteExtratoImportado");
    const bloco = src.slice(ini, fim);
    expect(bloco).toContain('sbAny.rpc("reverter_extrato_atomic"');
    expect(bloco).not.toMatch(/\.delete\(\)/);
  });
});
