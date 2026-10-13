#!/usr/bin/env node
/**
 * Smoke test ISOLADO da SerpApi Google Shopping Brasil — Gasto Inteligente.
 * Não importa banco, Supabase, WhatsApp nem código do app. Só HTTP SerpApi.
 *
 * Padrão: DRY RUN (sem rede, sem chave). Consulta real só com --execute E
 * SERPAPI_API_KEY no ambiente do PROCESSO (nunca em arquivo/secret do projeto).
 * --execute: 1 consulta grátis ao saldo (Account API) + no máximo 1 busca
 * Shopping, timeout de 9 s, 0 retries. Nunca imprime chave, e-mail, ID da conta,
 * resposta bruta ou URL com api_key.
 */
import { pathToFileURL } from "node:url";

export const QUERY = "macbook air m4 16gb"; // fixa: não aceita busca livre (evita CPF/telefone/e-mail)
export const TIMEOUT_MS = 9000;
const SEARCH = "https://serpapi.com/search.json";
const ACCOUNT = "https://serpapi.com/account.json";

export function buildSearchUrl(apiKey) {
  const u = new URL(SEARCH);
  for (const [k, v] of Object.entries({ engine: "google_shopping", q: QUERY, gl: "br", hl: "pt-br", google_domain: "google.com.br" }))
    u.searchParams.set(k, v);
  u.searchParams.set("api_key", apiKey);
  return u.toString();
}

const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Espelho de src/server/shopping/offer-specs.ts (sem importar o app).
const NAO_NOVO = /\b(usad[oa]s?|seminov[oa]s?|semi[- ]nov[oa]s?|recondicionad[oa]s?|refurbished|renewed|reembalad[oa]s?|mostruario|vitrine|open[- ]?box|unsealed|desembalad[oa]|(?:com )?caixa aberta|embalagem aberta|lacre (?:rompido|violado)|segunda mao|pre[- ]owned)\b/;
const SHORT = /(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly|encurtador|is\.gd|ow\.ly)/;
const SSD_OK = new Set([128, 256, 512, 1024, 2048, 4096]);
const uniq = (a) => [...new Set(a)];

export function extractSpecs(text) {
  const t = norm(text);
  return {
    chips: uniq([...t.matchAll(/\bm(\d)\b/g)].map((m) => `m${m[1]}`)),
    air: /\bair\b/.test(t), pro: /\b(pro|max|ultra)\b/.test(t), macbook: /\bmacbook\b/.test(t),
    ram: uniq([...t.matchAll(/\b(\d{1,2})\s?gb\b/g)].map((m) => Number(m[1])).filter((n) => n >= 4 && n <= 64)),
    ssd: uniq([...[...t.matchAll(/\b(\d{3,4})\s?g(?:b)?\b/g)].map((m) => Number(m[1])).filter((n) => SSD_OK.has(n)),
      ...[...t.matchAll(/\b(\d)\s?tb\b/g)].map((m) => Number(m[1]) * 1024)]),
    screens: uniq([...t.matchAll(/\b(13|15)(?:[.,]\d)?\b(?!\s?(?:gb|tb|g\b|x\b|vezes|parcelas))/g)].map((m) => Number(m[1]))),
  };
}

/** Variante: MacBook AIR, M4, 16GB RAM. Recusa M3/Pro/8GB e anúncio com 2 telas/SSDs por um preço. */
export function isExactVariant(title) {
  const s = extractSpecs(title);
  if (!s.macbook || !s.air || s.pro) return false;
  if (s.chips.length !== 1 || s.chips[0] !== "m4") return false;
  if (s.ram.length !== 1 || s.ram[0] !== 16) return false;
  if (s.screens.length > 1 || s.ssd.length > 1) return false;
  return true;
}
export const isNotNew = (text) => NAO_NOVO.test(norm(text));
const fmtSsd = (g) => (g >= 1024 ? `${g / 1024}TB` : `${g}GB`);
export function variantLabel(title) {
  const s = extractSpecs(title);
  return `Tela ${s.screens[0] ? `${s.screens[0]}"` : "não informada"} · SSD ${s.ssd[0] ? fmtSsd(s.ssd[0]) : "não informado"}`;
}
const variantKey = (title) => { const s = extractSpecs(title); return `${s.screens[0] ?? "?"}|${s.ssd[0] ?? "?"}`; };
export const mixedVariants = (titles) => { const k = titles.map(variantKey); return new Set(k).size > 1 || k.some((x) => x.includes("?")); };

/** https, sem credencial/porta/IP/localhost/encurtador. Retorna {url, kind} ou null. */
export function classifyUrl(raw) {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".") || SHORT.test(h)) return null;
  for (const k of [...u.searchParams.keys()]) if (/api_?key|token|secret/i.test(k)) return null;
  const google = /(^|\.)google\.[a-z.]+$/.test(h);
  return { url: u.toString(), kind: google ? "google_shopping" : "loja_direta" };
}

