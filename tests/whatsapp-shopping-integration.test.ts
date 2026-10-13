// Assistente de Compras — gate/roteamento, cota persistente (mock RPC) e snapshot read-only.
// Sem rede, sem SerpApi real, sem banco.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { handleWhatsAppShopping, MSG_SHOPPING_NAO_DISPONIVEL } from "../src/server/shopping/whatsapp-shopping.server";
import { createDbQuotaStore, type RpcFn } from "../src/server/shopping/shopping-quota-db";
import { createMemoryQuotaStore } from "../src/server/shopping/shopping-quota";
import { buildFinanceSnapshot, type FinanceRows } from "../src/server/shopping/finance-snapshot";
import { estimarCapacidadeCompra, AVISO_APERTO } from "../src/server/shopping/capacidade-compra";
import { MSG_SEM_CHAVE, MSG_FALHA } from "../src/server/shopping/shopping-assistant";

const U = "11111111-1111-1111-1111-111111111111";
const TXT = "quero comprar um iphone 15 128gb mais barato";
const NOW = () => new Date("2026-10-13T15:00:00Z");
const body = { shopping_results: [{ title: "Apple iPhone 15 128GB", source: "Loja A", extracted_price: 4000, link: "https://lojaa.com.br/1" }] };
function fetchSpy() {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;
  return { f, urls };
}
const ON = { WHATSAPP_SHOPPING_ENABLED: "true", SERPAPI_API_KEY: "ficticia" };
const finOk = async () => ({ hoje: "2026-10-13", rendaPorMes: { "2026-09": 500_000, "2026-08": 500_000, "2026-07": 500_000 }, compromissos: [] });

