// Assistente de Compras MVP — só fixtures; nenhuma chamada real à SerpApi.
import { test, expect, describe } from "bun:test";
import { detectShoppingIntent, sanitizeQuery } from "../src/server/shopping/shopping-intent";
import { buildSerpApiUrl, parseBRL, safeUrl, matchesVariant, parseOffers, searchShopping } from "../src/server/shopping/serpapi-shopping";
import { estimarCapacidadeCompra, AVISO_APERTO, ultimosMesesCompletos } from "../src/server/shopping/capacidade-compra";
import { createMemoryQuotaStore, GLOBAL_MONTHLY_LIMIT } from "../src/server/shopping/shopping-quota";
import { handleShoppingMessage, MSG_SEM_CHAVE, MSG_LIMITE_USUARIO, MSG_LIMITE_GLOBAL, MSG_FALHA } from "../src/server/shopping/shopping-assistant";
import { detectInstallmentIntent } from "../src/lib/whatsappParser";

const KEY = "chave-ficticia-teste";
const NOW = new Date("2026-10-13T15:00:00Z");
const MAC = "quero comprar um MacBook Air M4 de 16 GB, onde está mais barato e cabe no meu orçamento?";

const fixture = {
  shopping_results: [
    { title: "Apple MacBook Air 13 M4 16GB 256GB", source: "Loja A", extracted_price: 8499.9, product_link: "https://www.loja-a.com.br/p/1" },
    { title: "Apple MacBook Air M4 16 GB 512GB", source: "Loja B", price: "R$ 7.999,00", link: "https://lojab.com.br/x" },
    { title: "MacBook Air M3 16GB", source: "Loja C", extracted_price: 6000, link: "https://lojac.com.br/m3" },
    { title: "MacBook Air M4 8GB", source: "Loja D", extracted_price: 5500, link: "https://lojad.com.br/8" },
    { title: "MacBook Pro M4 16GB", source: "Loja E", extracted_price: 9000, link: "https://lojae.com.br/pro" },
    { title: "MacBook Air M4 16GB Recondicionado", source: "Loja F", extracted_price: 5000, link: "https://lojaf.com.br/r" },
    { title: "MacBook Air M4 16GB", source: "Golpe", extracted_price: 100, link: "http://192.168.0.1/x" },
    { title: "MacBook Air M4 16GB", source: "Encurtado", extracted_price: 200, link: "https://bit.ly/abc" },
    { title: "MacBook Air M4 16GB", source: "Loja G", extracted_price: 8100, link: "https://lojag.com.br/1" },
    { title: "MacBook Air M4 16GB", source: "Loja H", extracted_price: 9100, link: "https://lojah.com.br/1" },
  ],
};
function fakeFetch(status = 200, body: unknown = fixture) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const fin = {
  hoje: "2026-10-13",
  rendaPorMes: { "2026-09": 1_000_000, "2026-08": 1_000_000, "2026-07": 1_000_000 },
  compromissos: [{ id: "aluguel", tipo: "fixa" as const, valorMensalCents: 400_000 }],
  guardadoCents: 5_000_000,
};

describe("intenção", () => {
  test("pergunta de compra inicia fluxo e normaliza a busca", () => {
    const i = detectShoppingIntent(MAC)!;
    expect(i.query).toBe("macbook air m4 16gb");
    expect(i.wantsBudget).toBe(true);
  });
  test("compra no passado é gasto, não compras", () => {
    expect(detectShoppingIntent("comprei MacBook por 8 mil em 10x")).toBeNull();
    expect(detectInstallmentIntent("comprei MacBook por 8 mil em 10x")).not.toBeNull();
    expect(detectShoppingIntent("gastei 50 no mercado")).toBeNull();
  });
  test("supermercado, lembrete e comprovante não são interceptados", () => {
    expect(detectShoppingIntent("onde está mais barato o arroz no supermercado?")).toBeNull();
    expect(detectShoppingIntent("quero comprar leite, me lembra amanhã")).toBeNull();
    expect(detectShoppingIntent("quanto custa o boleto do comprovante")).toBeNull();
  });
  test("dados pessoais saem da busca", () => {
    expect(sanitizeQuery("iphone 15 123.456.789-09 fulano@x.com 11999998888")).toBe("iphone 15");
  });
});

