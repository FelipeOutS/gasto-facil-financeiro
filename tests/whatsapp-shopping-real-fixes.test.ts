// Correções a partir da 1ª pesquisa real (títulos copiados do print; fixture estática, sem rede).
import { test, expect, describe } from "bun:test";
import { parseOffers } from "../src/server/shopping/serpapi-shopping";
import { formatOffers } from "../src/server/shopping/shopping-assistant";
import { compativel, rotuloLink, rotuloVariante, variantesMisturadas, NAO_NOVO, norm } from "../src/server/shopping/offer-specs";
import { responderFollowupLocal } from "../src/server/shopping/shopping-followup";
// @ts-expect-error módulo .mjs sem tipos
import * as S from "../scripts/serpapi-shopping-smoke.mjs";

const G = (n: number) => `https://www.google.com.br/search?ibp=oshop&q=macbook&prds=${n}`;
const SHOPEE = "Apple Macbook Air M4 16GB RAM 256GB SSD Tela 13 e 15 Polegadas Novo Lacrado Garantia Apple";
const ML512 = "Computador Portátil Apple Macbook Air 13 M4 16 GB Ram 512 G Azul Cielo";
const ML_OPEN = "Apple Macbook air 13 M4 16gb Ram 256gb Ssd Prateado (Novo com caixa aberta)";
const REAL = { shopping_results: [
  { title: SHOPEE, source: "Shopee", price: "R$ 7.249,00", extracted_price: 7249, product_link: G(1) },
  { title: ML512, source: "Mercado Livre", price: "R$ 7.802,18", extracted_price: 7802.18, product_link: G(2) },
  { title: ML_OPEN, source: "Mercado Livre", price: "R$ 8.200,00", extracted_price: 8200, product_link: G(3) },
] };
const Q = "macbook air m4 16gb";
const AT = "2026-10-13T15:00:00Z";

describe("3 anúncios reais — app", () => {
  test("Shopee 13 e 15 recusado; caixa aberta recusada; 13/512 preservado", () => {
    const o = parseOffers(REAL, Q, false)!;
    expect(o.map((x) => x.store)).toEqual(["Mercado Livre"]);
    expect(o[0].priceCents).toBe(780_218);
    expect(rotuloVariante(o[0].title)).toBe('Tela 13" · SSD 512GB');
  });
  test("link Google é rotulado 'Ver no Google Shopping', loja separada", () => {
    const o = parseOffers(REAL, Q, false)!;
    const txt = formatOffers(Q, o, AT);
    expect(txt).toContain("Ver no Google Shopping: https://www.google.com.br/search?ibp=oshop");
    expect(txt).toContain("R$ 7.802,18 — Loja: Mercado Livre");
    expect(txt).not.toContain("Link direto da loja");
    expect(txt).toContain("12:00"); expect(txt).toContain("Frete, estoque, juros e garantia");
  });
  test("URL HTTPS do lojista é preferida e rotulada como direta", () => {
    const o = parseOffers({ shopping_results: [{ title: ML512, source: "Loja X", extracted_price: 7000, link: "https://www.lojax.com.br/p/1", product_link: G(9) }] }, Q, false)!;
    expect(o[0].url).toBe("https://www.lojax.com.br/p/1");
    expect(rotuloLink(o[0].url)).toBe("Link direto da loja");
  });
  test("condições não-novas recusadas mesmo com 'novo'; novos genuínos aceitos", () => {
    for (const t of ["Novo com caixa aberta", "NOVO - Open Box", "open-box", "Unsealed", "Recondicionado", "refurbished", "Renewed", "Seminovo", "semi-novo", "Usado", "Reembalado", "Mostruário", "vitrine", "caixa aberta"])
      expect(NAO_NOVO.test(norm(`MacBook Air M4 16GB ${t}`))).toBe(true);
    for (const t of ["Novo Lacrado", "Lacrado com garantia", "Novo", "Caixa original lacrada"]) expect(NAO_NOVO.test(norm(t))).toBe(false);
    const o = parseOffers({ shopping_results: [{ title: "MacBook Air 13 M4 16GB 256GB", source: "L", extracted_price: 7000, link: "https://l.com.br/x", extensions: ["Caixa aberta"] }] }, Q, false);
    expect(o).toEqual([]);
  });
  test("variantes: Pro/M3/8GB recusados; SSD/tela pedidos exigem evidência e não misturam", () => {
    for (const t of ["MacBook Pro M4 16GB 512GB", "MacBook Air M3 16GB 256GB", "MacBook Air M4 8GB 256GB", "MacBook Air M4 16GB 256GB/512GB"]) expect(compativel(t, Q)).toBe(false);
    expect(compativel(ML512, "macbook air m4 16gb 256gb")).toBe(false);
    expect(compativel(ML512, "macbook air m4 16gb 512gb")).toBe(true);
    expect(compativel("MacBook Air M4 16GB", "macbook air m4 16gb 512gb")).toBe(false); // sem evidência
    expect(compativel(ML512, 'macbook air m4 16gb 15"')).toBe(false);
  });
  test("variantes misturadas: não chama de 'mais barato' e pede tela/SSD", () => {
    const offers = [
      { title: "MacBook Air 13 M4 16GB 256GB", store: "A", priceCents: 700_000, url: "https://a.com.br/1" },
      { title: ML512, store: "B", priceCents: 780_218, url: G(2) },
    ];
    expect(variantesMisturadas(offers.map((o) => o.title))).toBe(true);
    const txt = formatOffers(Q, offers, AT);
    expect(txt).toContain("não digo qual é o mais barato");
    expect(txt).toContain('Tela 13" · SSD 256GB'); expect(txt).toContain('Tela 13" · SSD 512GB');
  });
  test("sem ofertas coerentes não inventa", () => {
    expect(formatOffers(Q, parseOffers({ shopping_results: [REAL.shopping_results[0], REAL.shopping_results[2]] }, Q, false)!, AT)).toContain("Não encontrei ofertas confiáveis");
  });
  test("'qual loja?' do contexto mostra rótulo correto sem custo", () => {
    const r = responderFollowupLocal({ kind: "loja" }, { query: Q, offers: [{ title: ML512, store: "Mercado Livre", priceCents: 780_218, url: G(2) }], collectedAt: AT, expired: false }, "2026-10-13", null);
    expect(r).toContain("Loja: Mercado Livre — R$ 7.802,18"); expect(r).toContain("Ver no Google Shopping");
  });
});

describe("3 anúncios reais — script local", () => {
  test("mesmo resultado no standalone, sem rede", async () => {
    const seq = [{ total_searches_left: 9 }, REAL];
    const urls: string[] = [];
    const f = async (u: string) => { urls.push(u); return new Response(JSON.stringify(seq.shift())); };
    const r = await S.run({ argv: ["--execute"], env: { SERPAPI_API_KEY: "b".repeat(64) }, fetchImpl: f, now: () => new Date(AT) });
    const out = r.lines.join("\n");
    expect(urls.length).toBe(2);
    expect(out).toContain("R$ 7.802,18 — Loja: Mercado Livre");
    expect(out).toContain('Tela 13" · SSD 512GB');
    expect(out).toContain("Ver no Google Shopping");
    expect(out).not.toContain("Shopee"); expect(out).not.toContain("8.200");
    expect(out).not.toContain("Link direto da loja");
    expect(S.isNotNew(ML_OPEN)).toBe(true);
    expect(S.isExactVariant(SHOPEE)).toBe(false);
  });
});
