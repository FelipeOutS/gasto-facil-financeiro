import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { budgetComparison, detectResearchIntent, isProductImageCaption, parseInstallments, parseUserPriceCents, splitInstallments, safeSourceUrl } from "../src/server/whatsapp-research-core";
import { openAiResearchProvider } from "../src/server/whatsapp-research-provider.server";

test("pesquisa explícita e follow-up não tomam comandos financeiros", () => {
  expect(detectResearchIntent("pesquise um celular bom até R$ 2.000", false)).toBe("product");
  expect(detectResearchIntent("qual notebook vale mais a pena até R$ 4.000?", false)).toBe("compare");
  expect(detectResearchIntent("o que é CDI?", false)).toBe("general");
  expect(detectResearchIntent("qual tem melhor câmera?", true)).toBe("followup");
  expect(detectResearchIntent("cabe no meu orçamento?", true)).toBe("followup");
  for (const text of ["gastei 50 no mercado", "recebi 2000", "minha fatura", "cancela Netflix", "coloca 300 na meta", "compare meus gastos", "quanto gastei esse mês?"]) {
    expect(detectResearchIntent(text, true)).toBeNull();
  }
  expect(detectResearchIntent("cabe no meu orçamento?", false)).toBeNull();
});

test("preço do usuário e parcelas são aritmética determinística", () => {
  expect(parseUserPriceCents("achei por 1899")).toBe(189900);
  expect(parseUserPriceCents("achei por R$ 1.899,90")).toBe(189990);
  expect(parseUserPriceCents("pesquise até 1899")).toBeNull();
  expect(parseInstallments("e em 10x?")).toBe(10);
  expect(splitInstallments(10001, 3)).toEqual([3334, 3334, 3333]);
  expect(splitInstallments(10001, 3).reduce((a, b) => a + b, 0)).toBe(10001);
  expect(safeSourceUrl("http://loja.example/produto")).toBeNull();
  expect(safeSourceUrl("https://user:pass@loja.example/p")).toBeNull();
  const comparison = budgetComparison(200000, 80000, 60000);
  expect(comparison).toContain("50% do valor restante");
  expect(comparison).toContain("não é saldo bancário");
  expect(budgetComparison(100000, 120000, 50000)).toContain("ultrapassaram o limite");
});

test("foto de produto não entra no OCR de comprovante", () => {
  expect(isProductImageCaption("pesquise esse produto")).toBe(true);
  expect(isProductImageCaption("compare esse celular")).toBe(true);
  expect(isProductImageCaption("comprovante do mercado 58,90")).toBe(false);
  expect(isProductImageCaption("pesquise meus gastos")).toBe(false);
});

test("provider exige web real, limita chamada e descarta preço sem fonte", async () => {
  let request: Record<string, unknown> | null = null;
  const fake = (async (_url: string, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "resp_fake", status: "completed", usage: { input_tokens: 123, output_tokens: 45 },
      output: [
        { type: "web_search_call", status: "completed", action: { sources: [{ url: "https://example.com/a" }] } },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({
          summary: "Duas opções.", products: [
            { name: "Modelo A", strength: "Bateria", caveat: "Tela", price_brl: 1999, source_url: "https://example.com/a" },
            { name: "Modelo B", strength: "Tela", caveat: "Bateria", price_brl: 999, source_url: "https://fake.example/b" },
          ],
        }) }] },
      ],
    }), { status: 200 });
  }) as typeof fetch;
  const answer = await openAiResearchProvider("fake-key", fake).search({
    question: "pesquise celular", intent: "product", context: null, signal: AbortSignal.timeout(1000),
  });
  expect(request?.tool_choice).toBe("required");
  expect(request?.max_tool_calls).toBe(1);
  expect(request?.store).toBe(false);
  expect(JSON.stringify(request)).not.toContain("fake-key");
  expect(answer.products[0].priceCents).toBe(199900);
  expect(answer.products[1].priceCents).toBeNull();
  expect(answer.products[1].sourceUrl).toBeNull();
  expect(answer.searchCalls).toBe(1);
});

test("sem chamada web ou fontes, provider falha sem inventar resposta", async () => {
  const fake = (async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] }))) as typeof fetch;
  expect(openAiResearchProvider("fake", fake).search({ question: "TV", intent: "product", context: null, signal: AbortSignal.timeout(1000) })).rejects.toThrow("research_search_not_executed");
});

test("webhook não seleciona OpenAI por chave ou flag de ambiente", async () => {
  const handler = await readFile(new URL("../src/server/whatsapp-research.server.ts", import.meta.url), "utf8");
  const webhook = await readFile(new URL("../src/server/whatsapp.server.ts", import.meta.url), "utf8");
  expect(handler).not.toContain("openAiResearchProvider(");
  expect(handler).not.toContain("process.env.OPENAI_API_KEY");
  expect(handler).not.toContain("whatsapp-research-provider.server");
  expect(handler).toContain('process.env.WHATSAPP_RESEARCH_ENABLED !== "true"');
  expect(handler).toContain('from "./whatsapp-wikimedia.server"');
  expect(webhook).toContain("handleWhatsAppResearch({");
  expect(webhook).not.toMatch(/handleWhatsAppResearch\(\{[^}]*provider\s*:/s);
});

test("migration reserva idempotente, cota mensal e RLS", async () => {
  const db = new PGlite();
  const user = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${user}'), ('${other}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261004150000_whatsapp_research.sql", import.meta.url), "utf8"));
    const claim = async (id: string, owner = user, limit = 1, globalLimit = 2) => (await db.query<{ claim_state: string; request_id: string | null }>(
      `SELECT claim_state, request_id FROM public.whatsapp_claim_research('${owner}', '${"a".repeat(64)}', '${id}', 'product', ${limit}, ${globalLimit})`,
    )).rows[0];
    const first = await claim("wamid-1");
    expect(first.claim_state).toBe("claimed");
    expect((await claim("wamid-1")).request_id).toBe(first.request_id);
    expect((await claim("wamid-2")).claim_state).toBe("quota");
    expect((await claim("wamid-1", other)).claim_state).toBe("claimed");
    expect((await claim("wamid-2", other, 2)).claim_state).toBe("global_quota");
    const rows = await db.query<{ count: string }>("SELECT count(*) FROM whatsapp_research_requests");
    expect(Number(rows.rows[0].count)).toBe(2);
    const auth = await db.query<{ has: boolean }>("SELECT has_table_privilege('authenticated', 'public.whatsapp_research_requests', 'SELECT') AS has");
    expect(auth.rows[0].has).toBe(false);
  } finally { await db.close(); }
});
