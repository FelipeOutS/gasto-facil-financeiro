// Só mocks: nenhuma chamada externa.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-expect-error módulo .mjs sem tipos
import * as S from "../scripts/serpapi-shopping-smoke.mjs";

const KEY = "a".repeat(64);
const results = { shopping_results: [
  { title: "Apple MacBook Air 13 M4 16GB 256GB", source: "Loja A", extracted_price: 8499.9, link: "https://www.lojaa.com.br/p" },
  { title: "MacBook Air M4 16 GB 512GB", source: "Loja B", price: "R$ 7.999,00", product_link: "https://www.google.com.br/shopping/product/1" },
  { title: "MacBook Air M3 16GB", source: "C", extracted_price: 6000, link: "https://c.com.br/x" },
  { title: "MacBook Pro M4 16GB", source: "D", extracted_price: 9000, link: "https://d.com.br/x" },
  { title: "MacBook Air M4 8GB", source: "E", extracted_price: 5500, link: "https://e.com.br/x" },
  { title: "MacBook Air M4 16GB Seminovo", source: "F", extracted_price: 5000, link: "https://f.com.br/x" },
  { title: "MacBook Air M4 16GB", source: "G", extracted_price: 100, link: "http://192.168.0.1/x" },
  { title: "MacBook Air M4 16GB", source: "H", extracted_price: 200, link: "https://bit.ly/x" },
  { title: "MacBook Air M4 16GB", source: "I", extracted_price: 300, link: "https://i.com.br/x?api_key=1" },
  { title: "MacBook Air M4 16GB", source: "J", extracted_price: 8100, link: "https://j.com.br/x" },
  { title: "MacBook Air M4 16GB", source: "K", extracted_price: 9100, link: "https://k.com.br/x" },
] };
function mock(seq: Array<{ status?: number; body?: unknown; throws?: string }>) {
  const urls: string[] = [];
  const f = async (u: string) => {
    urls.push(u);
    const s = seq.shift();
    if (!s) throw new Error("chamada inesperada");
    if (s.throws) { const e = new Error("x"); e.name = s.throws; throw e; }
    return new Response(JSON.stringify(s.body), { status: s.status ?? 200 });
  };
  return { f, urls };
}

test("dry run padrão: 0 chamadas, sem chave", async () => {
  const m = mock([]);
  const r = await S.run({ argv: [], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f });
  expect(r.code).toBe(0); expect(r.calls).toBe(0); expect(m.urls.length).toBe(0);
  expect(r.lines.join("\n")).not.toContain(KEY);
});
test("--execute sem chave/chave inválida bloqueia sem rede", async () => {
  for (const env of [{}, { SERPAPI_API_KEY: "" }, { SERPAPI_API_KEY: "abc" }, { SERPAPI_API_KEY: "x y;rm -rf" }]) {
    const m = mock([]);
    const r = await S.run({ argv: ["--execute"], env, fetchImpl: m.f });
    expect(r.code).toBe(3); expect(m.urls.length).toBe(0);
  }
});
test("query livre recusada (sem CPF/telefone/e-mail)", async () => {
  const m = mock([]);
  const r = await S.run({ argv: ["--execute", "--q=123.456.789-00"], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f });
  expect(r.code).toBe(2); expect(m.urls.length).toBe(0);
});
test("sem saldo: só a consulta de saldo, sem busca; saída não vaza dados da conta", async () => {
  const m = mock([{ body: { account_email: "x@y.com", account_id: "ID9", api_key: KEY, total_searches_left: 0 } }]);
  const r = await S.run({ argv: ["--execute"], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f });
  const out = r.lines.join("\n");
  expect(r.code).toBe(5); expect(m.urls.length).toBe(1);
  expect(out).not.toContain(KEY); expect(out).not.toContain("x@y.com"); expect(out).not.toContain("ID9");
});
test("execução feliz: 1 busca, parâmetros BR, até 3 ofertas exatas por preço, sem vazar chave", async () => {
  const m = mock([{ body: { total_searches_left: 250 } }, { body: results }]);
  const r = await S.run({ argv: ["--execute"], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f, now: () => new Date("2026-10-13T15:00:00Z") });
  const out = r.lines.join("\n");
  expect(r.code).toBe(0); expect(r.calls).toBe(2);
  const u = new URL(m.urls[1]);
  expect(Object.fromEntries([...u.searchParams].filter(([k]) => k !== "api_key"))).toEqual({ engine: "google_shopping", q: "macbook air m4 16gb", gl: "br", hl: "pt-br", google_domain: "google.com.br" });
  expect(out).not.toContain(KEY); expect(out).not.toContain("api_key");
  expect(out.indexOf("R$ 7.999,00")).toBeLessThan(out.indexOf("R$ 8.100,00"));
  expect(out).toContain("R$ 8.499,90"); expect(out).not.toContain("R$ 9.100,00");
  expect(out).toContain("Ver no Google Shopping"); expect(out).toContain("Link direto da loja");
  expect(out).toContain("12:00"); expect(out).toContain("Não é garantia de menor preço");
  for (const s of ["M3", "Pro", "8GB", "Seminovo", "192.168", "bit.ly"]) expect(out).not.toContain(s);
});
test("timeout/erro: 0 retries, mensagem genérica", async () => {
  for (const seq of [[{ throws: "TimeoutError" }], [{ status: 500 }]]) {
    const m = mock([{ body: { total_searches_left: 10 } }, ...seq]);
    const r = await S.run({ argv: ["--execute"], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f });
    expect(r.code).toBe(6); expect(m.urls.length).toBe(2);
    expect(r.lines.join("\n")).not.toMatch(/serpapi\.com|api_key|at .*\.mjs/);
  }
});
test("sem ofertas válidas não inventa preço", async () => {
  const m = mock([{ body: { total_searches_left: 10 } }, { body: { shopping_results: [results.shopping_results[2]] } }]);
  const out = (await S.run({ argv: ["--execute"], env: { SERPAPI_API_KEY: KEY }, fetchImpl: m.f })).lines.join("\n");
  expect(out).toContain("Nenhum preço foi inventado"); expect(out).not.toContain("R$");
});
test("variantes e URLs", () => {
  expect(S.isExactVariant("Apple MacBook Air 13\" M4 16GB 512GB SSD")).toBe(true);
  for (const t of ["MacBook Air M4 24GB", "MacBook Air M2 M4 16GB", "MacBook Air M4 16GB Recondicionado", "MacBook Pro M4 16GB", "iPad Air M4 16GB"]) expect(S.isExactVariant(t)).toBe(false);
  expect(S.classifyUrl("https://user:p@a.com.br")).toBeNull();
  expect(S.classifyUrl("https://a.com.br:8443/x")).toBeNull();
  expect(S.classifyUrl("https://localhost/x")).toBeNull();
  expect(S.classifyUrl("javascript:alert(1)")).toBeNull();
  expect(S.classifyUrl("https://shopping.google.com/x")?.kind).toBe("google_shopping");
});
test("script não importa app/banco/WhatsApp e não grava arquivos", () => {
  const src = readFileSync("scripts/serpapi-shopping-smoke.mjs", "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
  expect(src).not.toMatch(/supabase|whatsapp\.|@\/|from "\.\.?\/|writeFile|appendFile|console\.(log|error)\([^)]*(key|json)\b/i);
  expect(src.match(/^import .*$/gm)).toEqual(['import { pathToFileURL } from "node:url";']);
});
