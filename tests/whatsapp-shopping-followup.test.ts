// Continuações do Assistente de Compras — mocks apenas (sem SerpApi, sem banco, sem Meta).
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { handleWhatsAppShopping } from "../src/server/shopping/whatsapp-shopping.server";
import { createMemoryQuotaStore } from "../src/server/shopping/shopping-quota";
import { createMemoryContextStore, parseOffersJson } from "../src/server/shopping/shopping-context";
import { detectShoppingFollowup, resolverVariante, dividirCentavos, mesesAte, MSG_CONTEXTO_EXPIRADO, ROTULO_SIMULACAO } from "../src/server/shopping/shopping-followup";
import { AVISO_APERTO } from "../src/server/shopping/capacidade-compra";
import { detectShoppingIntent } from "../src/server/shopping/shopping-intent";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const T1 = "5511900000001";
const T2 = "5511900000002";
const ENV = { WHATSAPP_SHOPPING_ENABLED: "true", SERPAPI_API_KEY: "ficticia", WHATSAPP_SHOPPING_PILOT_USER_IDS: `${U1},${U2}` };
const AIR = { shopping_results: [
  { title: "Apple MacBook Air M4 16GB 256GB", source: "Loja A", extracted_price: 7999.99, link: "https://lojaa.com.br/air" },
  { title: "MacBook Air M4 16GB", source: "Loja B", extracted_price: 8299, link: "https://lojab.com.br/air" },
] };
const PRO = { shopping_results: [{ title: "Apple MacBook Pro M4 16GB", source: "Loja P", extracted_price: 12999, link: "https://lojap.com.br/pro" }] };

function harness(opts: { renda?: number; fin?: "erro" } = {}) {
  let t = new Date("2026-10-13T15:00:00Z");
  const now = () => t;
  const urls: string[] = [];
  const fetchImpl = (async (u: string) => {
    urls.push(String(u));
    return new Response(JSON.stringify(new URL(String(u)).searchParams.get("q")!.includes("pro") ? PRO : AIR));
  }) as unknown as typeof fetch;
  const quota = createMemoryQuotaStore();
  const contexts = createMemoryContextStore(now);
  const renda = opts.renda ?? 1_000_000;
  const loadFinance = async () => {
    if (opts.fin === "erro") throw new Error("x");
    return { hoje: "2026-10-13", rendaPorMes: renda ? { "2026-09": renda, "2026-08": renda, "2026-07": renda } : {},
      compromissos: [{ id: "aluguel", tipo: "fixa" as const, valorMensalCents: 600_000 }], guardadoCents: 50_000_000 };
  };
  let n = 0;
  const send = (text: string, user = U1, phone = T1, ext?: string) =>
    handleWhatsAppShopping({ userId: user, phone, externalId: ext ?? `m${++n}`, text },
      { env: ENV, fetchImpl, quota, contexts, loadFinance, now, isEntitled: async () => true });
  return { send, urls, quota, contexts, advance: (ms: number) => { t = new Date(t.getTime() + ms); } };
}
const BUSCA = "quero comprar macbook air m4 16gb";