describe("gate e roteamento", () => {
  test("flag OFF (padrão) → null, nada chamado", async () => {
    const s = fetchSpy();
    let ent = 0;
    const r = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "e1", text: TXT },
      { env: {}, fetchImpl: s.f, isEntitled: async () => { ent++; return true; }, quota: createMemoryQuotaStore() });
    expect(r).toBeNull(); expect(s.urls.length).toBe(0); expect(ent).toBe(0);
  });
  test("WHATSAPP_RESEARCH_ENABLED não liga compras", async () => {
    const r = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "e1", text: TXT }, { env: { WHATSAPP_RESEARCH_ENABLED: "true", SERPAPI_API_KEY: "k" } });
    expect(r).toBeNull();
  });
  test("lançamentos/supermercado/comprovante não interceptados mesmo com flag ON", async () => {
    for (const t of ["comprei um iphone por 4000", "gastei 89,90 no cartão", "quanto custa o arroz no mercado", "segue o comprovante do boleto", "me lembra de pagar a fatura"])
      expect(await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "x", text: t }, { env: ON })).toBeNull();
  });
  test("sem elegibilidade → mensagem, sem busca", async () => {
    const s = fetchSpy();
    const r = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "e1", text: TXT }, { env: ON, fetchImpl: s.f, isEntitled: async () => false, quota: createMemoryQuotaStore() });
    expect(r?.resposta).toBe(MSG_SHOPPING_NAO_DISPONIVEL); expect(s.urls.length).toBe(0);
  });
  test("sem chave → busca não configurada, sem chamada", async () => {
    const s = fetchSpy();
    const r = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "e1", text: TXT }, { env: { WHATSAPP_SHOPPING_ENABLED: "true" }, fetchImpl: s.f, isEntitled: async () => true, quota: createMemoryQuotaStore() });
    expect(r?.resposta).toBe(MSG_SEM_CHAVE); expect(s.urls.length).toBe(0);
  });
  test("SQL não aplicado (RPC erro) → fail-closed sem SerpApi", async () => {
    const s = fetchSpy();
    const rpc: RpcFn = async () => ({ data: null, error: { message: "function does not exist" } });
    const r = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "e1", text: TXT }, { env: ON, fetchImpl: s.f, isEntitled: async () => true, quota: createDbQuotaStore(rpc), loadFinance: finOk, now: NOW });
    expect(r?.resposta).toBe(MSG_FALHA); expect(s.urls.length).toBe(0);
  });
  test("webhook duplicado → não busca de novo", async () => {
    const s = fetchSpy(); const q = createMemoryQuotaStore();
    const d = { env: ON, fetchImpl: s.f, isEntitled: async () => true, quota: q, loadFinance: finOk, now: NOW };
    const a = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "dup", text: TXT }, d);
    const b = await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "dup", text: TXT }, d);
    expect(s.urls.length).toBe(1); expect(b?.resposta).toContain("Loja A"); expect(a?.resposta).toContain("9 de 10");
  });
  test("SerpApi recebe só a busca, nunca dados financeiros/usuário", async () => {
    const s = fetchSpy();
    await handleWhatsAppShopping({ userId: U, phone: "5511900000001", externalId: "p", text: "quero comprar iphone 15 128gb, meu cpf 123.456.789-00 cabe no orçamento?" },
      { env: ON, fetchImpl: s.f, isEntitled: async () => true, quota: createMemoryQuotaStore(), loadFinance: finOk, now: NOW });
    const q = new URL(s.urls[0]).searchParams;
    expect(q.get("q")).not.toMatch(/\d{3}\.\d{3}/); expect(s.urls[0]).not.toContain(U); expect(s.urls[0]).not.toContain("500000");
  });
  test("roteador: shopping fica após guarda de sessão/imagem/documento e antes da pesquisa antiga", () => {
    const src = readFileSync("src/server/whatsapp.server.ts", "utf8");
    const i = src.indexOf("handleWhatsAppShopping({"); const j = src.indexOf("handleWhatsAppResearch({");
    const guard = src.lastIndexOf("if (!sessao && decisao === \"outro\" && !msg.image && !msg.document && !financialInstallment)", i);
    expect(i).toBeGreaterThan(0); expect(i).toBeLessThan(j); expect(guard).toBeGreaterThan(0); expect(i - guard).toBeLessThan(300);
  });
  test("módulos de compras não escrevem em tabelas", () => {
    for (const f of ["whatsapp-shopping.server.ts", "finance-snapshot.ts", "shopping-assistant.ts", "shopping-quota-db.ts"])
      { const s = readFileSync(`src/server/shopping/${f}`, "utf8"); expect(s).not.toMatch(/\.(insert|upsert|delete)\(/); expect(s).not.toMatch(/\.update\(\s*\{/); }
  });
});

describe("cota DB (RPC mock)", () => {
  test("mapeia estados e limita tentativas a 0..2", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const rpc: RpcFn = async (fn, a) => { calls.push([fn, a]); return { data: fn.endsWith("reserve") ? [{ claim_state: "user_quota" }] : [{ user_remaining: 2 }], error: null }; };
    const st = createDbQuotaStore(rpc);
    expect(await st.reserve(U, "x", "ignorado")).toEqual({ state: "user_quota" });
    expect((await st.finish(U, "x", "m", 9, "r")).userRemaining).toBe(2);
    expect(calls[1][1].p_api_calls).toBe(2);
    expect(Object.keys(calls[0][1]).sort()).toEqual(["p_external_id", "p_user_id"]); // sem limites/mês do cliente
  });
});

