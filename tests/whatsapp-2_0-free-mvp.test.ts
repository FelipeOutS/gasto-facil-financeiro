import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { comparisonNames, detectResearchIntent, namedUserPrices, parseInstallmentOffer, parseUserPriceCents, researchConcepts } from "../src/server/whatsapp-research-core";
import { runResearchMvp } from "../src/server/whatsapp-research-mvp";
import { createWikimediaSource, type WikimediaArticle, type WikimediaSource } from "../src/server/whatsapp-wikimedia.server";

const article = (title: string): WikimediaArticle => ({ title, extract: `${title} é uma descrição documentada em uma fonte pública, sem preço nem indicação de estoque.`, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`, language: "pt" });
const source: WikimediaSource = { lookup: async topic => topic.includes("S26") || topic.includes("18") || topic === "QLED" ? null : article(topic) };
const run = (text: string, context: Awaited<ReturnType<typeof runResearchMvp>>["context"] = null, customSource = source) =>
  runResearchMvp({ text, context, source: customSource, budget: async price => `Orçamento lido: ${price} centavos. Não é saldo bancário.`, signal: AbortSignal.timeout(1000), now: new Date("2026-10-04T12:00:00Z") });

test("explicações consultam somente fonte aberta; ausência não vira fato inventado", async () => {
  for (const text of ["o que é CDI?", "o que é IPCA?", "o que significa IP68?", "o que é processador ARM?", "o que significa inverter?"]) {
    expect(detectResearchIntent(text, false)).toBe("general");
    const result = await run(text);
    expect(result?.reply).toContain("Wikipédia");
    expect(result?.reply).toContain("https://pt.wikipedia.org/wiki/");
    expect(result?.lookups).toBe(1);
  }
  expect(researchConcepts("qual a diferença entre OLED e QLED?")).toHaveLength(2);
  const partial = await run("qual a diferença entre OLED e QLED?");
  expect(partial?.reply).toContain("Não encontrei fonte Wikimedia suficiente para QLED");
  const unavailable = await run("o que é CDI?", null, { lookup: async () => null });
  expect(unavailable?.reply).toContain("Não encontrei um artigo confiável");
});

test("produtos sem artigo suficiente não recebem especificações ou preço fictícios", async () => {
  const result = await run("compare Galaxy S26 e iPhone 18");
  expect(result?.reply).toContain("Não encontrei informação aberta suficiente");
  expect(result?.context?.products.map(p => p.priceCents)).toEqual([null, null]);
  expect(result?.context?.products.map(p => p.priceOrigin)).toEqual([null, null]);
  expect((await run("procure todas as ofertas de notebook até 4 mil"))?.lookups).toBe(0);
  expect((await run("quanto custa?"))?.reply).toContain("Não consulto preços ou estoque atuais");
});

test("WA-HOMO-003: compara dois ou três modelos e resolve o terceiro ordinal", async () => {
  expect(comparisonNames("compare Galaxy e Motorola")).toEqual(["Galaxy", "Motorola"]);
  expect(comparisonNames("compare Galaxy, Motorola e iPhone")).toEqual(["Galaxy", "Motorola", "iPhone"]);
  expect(comparisonNames("compare Galaxy e Motorola e iPhone")).toEqual(["Galaxy", "Motorola", "iPhone"]);
  expect(comparisonNames("compare Galaxy S25 e Motorola Edge 50 e iPhone 16")).toEqual(["Galaxy S25", "Motorola Edge 50", "iPhone 16"]);
  expect(comparisonNames("compare Bose QuietComfort e Ultra e iPhone 16")).toEqual([]);
  const ambiguous = await run("compare Bose QuietComfort e Ultra e iPhone 16");
  expect(ambiguous?.reply).toContain("separe dois ou três modelos");
  expect(ambiguous?.lookups).toBe(0);

  const compared = await run("compare Galaxy, Motorola e iPhone");
  expect(compared?.context?.products.map(p => p.name)).toEqual(["Galaxy", "Motorola", "iPhone"]);
  expect(compared?.lookups).toBe(3);
  const priced = await run("o terceiro está 1899", compared?.context);
  expect(priced?.context?.products[2].priceCents).toBe(189900);
  expect(priced?.context?.products[2].priceOrigin).toBe("USER_PROVIDED");
  expect(priced?.context?.products.slice(0, 2).every(p => p.priceCents === null)).toBe(true);
  expect((await run("o terceiro em 10x?", priced?.context))?.reply).toContain("total R$ 1.899,00");
});

test("preço informado, link não aberto, comparação e origem persistida no contexto", async () => {
  expect(namedUserPrices("Galaxy está 1899 e Motorola 1699. Qual vale mais a pena?")).toHaveLength(2);
  expect(parseUserPriceCents("o notebook está 3.799")).toBe(379900);
  const compared = await run("Galaxy está 1899 e Motorola 1699. Qual vale mais a pena?");
  expect(compared?.reply).toContain("R$ 200,00");
  expect(compared?.reply).toContain("preços que você informou");
  expect(compared?.context?.products.map(p => p.priceOrigin)).toEqual(["USER_PROVIDED", "USER_PROVIDED"]);
  expect(compared?.lookups).toBe(0);
  expect((await run("qual é mais barato?", compared?.context))?.reply).toContain("motorola custa");
  expect((await run("onde está mais barato?", compared?.context))?.lookups).toBe(0);
  expect((await run("qual tem tela melhor?", compared?.context))?.reply).toContain("dados comparáveis suficientes");

  const single = await run("pesquise Galaxy S25");
  const withPrice = await run("https://loja.example/p/123 está 1899", single?.context);
  expect(withPrice?.context?.products[0].priceOrigin).toBe("USER_PROVIDED");
  expect(withPrice?.reply).toContain("preço informado por você");
  expect(withPrice?.lookups).toBe(0);
});

test("orçamento e parcelas usam somente preço do usuário e aritmética determinística", async () => {
  const result = await run("Galaxy está 1899 e Motorola 1699. Qual vale mais a pena?");
  expect((await run("o primeiro cabe no meu orçamento?", result?.context))?.reply).toContain("Orçamento lido: 189900 centavos. Não é saldo bancário.");
  const installments = await run("o segundo em 12 vezes?", result?.context);
  expect(installments?.reply).toContain("total R$ 1.699,00");
  expect(installments?.reply).toContain("sem juros");
  const noPrice = await run("pesquise Galaxy S25");
  expect((await run("e em 10x?", noPrice?.context))?.reply).toContain("Informe o preço");
});

test("WA-HOMO-004: valor de parcela informado pelo usuário não vira preço integral", async () => {
  const cases: Array<[string, number, number, number]> = [
    ["10x de 199", 10, 19900, 199000],
    ["12x de 250", 12, 25000, 300000],
    ["3x de 33,33", 3, 3333, 9999],
    ["10x de R$ 199,90", 10, 19990, 199900],
  ];
  const product = await run("pesquise Galaxy S25");
  for (const [message, count, installmentCents, totalCents] of cases) {
    expect(parseInstallmentOffer(message)).toEqual({ count, installmentCents, totalCents });
    expect(parseUserPriceCents(message)).toBeNull();
    expect(detectResearchIntent(message, false)).toBeNull();
    const result = await run(message, product?.context);
    expect(result?.reply).toContain(`${count}x de`);
    expect(result?.reply).toContain("condição informada por você");
    expect(result?.reply).toContain("nem alterei o preço salvo");
    expect(result?.contextChanged).toBe(false);
    expect(result?.context).toEqual(product?.context);
    expect(result?.lookups).toBe(0);
  }
  const comparison = await run("compare Galaxy e Motorola");
  const ambiguous = await run("10x de 199", comparison?.context);
  expect(ambiguous?.reply).toContain("diga a qual produto se refere");
  expect(ambiguous?.context).toEqual(comparison?.context);
  expect(parseInstallmentOffer("em 10x")).toBeNull();
  expect(parseInstallmentOffer("divide em 10x")).toBeNull();
  expect((await run("em 10x", product?.context))?.reply).toContain("Informe o preço");
  expect((await run("divide em 10x", product?.context))?.reply).toContain("Informe o preço");
});

test("adaptador Wikimedia usa Action API oficial, cache temporário e falha sem fallback", async () => {
  const calls: string[] = [];
  let now = 1000;
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect(new URL(url).hostname).toBe("pt.wikipedia.org");
    expect(String((init?.headers as Record<string, string>)["User-Agent"])).toContain("GastoInteligenteResearch");
    const query = new URL(url).searchParams;
    if (query.get("list") === "search") return new Response(JSON.stringify({ query: { search: [{ ns: 0, title: "Grau de proteção IP" }] } }));
    return new Response(JSON.stringify({ query: { pages: [{ title: "Grau de proteção IP", fullurl: "https://pt.wikipedia.org/wiki/Grau_de_prote%C3%A7%C3%A3o_IP", extract: "Grau de proteção IP é um padrão que define níveis de proteção para equipamentos elétricos." }] } }));
  }) as typeof fetch;
  const adapter = createWikimediaSource(fake, () => now);
  expect((await adapter.lookup("Grau de proteção IP", AbortSignal.timeout(1000)))?.title).toBe("Grau de proteção IP");
  expect(calls).toHaveLength(2);
  expect(calls[0]).not.toContain("srwhat=title");
  await adapter.lookup("Grau de proteção IP", AbortSignal.timeout(1000));
  expect(calls).toHaveLength(2);
  now += 60 * 60_000 + 1;
  await adapter.lookup("Grau de proteção IP", AbortSignal.timeout(1000));
  expect(calls).toHaveLength(4);
  const failure = createWikimediaSource((async () => new Response("{}", { status: 503 })) as typeof fetch);
  expect(failure.lookup("CDI", AbortSignal.timeout(1000))).rejects.toThrow("wikimedia_unavailable");
});

test("caminho do webhook não importa nem ativa provider pago", async () => {
  const paths = ["../src/server/whatsapp.server.ts", "../src/server/whatsapp-research.server.ts", "../src/server/whatsapp-research-mvp.ts", "../src/server/whatsapp-wikimedia.server.ts"];
  for (const path of paths) {
    const file = await readFile(new URL(path, import.meta.url), "utf8");
    expect(file).not.toContain("openAiResearchProvider");
    expect(file).not.toContain("whatsapp-research-provider.server");
    expect(file).not.toContain("OPENAI_API_KEY");
    expect(file).not.toContain("api.openai.com");
  }
});