describe("SerpApi (mock)", () => {
  test("URL usa google_shopping Brasil e só a busca normalizada", () => {
    const u = new URL(buildSerpApiUrl("macbook air m4 16gb", KEY));
    expect(u.searchParams.get("engine")).toBe("google_shopping");
    expect(u.searchParams.get("gl")).toBe("br");
    expect(u.searchParams.get("hl")).toBe("pt-br");
    expect(u.searchParams.get("q")).toBe("macbook air m4 16gb");
  });
  test("BRL e URLs", () => {
    expect(parseBRL("R$ 7.999,00")).toBe(799900);
    expect(parseBRL("R$ 10,5")).toBe(1050);
    expect(parseBRL("US$ 999")).toBeNull();
    expect(parseBRL(8499.9)).toBe(849990);
    expect(safeUrl("http://loja.com.br")).toBeNull();
    expect(safeUrl("https://user:pw@loja.com.br")).toBeNull();
    expect(safeUrl("https://bit.ly/x")).toBeNull();
    expect(safeUrl("https://10.0.0.1/x")).toBeNull();
    expect(safeUrl("https://www.loja.com.br/p")).toBe("https://www.loja.com.br/p");
  });
  test("variantes do MacBook", () => {
    const q = "macbook air m4 16gb";
    expect(matchesVariant("MacBook Air M4 16 GB", q)).toBe(true);
    expect(matchesVariant("MacBook Air M3 16GB", q)).toBe(false);
    expect(matchesVariant("MacBook Air M4 8GB", q)).toBe(false);
    expect(matchesVariant("MacBook Pro M4 16GB", q)).toBe(false);
  });
  test("até 3 ofertas, mais baratas, sem usado/link suspeito/variante errada", () => {
    const o = parseOffers(fixture, "macbook air m4 16gb", false)!;
    expect(o.map((x) => x.store)).toEqual(["Loja B", "Loja G", "Loja A"]);
    expect(parseOffers(fixture, "macbook air m4 16gb usado", true)!.map((x) => x.store)[0]).toBe("Loja F");
  });
  test("sem chave não chama a API", async () => {
    const { f, calls } = fakeFetch();
    expect(await searchShopping({ query: "x", wantsUsed: false, apiKey: undefined, fetchImpl: f })).toEqual({ ok: false, reason: "no_key", apiCalls: 0 });
    expect(calls.length).toBe(0);
  });
  test("5xx tenta de novo uma vez e conta as chamadas", async () => {
    const { f, calls } = fakeFetch(503, {});
    const r = await searchShopping({ query: "x", wantsUsed: false, apiKey: KEY, fetchImpl: f });
    expect(r).toMatchObject({ ok: false, apiCalls: 2 });
    expect(calls.length).toBe(2);
  });
});

describe("capacidade (pura)", () => {
  test("3 meses completos, guardado fora, 30%", () => {
    expect(ultimosMesesCompletos("2026-01-05")).toEqual(["2025-12", "2025-11", "2025-10"]);
    const c = estimarCapacidadeCompra({ ...fin, precoCents: 799_900 });
    expect(c.confianca).toBe("ok");
    expect(c.folgaCents).toBe(600_000); // guardado (50 mil) não entra
    expect(c.cabeAVista).toBe(false);
    const by = Object.fromEntries(c.cenarios.map((x) => [x.n, x]));
    expect(by[6].parcelaCents).toBe(133_317);
    expect(by[6].aperta).toBe(false); // 22,2%
    const caro = estimarCapacidadeCompra({ ...fin, precoCents: 2_400_000 });
    expect(caro.cenarios.find((x) => x.n === 12)!.aperta).toBe(true); // 200k > 180k
    expect(caro.mensagem).toContain(AVISO_APERTO);
  });
  test("exatamente 30% não alerta; acima alerta", () => {
    const c = estimarCapacidadeCompra({ ...fin, precoCents: 1_080_000, parcelas: [6] });
    expect(c.cenarios[0]).toMatchObject({ parcelaCents: 180_000, aperta: false });
    const d = estimarCapacidadeCompra({ ...fin, precoCents: 1_080_006, parcelas: [6] });
    expect(d.cenarios[0].aperta).toBe(true);
  });
  test("menos meses = baixa confiança; nenhum = insuficiente; mês atual ignorado", () => {
    expect(estimarCapacidadeCompra({ ...fin, rendaPorMes: { "2026-09": 1_000_000, "2026-10": 9_999_999 }, precoCents: 1000 }).confianca).toBe("baixa");
    const z = estimarCapacidadeCompra({ ...fin, rendaPorMes: {}, precoCents: 1000 });
    expect(z.confianca).toBe("insuficiente");
    expect(z.folgaCents).toBeNull();
  });
  test("folga ≤ 0 não cabe; compromisso duplicado conta uma vez", () => {
    const c = estimarCapacidadeCompra({ ...fin, compromissos: [
      { id: "f", tipo: "fatura", valorMensalCents: 1_000_000 }, { id: "f", tipo: "fatura", valorMensalCents: 1_000_000 },
    ], precoCents: 1000 });
    expect(c.compromissosCents).toBe(1_000_000);
    expect(c.folgaCents).toBe(0);
    expect(c.mensagem).toContain("não cabe");
  });
});