describe("snapshot financeiro", () => {
  const base: FinanceRows = {
    receitas: [
      { id: "r1", data: "2026-09-05", valor: 5000, descricao: "Salário", origem: null, tipo: "salario" },
      { id: "r2", data: "2026-08-05", valor: 5000, descricao: "Salário", origem: null, tipo: "salario" },
      { id: "r3", data: "2026-07-05", valor: 5000, descricao: "Salário", origem: null, tipo: "salario" },
      { id: "r4", data: "2026-09-10", valor: 9000, descricao: "Transferência entre contas", origem: null, tipo: null },
      { id: "r5", data: "2026-10-01", valor: 9999, descricao: "Salário", origem: null, tipo: null },
    ],
    gastos: [
      { id: "g1", data: "2026-09-02", valor: 300, gasto_fixo: false, recorrencia_id: null, total_parcelas: 1, parcela_atual: 1, grupo_parcelamento_id: null },
      { id: "p1", data: "2026-09-01", valor: 200, gasto_fixo: false, recorrencia_id: null, total_parcelas: 10, parcela_atual: 3, grupo_parcelamento_id: "G" },
      { id: "p2", data: "2026-10-01", valor: 200, gasto_fixo: false, recorrencia_id: null, total_parcelas: 10, parcela_atual: 4, grupo_parcelamento_id: "G" },
      { id: "n1", data: "2026-08-01", valor: 50, gasto_fixo: false, recorrencia_id: "rec1", total_parcelas: 1, parcela_atual: 1, grupo_parcelamento_id: null },
    ],
    recorrencias: [{ id: "rec1", valor: 50, status: "ativa", frequencia: "mensal" }],
    contas: [
      { id: "c1", nome: "Aluguel", valor: 1500, status: "pendente", gasto_id: null, recorrencia_id: null, data_vencimento: "2026-10-10" },
      { id: "c2", nome: "Fatura Nubank", valor: 2000, status: "pendente", gasto_id: null, recorrencia_id: null, data_vencimento: "2026-10-12" },
      { id: "c3", nome: "Netflix", valor: 50, status: "pendente", gasto_id: null, recorrencia_id: "rec1", data_vencimento: "2026-10-15" },
    ],
  };
  test("renda sem transferências e sem mês atual; sem duplicar fatura/recorrência/parcela", () => {
    const s = buildFinanceSnapshot("2026-10-13", base);
    expect(s.rendaPorMes).toEqual({ "2026-09": 500_000, "2026-08": 500_000, "2026-07": 500_000 });
    const ids = s.compromissos.map((c) => c.id).sort();
    expect(ids).toEqual(["conta:c1", "parc:G", "rec:rec1", "variaveis"]);
    expect(s.compromissos.find((c) => c.id === "parc:G")?.valorMensalCents).toBe(20_000);
    expect(s.compromissos.find((c) => c.id === "variaveis")?.valorMensalCents).toBe(10_000);
    const cap = estimarCapacidadeCompra({ ...s, precoCents: 800_000, guardadoCents: 99_000_000, limiteCartaoCents: 99_000_000 });
    expect(cap.folgaCents).toBe(500_000 - 150_000 - 20_000 - 5_000 - 10_000);
    expect(cap.mensagem).toContain(AVISO_APERTO); // 6x de 1.333,34 > 30% de 3.150
  });
  test("menos de 2 meses → baixa confiança; nenhum → insuficiente", () => {
    const um = buildFinanceSnapshot("2026-10-13", { ...base, receitas: base.receitas.slice(0, 1) });
    expect(estimarCapacidadeCompra({ ...um, precoCents: 1000 }).confianca).toBe("baixa");
    const zero = buildFinanceSnapshot("2026-10-13", { ...base, receitas: [] });
    expect(estimarCapacidadeCompra({ ...zero, precoCents: 1000 }).confianca).toBe("insuficiente");
  });
  test("folga <= 0 → não cabe", () => {
    const s = buildFinanceSnapshot("2026-10-13", { ...base, contas: [{ ...base.contas[0], valor: 99_999 }] });
    expect(estimarCapacidadeCompra({ ...s, precoCents: 1000 }).cabeAVista).toBe(false);
  });
  test("leitor real filtra deleted_at e só usa select", () => {
    const src = readFileSync("src/server/shopping/whatsapp-shopping.server.ts", "utf8");
    expect(src).toMatch(/from\("gastos"\)[\s\S]{0,200}\.is\("deleted_at", null\)/);
    expect(src).toMatch(/\.eq\("user_id", userId\)/);
  });
});