export function parseBRL(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(v.replace(/\u00a0/g, " "));
  if (!m) return null;
  const [i, d = "0"] = m[1].replace(/\./g, "").split(",");
  const c = Number(i) * 100 + Number(d.padEnd(2, "0"));
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

export function pickOffers(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.shopping_results)) return null;
  const out = [];
  const seen = new Set();
  for (const r of json.shopping_results.slice(0, 60)) {
    const title = typeof r?.title === "string" ? r.title.trim().slice(0, 120) : "";
    const store = typeof r?.source === "string" ? r.source.trim().slice(0, 60) : "";
    const priceCents = parseBRL(r?.extracted_price) ?? parseBRL(r?.price);
    const cands = [classifyUrl(r?.link), classifyUrl(r?.product_link)].filter(Boolean);
    const link = cands.find((c) => c.kind === "loja_direta") ?? cands[0]; // Google = intermediário
    if (!title || !store || !priceCents || !link || r?.second_hand_condition) continue;
    const extra = [r?.snippet, r?.condition, ...(Array.isArray(r?.extensions) ? r.extensions : [])].filter((x) => typeof x === "string").join(" ");
    if (isNotNew(`${title} ${extra}`) || !isExactVariant(title)) continue;
    const k = `${norm(store)}|${priceCents}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, store, priceCents, url: link.url, linkKind: link.kind });
  }
  return out.sort((a, b) => a.priceCents - b.priceCents).slice(0, 3);
}

const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const horaBR = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);

export function formatReport(offers, at) {
  if (!offers || offers.length === 0) return "Nenhuma oferta confiável da variante exata (MacBook Air M4 16GB, novo) foi encontrada. Nenhum preço foi inventado.";
  const l = [`Ofertas para "${QUERY}" (coletadas em ${horaBR(at)}, horário de Brasília):`];
  offers.forEach((o, i) => l.push(`${i + 1}. ${o.title}`, `   ${variantLabel(o.title)}`, `   ${brl(o.priceCents)} — Loja: ${o.store}`,
    `   ${o.linkKind === "google_shopping" ? "Ver no Google Shopping" : "Link direto da loja"}: ${o.url}`));
  if (mixedVariants(offers.map((o) => o.title)))
    l.push("Anúncios com tela/SSD diferentes ou não informados: não é um ranking do mesmo produto. Escolha tela (13\" ou 15\") e SSD para comparar.");
  l.push("Preços podem mudar. Frete, estoque, juros e garantia: confira na loja. Não é garantia de menor preço.");
  return l.join("\n");
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}
const safeErr = (e) => {
  const m = String(e?.message ?? "");
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "tempo esgotado";
  return /^http_\d{3}$/.test(m) ? m.replace("_", " ") : "falha de rede ou resposta inválida";
};

/** Retorna { code, lines, calls }. Nada é escrito em disco. */
export async function run({ argv = [], env = {}, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const lines = [];
  let calls = 0;
  const f = (url) => { calls++; return getJson(fetchImpl, url); };
  const execute = argv.includes("--execute");
  const bad = argv.filter((a) => a !== "--execute");
  if (bad.length) return { code: 2, lines: ["Argumento não aceito. Use apenas --execute (a busca é fixa)."], calls };
  if (!execute) {
    lines.push("DRY RUN (padrão): nenhuma chamada de rede, nenhuma chave lida.",
      `Faria 1 consulta: engine=google_shopping, q="${QUERY}", gl=br, hl=pt-br, google_domain=google.com.br.`,
      `Timeout ${TIMEOUT_MS / 1000}s, 1 tentativa, 0 retries. Para executar de verdade (somente após autorização): --execute.`);
    return { code: 0, lines, calls };
  }
  const key = typeof env.SERPAPI_API_KEY === "string" ? env.SERPAPI_API_KEY.trim() : "";
  if (!/^[A-Za-z0-9]{20,128}$/.test(key)) return { code: 3, lines: ["Bloqueado: SERPAPI_API_KEY ausente ou em formato inválido. Nenhuma consulta feita."], calls };
  let left;
  try {
    const acc = await f(`${ACCOUNT}?api_key=${encodeURIComponent(key)}`);
    left = Number(acc?.total_searches_left ?? acc?.plan_searches_left);
  } catch (e) { return { code: 4, lines: [`Não consegui verificar o saldo (${safeErr(e)}). Nenhuma busca feita.`], calls }; }
  if (!Number.isFinite(left)) return { code: 4, lines: ["Saldo da conta ilegível. Nenhuma busca feita."], calls };
  lines.push(`Saldo SerpApi: ${left} buscas restantes.`);
  if (left < 1) return { code: 5, lines: [...lines, "Sem saldo. Nenhuma busca feita."], calls };
  let json;
  try { json = await f(buildSearchUrl(key)); }
  catch (e) { return { code: 6, lines: [...lines, `A busca falhou (${safeErr(e)}). Sem nova tentativa.`], calls }; }
  const offers = pickOffers(json);
  if (offers === null) return { code: 6, lines: [...lines, "Resposta sem shopping_results válido. Nenhum preço inventado."], calls };
  lines.push(formatReport(offers, now()), "1 busca Shopping usada. Nenhuma outra consulta será feita.");
  return { code: 0, lines, calls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ argv: process.argv.slice(2), env: process.env }).then((r) => {
    for (const l of r.lines) console.log(l);
    process.exit(r.code);
  }, () => { console.log("Erro inesperado. Nenhum detalhe sensível exibido."); process.exit(1); });
}