describe("orquestrador + cota", () => {
  const deps = (over: Partial<Parameters<typeof handleShoppingMessage>[1]> = {}) => ({
    enabled: true, apiKey: KEY, quota: createMemoryQuotaStore(), now: () => NOW, ...over,
  });
  test("sem chave: orientação e nenhuma reserva", async () => {
    const d = deps({ apiKey: undefined });
    expect((await handleShoppingMessage({ userId: "u1", externalId: "e1", text: MAC }, d))!.resposta).toBe(MSG_SEM_CHAVE);
    expect(d.quota.entries.size).toBe(0);
  });
  test("busca mostra ofertas, finanças e saldo; repetição não desconta", async () => {
    const { f, calls } = fakeFetch();
    const d = deps({ fetchImpl: f, loadFinance: async () => fin });
    const r = (await handleShoppingMessage({ userId: "u1", externalId: "e1", text: MAC }, d))!.resposta;
    expect(r).toContain("R$ 7.999,00 — Loja B");
    expect(r).toContain("Brasília");
    expect(r).toContain("Você ainda tem 9 de 10");
    expect(r).not.toMatch(/menor preço do mercado|em estoque|frete grátis/i);
    const again = (await handleShoppingMessage({ userId: "u1", externalId: "e1", text: MAC }, d))!.resposta;
    expect(again).toContain("Loja B");
    expect(calls.length).toBe(1);
    expect(await d.quota.userRemaining("u1", "2026-10")).toBe(9);
    // privacidade: nada financeiro na URL
    expect(calls[0]).not.toMatch(/1000000|renda|guardado|u1/);
  });
  test("aviso faltando 2 e no 0; 11ª bloqueada sem chamar a API", async () => {
    const { f, calls } = fakeFetch();
    const d = deps({ fetchImpl: f });
    let last = "";
    for (let i = 1; i <= 10; i++) last = (await handleShoppingMessage({ userId: "u1", externalId: `e${i}`, text: MAC }, d))!.resposta;
    expect(last).toContain("todas as 10");
    expect((await handleShoppingMessage({ userId: "u1", externalId: "e11", text: MAC }, d))!.resposta).toBe(MSG_LIMITE_USUARIO);
    expect(calls.length).toBe(10);
    const d2 = deps({ fetchImpl: f });
    for (let i = 1; i <= 8; i++) last = (await handleShoppingMessage({ userId: "u2", externalId: `x${i}`, text: MAC }, d2))!.resposta;
    expect(last).toContain("restam só 2");
  });
  test("falha que não chamou a API não desconta; falha que chamou desconta", async () => {
    const q = createMemoryQuotaStore();
    const throwing = (async () => { throw new TypeError("rede"); }) as unknown as typeof fetch;
    const r = (await handleShoppingMessage({ userId: "u1", externalId: "e1", text: MAC }, deps({ quota: q, fetchImpl: throwing })))!.resposta;
    expect(r).toContain(MSG_FALHA); // tentou (2 chamadas) → conta
    expect(await q.userRemaining("u1", "2026-10")).toBe(9);
    const q2 = createMemoryQuotaStore();
    await handleShoppingMessage({ userId: "u1", externalId: null, text: MAC }, deps({ quota: q2 }));
    expect(await q2.userRemaining("u1", "2026-10")).toBe(10);
  });
  test("limite global com mensagem própria", async () => {
    const q = createMemoryQuotaStore();
    const { f } = fakeFetch();
    for (let i = 0; i < GLOBAL_MONTHLY_LIMIT; i++) await handleShoppingMessage({ userId: `g${Math.floor(i / 10)}`, externalId: `e${i}`, text: MAC }, deps({ quota: q, fetchImpl: f }));
    expect((await handleShoppingMessage({ userId: "novo", externalId: "z", text: MAC }, deps({ quota: q, fetchImpl: f })))!.resposta).toBe(MSG_LIMITE_GLOBAL);
  });
  test("desligado ou não é compra: não intercepta finanças", async () => {
    expect((await handleShoppingMessage({ userId: "u1", externalId: "e", text: MAC }, deps({ enabled: false })))!.resposta).toContain("em preparação");
    expect(await handleShoppingMessage({ userId: "u1", externalId: "e", text: "comprei MacBook por 8 mil em 10x" }, deps())).toBeNull();
  });
});
