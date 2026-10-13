/**
 * Adaptador SerpApi Google Shopping Brasil (mockável via `fetchImpl`).
 * Envia SOMENTE a busca normalizada; nunca dados financeiros/pessoais.
 * Sem chave → não chama a API. Até 3 ofertas, ordenadas por preço.
 */
export type Offer = { title: string; store: string; priceCents: number; url: string };
export type SearchResult =
  | { ok: true; offers: Offer[]; collectedAt: string; apiCalls: number }
  | { ok: false; reason: "no_key" | "timeout" | "http_error" | "bad_response"; apiCalls: number };

const USED = /\b(usado|usada|seminovo|seminova|recondicionado|recondicionada|refurbished|renewed|vitrine|open ?box|reembalado|mostruario)\b/;
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function buildSerpApiUrl(query: string, apiKey: string): string {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("gl", "br");
  u.searchParams.set("hl", "pt-br");
  u.searchParams.set("google_domain", "google.com.br");
  u.searchParams.set("api_key", apiKey);
  return u.toString();
}

/** "R$ 8.499,90" → 849990 centavos. Retorna null se não for BRL válido. */
export function parseBRL(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(v.replace(/\u00a0/g, " "));
  if (!m) return null;
  const [int, dec = "0"] = m[1].replace(/\./g, "").split(",");
  const c = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

/** Só https, sem credenciais, sem IP/localhost, sem porta, tamanho razoável. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return null;
  if (/(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly|encurtador)/.test(h)) return null;
  return u.toString();
}

/** Tokens de variante obrigatórios (chip M1–M9, memória/armazenamento, Air/Pro/Max). */
export function variantTokens(query: string): string[] {
  const q = norm(query);
  const t = new Set<string>();
  for (const m of q.matchAll(/\b(m\d)\b/g)) t.add(m[1]);
  for (const m of q.matchAll(/\b(\d+)\s?(gb|tb)\b/g)) t.add(`${m[1]}${m[2]}`);
  for (const w of ["air", "pro", "max", "mini", "plus", "ultra"]) if (new RegExp(`\\b${w}\\b`).test(q)) t.add(w);
  return [...t];
}

export function matchesVariant(title: string, query: string): boolean {
  const t = norm(title).replace(/\b(\d+)\s?(gb|tb)\b/g, "$1$2");
  const q = norm(query);
  for (const tok of variantTokens(query)) if (!new RegExp(`\\b${tok}\\b`).test(t)) return false;
  // Conflito explícito de chip: pediu M4, título fala M3.
  const chipQ = /\b(m\d)\b/.exec(q)?.[1];
  const chips = [...t.matchAll(/\b(m\d)\b/g)].map((m) => m[1]);
  if (chipQ && chips.some((c) => c !== chipQ)) return false;
  for (const w of ["pro", "max", "mini", "ultra"]) {
    if (!new RegExp(`\\b${w}\\b`).test(q) && new RegExp(`\\b${w}\\b`).test(t) && /\b(air|pro)\b/.test(q)) return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOffers(json: any, query: string, wantsUsed: boolean): Offer[] | null {
  if (!json || typeof json !== "object" || !Array.isArray(json.shopping_results)) return null;
  const out: Offer[] = [];
  const seen = new Set<string>();
  for (const r of json.shopping_results.slice(0, 40)) {
    const title = typeof r?.title === "string" ? r.title.trim().slice(0, 120) : "";
    const store = typeof r?.source === "string" ? r.source.trim().slice(0, 60) : "";
    const priceCents = parseBRL(r?.extracted_price) ?? parseBRL(r?.price);
    const url = safeUrl(r?.product_link) ?? safeUrl(r?.link);
    if (!title || !store || !priceCents || !url) continue;
    if (!wantsUsed && (USED.test(norm(title)) || (r?.second_hand_condition && !wantsUsed))) continue;
    if (!matchesVariant(title, query)) continue;
    const k = `${norm(store)}|${priceCents}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, store, priceCents, url });
  }
  return out.sort((a, b) => a.priceCents - b.priceCents).slice(0, 3);
}

export async function searchShopping(args: {
  query: string; wantsUsed: boolean; apiKey: string | undefined;
  fetchImpl?: typeof fetch; timeoutMs?: number; maxAttempts?: number; now?: () => Date;
}): Promise<SearchResult> {
  const key = args.apiKey?.trim();
  if (!key) return { ok: false, reason: "no_key", apiCalls: 0 };
  const f = args.fetchImpl ?? fetch;
  const attempts = Math.min(Math.max(args.maxAttempts ?? 2, 1), 2);
  let calls = 0;
  let last: "timeout" | "http_error" | "bad_response" = "http_error";
  for (let i = 0; i < attempts; i++) {
    calls++;
    try {
      const res = await f(buildSerpApiUrl(args.query, key), {
        method: "GET", headers: { accept: "application/json" },
        signal: AbortSignal.timeout(args.timeoutMs ?? 8000),
      });
      if (res.status >= 500 || res.status === 429) { last = "http_error"; continue; }
      if (!res.ok) return { ok: false, reason: "http_error", apiCalls: calls };
      const offers = parseOffers(await res.json().catch(() => null), args.query, args.wantsUsed);
      if (!offers) return { ok: false, reason: "bad_response", apiCalls: calls };
      return { ok: true, offers, collectedAt: (args.now?.() ?? new Date()).toISOString(), apiCalls: calls };
    } catch (e) {
      last = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "timeout" : "http_error";
    }
  }
  return { ok: false, reason: last, apiCalls: calls };
}
