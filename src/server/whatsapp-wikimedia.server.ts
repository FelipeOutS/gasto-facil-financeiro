/** Official Wikimedia Action API only. No HTML scraping or paid fallback. */
import { normalizeResearch } from "./whatsapp-research-core";

export type WikimediaArticle = { title: string; extract: string; url: string; language: "pt" };
export interface WikimediaSource { lookup(topic: string, signal: AbortSignal): Promise<WikimediaArticle | null> }

const API = "https://pt.wikipedia.org/w/api.php";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "GastoInteligenteResearch/2.0 (https://github.com/FelipeOutS/gasto-facil-financeiro)",
};
const POSITIVE_TTL_MS = 60 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 128;

type SearchResponse = { query?: { search?: Array<{ title?: unknown; ns?: unknown }> } };
type PageResponse = { query?: { pages?: Array<{ title?: unknown; fullurl?: unknown; extract?: unknown; missing?: unknown }> } };

function apiUrl(params: Record<string, string>): string {
  const url = new URL(API);
  for (const [key, value] of Object.entries({ format: "json", formatversion: "2", ...params })) url.searchParams.set(key, value);
  return url.toString();
}

async function getJson<T>(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<T> {
  const response = await fetcher(url, { headers: HEADERS, signal, redirect: "error" });
  if (!response.ok) throw new Error("wikimedia_unavailable");
  const body = await response.text();
  if (body.length > 32_000) throw new Error("wikimedia_response_too_large");
  return JSON.parse(body) as T;
}

function matchesTopic(topic: string, title: string): boolean {
  const normalizedTitle = normalizeResearch(title);
  const tokens = normalizeResearch(topic).split(/\s+/).filter(token => token.length > 1);
  return tokens.length > 0 && tokens.every(token => normalizedTitle.includes(token));
}

function articleUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "pt.wikipedia.org" || !url.pathname.startsWith("/wiki/") || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function shortExtract(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= 560) return clean;
  const end = clean.lastIndexOf(". ", 560);
  return end >= 120 ? clean.slice(0, end + 1) : `${clean.slice(0, 557).trimEnd()}…`;
}

export function createWikimediaSource(fetcher: typeof fetch = fetch, now: () => number = Date.now): WikimediaSource {
  const cache = new Map<string, { expiresAt: number; article: WikimediaArticle | null }>();
  return { async lookup(topic, signal) {
    const query = topic.trim();
    if (query.length < 2 || query.length > 80 || /https?:\/\/|[<>\r\n]/i.test(query)) return null;
    const key = normalizeResearch(query);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.article;

    const search = await getJson<SearchResponse>(fetcher, apiUrl({
      action: "query", list: "search", srsearch: query, srnamespace: "0", srlimit: "5", srprop: "",
    }), signal);
    const title = search.query?.search?.find(item => item.ns === 0 && typeof item.title === "string" && matchesTopic(query, item.title))?.title;
    let article: WikimediaArticle | null = null;
    if (typeof title === "string") {
      const detail = await getJson<PageResponse>(fetcher, apiUrl({
        action: "query", prop: "extracts|info", inprop: "url", exintro: "1", explaintext: "1",
        exchars: "700", redirects: "1", titles: title,
      }), signal);
      const page = detail.query?.pages?.[0];
      const url = articleUrl(page?.fullurl);
      const extract = typeof page?.extract === "string" ? shortExtract(page.extract) : "";
      if (page && page.missing === undefined && typeof page.title === "string" && url && extract.length >= 30) {
        article = { title: page.title.slice(0, 120), extract, url, language: "pt" };
      }
    }
    // The IPCA title redirects to a broad article; its introductory extract does not describe IPCA.
    // Use only the named IPCA section of that same official Wikimedia page.
    if (!article && key === normalizeResearch("Índice Nacional de Preços ao Consumidor Amplo")) {
      const detail = await getJson<PageResponse>(fetcher, apiUrl({
        action: "query", prop: "extracts|info", inprop: "url", explaintext: "1",
        redirects: "1", titles: query,
      }), signal);
      const page = detail.query?.pages?.[0];
      const url = articleUrl(page?.fullurl);
      const section = typeof page?.extract === "string"
        ? /==== IPCA ====\s*([\s\S]*?)(?:\n\s*={2,}|$)/i.exec(page.extract)?.[1]?.trim() : null;
      if (page && page.missing === undefined && url && section && section.length >= 30)
        article = { title: "IPCA — Inflação no Brasil", extract: shortExtract(section), url, language: "pt" };
    }
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { article, expiresAt: now() + (article ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return article;
  } };
}

export const wikimediaSource = createWikimediaSource();
