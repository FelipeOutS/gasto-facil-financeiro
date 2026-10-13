// Local print fixture: no network, database, Meta or secrets.
import { test, expect } from "bun:test";
import { handleWhatsAppShopping } from "../src/server/shopping/whatsapp-shopping.server";
import { detectShoppingIntent } from "../src/server/shopping/shopping-intent";
import { detectShoppingFollowup, MSG_CONTEXTO_EXPIRADO } from "../src/server/shopping/shopping-followup";
import { createMemoryQuotaStore } from "../src/server/shopping/shopping-quota";
import { createMemoryContextStore } from "../src/server/shopping/shopping-context";
import { estimarCapacidadeCompra, resumoCapacidade, AVISO_APERTO } from "../src/server/shopping/capacidade-compra";

const U = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const TEXT = "Quero comprar um MacBook Air M4 de 16 GB. Pesquise os melhores preços e veja se cabe no meu orçamento.";
const urls = [1, 2, 3].map((n) => `https://www.google.com.br/search?ibp=oshop&q=macbook&prds=${n}${"1234567890".repeat(50)}`);
const fixture = { shopping_results: [
  { title: "Apple MacBook Air M4 16GB RAM 13 Polegadas 256GB SSD Novo Lacrado Garantia", source: "Next Computer", extracted_price: 8900, product_link: urls[0] },
  { title: "Computador Apple MacBook Air M4 16GB 13 256GB SSD", source: "B&W Store", extracted_price: 9490, product_link: urls[1] },
  { title: "Notebook Apple MacBook Air M4 16GB 13 256GB SSD Prateado", source: "Mercado Livre", extracted_price: 11199, product_link: urls[2] },
] };
const fin = { hoje: "2026-10-13", mesesAtivos: ["2026-08", "2026-09"], rendaPorMes: { "2026-08": 449250, "2026-09": 449250 }, compromissos: [{ id: "c", tipo: "fixa" as const, valorMensalCents: 39538 }] };
function harness() {
  let clock = new Date("2026-10-13T02:52:00Z");
  let calls = 0, reads = 0, count = 0;
  const quota = createMemoryQuotaStore();
  const contexts = createMemoryContextStore(() => clock);
  const send = (text: string, userId = U, phone = "5511900000001", id = `m${++count}`, entitled = true) => handleWhatsAppShopping({ userId, phone, externalId: id, text }, {
    env: { WHATSAPP_SHOPPING_ENABLED: "true", WHATSAPP_SHOPPING_PILOT_USER_IDS: `${U},${OTHER}`, SERPAPI_API_KEY: "fixture-only" },
    now: () => clock, quota, contexts, isEntitled: async () => entitled,
    fetchImpl: (async (url: string | URL | Request) => { calls++; expect(new URL(String(url)).searchParams.get("q")).toBe("macbook air m4 16gb"); return new Response(JSON.stringify(fixture)); }) as typeof fetch,
    loadFinance: async () => { reads++; return fin; },
  });
  return { send, quota, calls: () => calls, reads: () => reads, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

test("print input strips instructions and preserves exact model/RAM/specs", () => {
  expect(detectShoppingIntent(TEXT)).toEqual({ query: "macbook air m4 16gb", wantsBudget: true, wantsUsed: false });
  for (const suffix of [" onde está mais barato", " me mostra preços", " por favor", ". Pesquise os melhores preços"]) {
    expect(detectShoppingIntent(`quero comprar macbook air m4 16gb 512gb 13.6 polegadas${suffix}`)?.query).toBe("macbook air m4 16gb 512gb 13.6 polegadas");
  }
});
test("initial print reply has compact offers, no URLs, partial history and one illustrative scenario", async () => {
  const h = harness();
  const r = await h.send(TEXT);
  const body = r?.resposta ?? "";
  expect(body.length).toBeGreaterThanOrEqual(600);
  expect(body.length).toBeLessThanOrEqual(950);
  expect(body).not.toMatch(/https?:|ibp=oshop|pesquise|\*\*/i);
  expect(body).toContain("*1. R$ 8.900,00* — Next Computer");
  expect(body).toContain("*3. R$ 11.199,00* — Mercado Livre");
  expect(body).toContain("13″ · 256 GB");
  expect(body).toContain("R$ 4.097,12/mês");
  expect(body).toContain("baixa confiança");
  expect(body).toContain("Histórico parcial (2/3 meses)");
  expect(body).not.toMatch(/: cabe|pode comprar/i);
  expect(body).toContain("12x de até R$ 741,67");
  expect(body).toContain("não é oferta de parcelamento da loja");
  expect(await h.quota.userRemaining(U, "2026-10")).toBe(9);
});
test("requested links isolate one real URL; store list has none; no calls/reads/quota on links", async () => {
  const h = harness(); await h.send(TEXT);
  for (const [command, index] of [["link 1", 0], ["link 3", 2], ["ver oferta 1", 0], ["manda link 2", 1]] as const) {
    const r = (await h.send(command))?.resposta ?? "";
    expect(r).toContain(urls[index]);
    urls.forEach((url, n) => { if (n !== index) expect(r).not.toContain(url); });
    expect(r).toContain("Ver no Google Shopping");
    expect(r).toContain("12/10, 23:52");
  }
  for (const command of ["qual loja?", "links"]) expect((await h.send(command))?.resposta).not.toContain("https://");
  expect(h.calls()).toBe(1); expect(h.reads()).toBe(1);
  expect(await h.quota.userRemaining(U, "2026-10")).toBe(9);
});
test("links without context or another user/phone are ignored; denied entitlement reveals nothing", async () => {
  const h = harness(); expect(await h.send("link 1")).toBeNull();
  await h.send(TEXT);
  expect(await h.send("link 1", OTHER)).toBeNull();
  expect(await h.send("link 1", U, "5511900000002")).toBeNull();
  expect((await h.send("link 1", U, "5511900000001", "denied", false))?.resposta).not.toContain(urls[0]);
  expect(h.calls()).toBe(1);
});
test("20 minute context not refreshed by links; duplicate search does not call API", async () => {
  const h = harness(); await h.send(TEXT, U, undefined, "duplicate"); await h.send(TEXT, U, undefined, "duplicate");
  h.advance(20 * 60 * 1000); expect((await h.send("link 1"))?.resposta).toContain(urls[0]);
  h.advance(1); expect((await h.send("link 3"))?.resposta).toBe(MSG_CONTEXTO_EXPIRADO);
  expect(h.calls()).toBe(1); expect(await h.quota.userRemaining(U, "2026-10")).toBe(9);
});
test("expenses, groceries, reminders and short followups never start research", () => {
  for (const t of ["comprei macbook em 10x", "paguei 8900", "gastei 50 no mercado", "quero comprar arroz", "me lembra de comprar macbook", "link 1", "ver oferta 3", "em 10x?"]) expect(detectShoppingIntent(t)).toBeNull();
  for (const t of ["comprei link 1", "paguei oferta 1", "gastei 50", "lembrete link 2"]) expect(detectShoppingFollowup(t)).toBeNull();
});
test("compact summary preserves threshold exactly; insufficient data never exposes folga", () => {
  const at = estimarCapacidadeCompra({ ...fin, precoCents: 1474956, parcelas: [12] });
  expect(at.cenarios[0].aperta).toBe(false);
  const above = estimarCapacidadeCompra({ ...fin, precoCents: 1474957, parcelas: [12] });
  expect(above.cenarios[0].aperta).toBe(true); expect(resumoCapacidade(above)).toContain(AVISO_APERTO);
  const insufficient = estimarCapacidadeCompra({ ...fin, inconclusivo: true, precoCents: 890000 });
  expect(resumoCapacidade(insufficient)).not.toMatch(/Folga|4\.097/);
  expect(resumoCapacidade(insufficient)).toContain("Histórico parcial");
});