describe("detecção de continuação", () => {
  test("frases de continuação", () => {
    expect(detectShoppingFollowup("e em 10x?")).toEqual({ kind: "parcelas", n: 10 });
    expect(detectShoppingFollowup("E em 12 vezes?")).toEqual({ kind: "parcelas", n: 12 });
    expect(detectShoppingFollowup("se eu esperar até dezembro, quanto preciso guardar por mês?")).toEqual({ kind: "guardar", mes: 12 });
    expect(detectShoppingFollowup("qual loja?")).toEqual({ kind: "loja" });
    expect(detectShoppingFollowup("e o MacBook Pro?")).toEqual({ kind: "variante", termo: "macbook pro" });
  });
  test("lançamentos, ações e outros fluxos nunca são continuação", () => {
    for (const t of ["comprei um notebook em 10x", "paguei 10x", "gastei 89,90", "confirmar", "cancelar", "ajustar", "e a fatura?",
      "e o cartão?", "e a conta de luz?", "e o lembrete?", "e o boleto?", "e no mercado?", "sim", "não", "10"])
      expect(detectShoppingFollowup(t)).toBeNull();
    expect(detectShoppingIntent("comprei um notebook em 10x")).toBeNull();
  });
  test("variante: troca chip/modelo; ambígua pede confirmação", () => {
    expect(resolverVariante("macbook air m4 16gb", "m5")).toBe("macbook air m5 16gb");
    expect(resolverVariante("macbook air m4 16gb", "pro")).toBe("macbook pro m4 16gb");
    expect(resolverVariante("macbook air m4 16gb", "macbook pro")).toBe("macbook pro");
    expect(resolverVariante("macbook air m4 16gb", "outro")).toBeNull();
  });
  test("centavos e meses", () => {
    expect(dividirCentavos(799_999, 12)).toEqual({ maior: 66_667, menor: 66_666, qtdMaior: 7 });
    expect(7 * 66_667 + 5 * 66_666).toBe(799_999);
    expect(mesesAte("2026-10-13", 12)).toBe(2);
    expect(mesesAte("2026-10-13", 3)).toBe(5);
    expect(mesesAte("2026-10-13", 10)).toBe(12);
  });
  test("contexto inválido ou URL suspeita é descartado", () => {
    expect(parseOffersJson([{ title: "x", store: "L", priceCents: 100, url: "http://1.2.3.4/a" }])).toBeNull();
    expect(parseOffersJson([{ title: "x", store: "L", priceCents: -1, url: "https://a.com.br" }])).toBeNull();
    expect(parseOffersJson("lixo")).toBeNull();
  });
});

