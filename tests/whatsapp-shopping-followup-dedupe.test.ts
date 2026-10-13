import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { handleWhatsAppShopping, MSG_FOLLOWUP_FALHA, type FollowupClaim } from "../src/server/shopping/whatsapp-shopping.server";
import { createMemoryQuotaStore } from "../src/server/shopping/shopping-quota";
import { createMemoryContextStore } from "../src/server/shopping/shopping-context";
import { replyIdToTexto } from "../src/server/whatsapp-interactive.server";

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
const T1 = "5511900000001", T2 = "5511900000002";
const ENV = { WHATSAPP_SHOPPING_ENABLED: "true", SERPAPI_API_KEY: "f", WHATSAPP_SHOPPING_PILOT_USER_IDS: `${U1},${U2}` };
const AIR = { shopping_results: [
  { title: "Apple MacBook Air M4 16GB 256GB", source: "Loja A", extracted_price: 7999.99, link: "https://lojaa.com.br/air" },
  { title: "MacBook Air M4 16GB", source: "Loja B", extracted_price: 8299, link: "https://lojab.com.br/air" },
] };

function h(claimMode: "mem" | "error" = "mem") {
  let t = new Date("2026-10-13T15:00:00Z"); const now = () => t;
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response(JSON.stringify(AIR)); }) as unknown as typeof fetch;
  const seen = new Set<string>();
  const claimFollowup: FollowupClaim = async ({ externalId }) => {
    if (claimMode === "error") return "error";
    await Promise.resolve();
    if (seen.has(externalId)) return "dup"; seen.add(externalId); return "ok"; // simula índice único
  };
  const quota = createMemoryQuotaStore(); const contexts = createMemoryContextStore(now);
  const send = (text: string, ext: string, user = U1, phone = T1) => handleWhatsAppShopping({ userId: user, phone, externalId: ext, text },
    { env: ENV, fetchImpl, quota, contexts, now, claimFollowup, isEntitled: async () => true,
      loadFinance: async () => ({ hoje: "2026-10-13", rendaPorMes: {}, compromissos: [], guardadoCents: 0 }) });
  return { send, calls: () => calls, quota, advance: (ms: number) => { t = new Date(t.getTime() + ms); } };
}

test("'qual loja?' com mesmo wamid responde 1x; wamid novo responde de novo", async () => {
  const x = h(); await x.send("quero comprar macbook air m4 16gb", "s1");
  const a = await x.send("qual loja?", "w1"); const b = await x.send("qual loja?", "w1");
  expect(a?.resposta).toContain("Loja A"); expect(b?.duplicate).toBe(true); expect(b?.resposta).toBe("");
  expect((await x.send("qual loja?", "w2"))?.resposta).toContain("Loja A");
  expect(x.calls()).toBe(1); expect(await x.quota.userRemaining(U1, "2026-10")).toBe(9);
});

test("shopping_link_1 → 'link 1' devolve URL; clique repetido não duplica; concorrência", async () => {
  const x = h(); await x.send("quero comprar macbook air m4 16gb", "s1");
  const t = replyIdToTexto("shopping_link_1");
  const [a, b] = await Promise.all([x.send(t, "c1"), x.send(t, "c1")]);
  const r = [a, b].filter((o) => !o?.duplicate);
  expect(r.length).toBe(1); expect(r[0]!.resposta).toContain("lojaa.com.br");
  expect(x.calls()).toBe(1);
});

test("isolamento usuário/telefone, sem contexto e TTL", async () => {
  const x = h(); await x.send("quero comprar macbook air m4 16gb", "s1");
  expect(await x.send("qual loja?", "o1", U2, T1)).toBeNull();
  expect(await x.send("qual loja?", "o2", U1, T2)).toBeNull();
  x.advance(21 * 60_000);
  expect((await x.send("qual loja?", "o3"))?.resposta).toContain("pesquisa");
});

test("falha de gravação do dedupe → falha fechada, sem resposta de sucesso", async () => {
  const x = h("error"); await x.send("quero comprar macbook air m4 16gb", "s1");
  expect((await x.send("qual loja?", "e1"))?.resposta).toBe(MSG_FOLLOWUP_FALHA);
});

test("roteador: duplicata de compras não envia; reentrega reconhecida pelo kind", () => {
  const src = readFileSync("src/server/whatsapp.server.ts", "utf8");
  expect(src).toContain('if (shopping?.duplicate) return { status: "duplicada"');
  expect(src).toContain('parsed.kind === "shopping_followup"');
});
