// Piloto do Assistente de Compras: allowlist por userId (fictícios), sem rede.
import { test, expect, describe } from "bun:test";
import { handleWhatsAppShopping, isShoppingPilotUser } from "../src/server/shopping/whatsapp-shopping.server";
import { createMemoryQuotaStore } from "../src/server/shopping/shopping-quota";
import { createMemoryContextStore } from "../src/server/shopping/shopping-context";

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const TXT = "quero comprar um macbook air m4 16gb";
const body = { shopping_results: [{ title: "Apple MacBook Air M4 16GB 256GB", source: "Loja A", extracted_price: 7999, link: "https://lojaa.com.br/1" }] };
function deps(env: Record<string, string | undefined>, entitled = true) {
  const hits = { fetch: 0, ent: 0, fin: 0, quota: 0, ctx: 0 };
  const quota = createMemoryQuotaStore();
  const q = { ...quota, reserve: (...a: Parameters<typeof quota.reserve>) => { hits.quota++; return quota.reserve(...a); } };
  const c = createMemoryContextStore(() => new Date("2026-10-13T15:00:00Z"));
  const contexts = { ...c, get: (...a: Parameters<typeof c.get>) => { hits.ctx++; return c.get(...a); } };
  return { hits, d: {
    env, quota: q, contexts, now: () => new Date("2026-10-13T15:00:00Z"),
    isEntitled: async () => { hits.ent++; return entitled; },
    loadFinance: async () => { hits.fin++; return { hoje: "2026-10-13", rendaPorMes: {}, compromissos: [] }; },
    fetchImpl: (async () => { hits.fetch++; return new Response(JSON.stringify(body)); }) as unknown as typeof fetch,
  } };
}
const ON = (pilot?: string) => ({ WHATSAPP_SHOPPING_ENABLED: "true", SERPAPI_API_KEY: "ficticia", WHATSAPP_SHOPPING_PILOT_USER_IDS: pilot });
const zero = (h: Record<string, number>) => expect(Object.values(h).every((v) => v === 0)).toBe(true);

describe("isShoppingPilotUser", () => {
  test("vazio/ausente/malformado/sem usuário → false; nunca libera todos", () => {
    for (const raw of [undefined, "", " , ", "*", "all", `${A},nao-uuid`, "true"]) expect(isShoppingPilotUser(raw, A)).toBe(false);
    expect(isShoppingPilotUser(A, "")).toBe(false);
    expect(isShoppingPilotUser(A, null)).toBe(false);
    expect(isShoppingPilotUser(` ${A.toUpperCase()} , ${B}`, A)).toBe(true);
  });
});

describe("gate piloto", () => {
  test("flag OFF → null, nada lido", async () => {
    const { hits, d } = deps({ WHATSAPP_SHOPPING_PILOT_USER_IDS: A });
    expect(await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: "e1", text: TXT }, d)).toBeNull(); zero(hits);
  });
  test("flag ON sem allowlist → null, nada lido", async () => {
    const { hits, d } = deps(ON(undefined));
    expect(await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: "e1", text: TXT }, d)).toBeNull(); zero(hits);
  });
  test("outro usuário fora do piloto → null (bot normal), nada lido", async () => {
    const { hits, d } = deps(ON(A));
    expect(await handleWhatsAppShopping({ userId: B, phone: "5500000000002", externalId: "e1", text: TXT }, d)).toBeNull(); zero(hits);
  });
  test("continuação de usuário fora do piloto → null sem ler contexto", async () => {
    const { hits, d } = deps(ON(A));
    expect(await handleWhatsAppShopping({ userId: B, phone: "5500000000002", externalId: "e2", text: "e em 12x?" }, d)).toBeNull(); zero(hits);
  });
  test("piloto com plano negado → sem finanças/cota/SerpApi", async () => {
    const { hits, d } = deps(ON(A), false);
    const r = await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: "e1", text: TXT }, d);
    expect(r?.resposta).toContain("não está disponível");
    expect(hits.fetch + hits.fin + hits.quota).toBe(0);
  });
  test("piloto autorizado → busca 1x; continuação 12x sem nova busca", async () => {
    const { hits, d } = deps(ON(A));
    const r = await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: "e1", text: TXT }, d);
    expect(r?.resposta).toContain("Loja A");
    expect(hits.fetch).toBe(1);
    const f = await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: "e2", text: "e em 12x?" }, d);
    expect(f?.resposta).toContain("sem juros");
    expect(hits.fetch).toBe(1);
  });
  test("texto de áudio transcrito / lançamento financeiro não é compra", async () => {
    const { hits, d } = deps(ON(A));
    for (const t of ["gastei 50 reais no mercado", "comprei um macbook ontem por 8 mil", "paguei a conta de luz"])
      expect(await handleWhatsAppShopping({ userId: A, phone: "5500000000001", externalId: t, text: t }, d)).toBeNull();
    expect(hits.fetch).toBe(0);
  });
});