describe("fluxo com contexto", () => {
  test("'e em 10x' não chama API nem mexe na cota", async () => {
    const h = harness();
    const a = await h.send(BUSCA);
    expect(a?.resposta).toContain("9/10");
    expect(h.urls.length).toBe(1);
    const b = await h.send("e em 10x?");
    expect(h.urls.length).toBe(1);
    expect(await h.quota.userRemaining(U1, "2026-10")).toBe(9);
    expect(b?.resposta).toContain("9x de R$ 800,00 + 1x de R$ 799,99");
    expect(b?.resposta).toContain(ROTULO_SIMULACAO);
    expect(b?.resposta).toContain("nada foi descontado");
  });
  test("12x divide centavos e alerta acima de 30% da folga", async () => {
    const h = harness({ renda: 700_000 }); // folga 1.000,00
    await h.send(BUSCA);
    const r = (await h.send("e em 12 vezes?"))!.resposta;
    expect(r).toContain("7x de R$ 666,67 + 5x de R$ 666,66");
    expect(r).toContain(AVISO_APERTO);
  });
  test("esperar até dezembro: valor mensal, sem criar meta nem usar guardado", async () => {
    const h = harness();
    await h.send(BUSCA);
    const r = (await h.send("se eu esperar até dezembro, quanto preciso guardar por mês?"))!.resposta;
    expect(r).toContain("2 meses");
    expect(r).toContain("R$ 4.000,00 por mês");
    expect(r).toContain(AVISO_APERTO); // 4.000 > 30% de 4.000 de folga
    expect(r).toContain("não criei meta");
    expect(r).not.toMatch(/use (seu )?dinheiro guardado/i);
  });
  test("sem renda → não afirma poder de compra; finanças indisponíveis → avisa limite", async () => {
    const h = harness({ renda: 0 });
    await h.send(BUSCA);
    expect((await h.send("e em 10x?"))!.resposta).toContain("Não consigo avaliar com segurança");
    const h2 = harness({ fin: "erro" });
    await h2.send(BUSCA);
    expect((await h2.send("e em 10x?"))!.resposta).toContain("Não consigo avaliar com segurança seu orçamento agora.");
  });
  test("qual loja repete fontes com horário, sem busca", async () => {
    const h = harness();
    await h.send(BUSCA);
    const r = (await h.send("qual loja?"))!.resposta;
    expect(r).toContain("Loja A"); expect(r).not.toContain("https://"); expect(r).toContain("link 1"); expect(r).toContain("coletado em");
    expect(h.urls.length).toBe(1);
  });
  test("'e o Pro' é nova busca com nova cota, sem preço do Air", async () => {
    const h = harness();
    await h.send(BUSCA);
    const r = (await h.send("e o pro?"))!.resposta;
    expect(h.urls.length).toBe(2);
    expect(new URL(h.urls[1]).searchParams.get("q")).toBe("macbook pro m4 16gb");
    expect(r).toContain("Loja P"); expect(r).not.toContain("Loja A"); expect(r).toContain("8/10");
    expect((await h.send("qual loja?"))!.resposta).toContain("Loja P"); // contexto atualizado
  });
  test("variante ambígua pede confirmação sem buscar", async () => {
    const h = harness();
    await h.send(BUSCA);
    expect((await h.send("e o outro?"))!.resposta).toContain("quero comprar outro");
    expect(h.urls.length).toBe(1);
  });
  test("TTL 20 min: depois disso exige nova pesquisa", async () => {
    const h = harness();
    await h.send(BUSCA);
    h.advance(21 * 60 * 1000);
    expect((await h.send("e em 10x?"))!.resposta).toBe(MSG_CONTEXTO_EXPIRADO);
    expect((await h.send("qual loja?"))!.resposta).toBe(MSG_CONTEXTO_EXPIRADO);
  });
  test("outro telefone ou outro usuário não reaproveita a busca", async () => {
    const h = harness();
    await h.send(BUSCA);
    expect(await h.send("e em 10x?", U1, T2)).toBeNull();
    expect(await h.send("e em 10x?", U2, T1)).toBeNull();
  });
  test("sem contexto, frase curta segue para o roteador normal", async () => {
    const h = harness();
    expect(await h.send("e em 10x?")).toBeNull();
    expect(h.urls.length).toBe(0);
  });
  test("webhook repetido da busca não chama de novo; continuação repetida não desconta", async () => {
    const h = harness();
    await h.send(BUSCA, U1, T1, "w1");
    await h.send(BUSCA, U1, T1, "w1");
    await h.send("e em 10x?", U1, T1, "w2");
    await h.send("e em 10x?", U1, T1, "w2");
    expect(h.urls.length).toBe(1);
    expect(await h.quota.userRemaining(U1, "2026-10")).toBe(9);
  });
  test("limite de 10 vale para variantes", async () => {
    const h = harness();
    await h.send(BUSCA);
    for (let i = 0; i < 9; i++) await h.send(i % 2 ? "e o air?" : "e o pro?");
    expect(h.urls.length).toBe(10);
    expect((await h.send("e o pro?"))!.resposta).toContain("10 buscas");
    expect(h.urls.length).toBe(10);
  });
  test("áudio transcrito (fixture) passa pelo mesmo caminho sem serviço externo", async () => {
    const h = harness();
    await h.send("quero comprar macbook air m4 16gb");
    expect((await h.send("e em dez vezes"))).toBeNull(); // por extenso não é reconhecido: segue fluxo normal
    expect((await h.send("e em 10 vezes"))!.resposta).toContain("1x de R$ 799,99");
  });
  test("flag OFF em todos os estados: nada lido, nada chamado", async () => {
    const contexts = createMemoryContextStore();
    let reads = 0;
    const spy = { get: async () => { reads++; return null; }, save: contexts.save };
    for (const t of [BUSCA, "e em 10x?", "qual loja?", "e o pro?"])
      expect(await handleWhatsAppShopping({ userId: U1, phone: T1, externalId: "x", text: t }, { env: {}, contexts: spy })).toBeNull();
    expect(reads).toBe(0);
  });
  test("roteador passa telefone e mantém shopping após sessões pendentes", () => {
    const src = readFileSync("src/server/whatsapp.server.ts", "utf8");
    expect(src).toContain("handleWhatsAppShopping({ userId, phone: msg.telefone,");
    const i = src.indexOf("handleWhatsAppShopping({");
    expect(src.slice(i - 400, i)).toContain("!sessao && decisao === \"outro\" && !msg.image && !msg.document");
  });
  test("contexto não guarda dados financeiros", async () => {
    const h = harness();
    await h.send(BUSCA);
    const saved = JSON.stringify([...h.contexts.raw.values()].map(({ savedAt: _s, ...e }) => e));
    expect(saved).not.toMatch(/renda|folga|guardado|600000|1000000/);
  });
});
