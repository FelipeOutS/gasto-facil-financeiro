import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  premiumForbiddenResponse,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";
import { validateImageUrl } from "@/lib/mercado/image-url-whitelist";

/**
 * V2.3.3 — Preço Comunitário: importação de preços públicos do Joanin Online.
 *
 * Escopo:
 * - Apenas leitura SSR pública (`/`, `/c/<categoria>`).
 * - URLs `/p/<placement>` (ofertas/destaques/promoções) só servem skeleton
 *   client-side → retornamos warning de importação parcial.
 * - Sem login, sem cookies privados, sem fingerprint, sem WAF bypass.
 * - Sem download de imagens (apenas image_url público é repassado).
 * - Sem armazenar HTML bruto na resposta.
 * - Limite máximo de itens por execução.
 */

const ALLOWED_HOSTS = new Set(["joaninonline.com.br", "www.joaninonline.com.br"]);
const DEFAULT_URL = "https://joaninonline.com.br/";
const MAX_ITEMS_CAP = 120;
const DEFAULT_MAX_ITEMS = 60;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MARKET_NAME = "Supermercados Joanin";
const SOURCE_NAME = "Joanin Online";

type ImportedItem = {
  productName: string;
  price: number;
  oldPrice: number | null;
  unit: string | null;
  category: string | null;
  imageUrl: string | null;
  marketName: string;
  sourceName: string;
  sourceUrl: string;
  seenAt: string;
  validUntil: string | null;
  city: string | null;
  neighborhood: string | null;
  notes: string;
  confidence: number;
};

type Diagnostics = {
  origin: "home" | "category" | "placement" | "other";
  pagePath: string;
  totalFound: number;
  paginationAvailable: boolean;
  paginationBlocked: boolean;
  warnings: string[];
};

const UNIT_TOKENS = [
  "kg", "g", "un", "und", "unid", "pct", "pacote", "cx", "caixa", "lata",
  "frasco", "garrafa", "litro", "l", "ml", "bandeja", "fardo", "dúzia",
  "duzia", "saco",
];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseBrPrice(raw: string): number | null {
  const m = raw.match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const intPart = m[1].replace(/\./g, "");
  const cents = m[2];
  const n = Number(`${intPart}.${cents}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractUnitFromPriceLabel(label: string): string | null {
  const after = label.replace(/R\$\s*[\d.,]+/i, " ").trim().toLowerCase();
  if (!after) return null;
  const token = after.split(/\s+/)[0]?.replace(/[^\p{Letter}]/gu, "") ?? "";
  if (!token) return null;
  if (UNIT_TOKENS.includes(token)) return token === "und" || token === "unid" ? "un" : token;
  return null;
}

function inferUnitFromName(name: string): string | null {
  const lower = ` ${name.toLowerCase()} `;
  for (const u of UNIT_TOKENS) {
    if (new RegExp(`\\b${u}\\b`, "i").test(lower)) {
      return u === "und" || u === "unid" ? "un" : u;
    }
  }
  const m = lower.match(/\b(\d+)\s?(kg|g|ml|l)\b/);
  if (m) return m[2];
  return null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyPath(pathname: string): Diagnostics["origin"] {
  if (pathname === "/" || pathname === "") return "home";
  if (/^\/c\//.test(pathname)) return "category";
  if (/^\/p\/categoria\//.test(pathname)) return "category";
  if (/^\/p\//.test(pathname)) return "placement";
  return "other";
}

function categoryFromPath(pathname: string): string | null {
  const mC = pathname.match(/^\/c\/([^/?#]+)/);
  if (mC) return decodeURIComponent(mC[1]).replace(/-/g, " ");
  const mP = pathname.match(/^\/p\/categoria\/\d+\/([^/?#]+)/);
  if (mP) return decodeURIComponent(mP[1]).replace(/-/g, " ");
  if (/^\/p\/ofertas/.test(pathname)) return "ofertas";
  return null;
}

function validateUrl(raw: string | undefined | null): { ok: true; url: URL } | { ok: false; reason: string } {
  if (!raw) return { ok: true, url: new URL(DEFAULT_URL) };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "invalid_url" };
  }
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    return { ok: false, reason: "host_not_allowed" };
  }
  return { ok: true, url: u };
}

/**
 * Extrai cards SSR. Cada card pode estar em estado "skeleton" (sem dados) ou
 * completo (com produto-descricao/preco). Skeletons são contados mas ignorados.
 */
function parseJoaninHtml(
  html: string,
  baseUrl: URL,
  marketName: string,
  category: string | null,
  maxItems: number,
): { items: ImportedItem[]; rawCards: number; skeletons: number; hasCarregarMais: boolean } {
  const items: ImportedItem[] = [];
  const cardRe = /<app-produtos-produto-adicionar[\s\S]{0,8000}?<\/app-produtos-produto-adicionar>/g;
  const cards = html.match(cardRe) ?? [];
  let skeletons = 0;
  const sourceUrlStr = baseUrl.toString();
  const seenAtIso = new Date().toISOString();

  for (const card of cards) {
    if (items.length >= maxItems) break;
    if (/exibirSkeleton/.test(card)) {
      skeletons += 1;
      continue;
    }

    let name: string | null = null;
    const titleAttrMatch = card.match(/class="produto-descricao"[^>]*title="([^"]+)"/);
    if (titleAttrMatch) name = decodeHtmlEntities(titleAttrMatch[1]);
    if (!name) {
      const spanMatch = card.match(/<span[^>]*class="produto-descricao"[^>]*>([\s\S]*?)<\/span>/);
      if (spanMatch) name = stripTags(decodeHtmlEntities(spanMatch[1]));
    }
    if (!name) continue;
    name = name.replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 160) continue;

    const porMatch = card.match(/<span[^>]*class="produto-preco-por"[^>]*>([\s\S]*?)<\/span>/);
    const porLabel = porMatch ? decodeHtmlEntities(stripTags(porMatch[1])) : "";
    const price = parseBrPrice(porLabel);
    if (price === null) continue;

    const deMatch = card.match(/<span[^>]*class="produto-preco-de"[^>]*>([\s\S]*?)<\/span>/);
    const deLabel = deMatch ? decodeHtmlEntities(stripTags(deMatch[1])) : "";
    const oldPrice = deLabel ? parseBrPrice(deLabel) : null;

    const unit = extractUnitFromPriceLabel(porLabel) ?? inferUnitFromName(name);

    let imageUrl: string | null = null;
    const imgMatch = card.match(/<img[^>]*class="produto-imagem"[^>]*src="([^"]+)"/);
    if (imgMatch) {
      const v = validateImageUrl(imgMatch[1].trim());
      if (v.ok) imageUrl = v.url;
    }

    items.push({
      productName: name,
      price,
      oldPrice: oldPrice && oldPrice !== price ? oldPrice : null,
      unit,
      category,
      imageUrl,
      marketName,
      sourceName: SOURCE_NAME,
      sourceUrl: sourceUrlStr,
      seenAt: seenAtIso,
      validUntil: null,
      city: null,
      neighborhood: null,
      notes: "Preço público importado para revisão. Pode variar por loja, região e data. Confira no mercado antes de comprar.",
      confidence: 0.85,
    });
  }

  // dedupe por (nome normalizado + price + unit + sourceUrl)
  const seen = new Map<string, ImportedItem>();
  for (const it of items) {
    const key = `${normalize(it.productName)}|${it.price.toFixed(2)}|${it.unit ?? ""}|${it.sourceUrl}`;
    if (!seen.has(key)) seen.set(key, it);
  }

  return {
    items: Array.from(seen.values()).slice(0, maxItems),
    rawCards: cards.length,
    skeletons,
    hasCarregarMais: /carregar-mais/i.test(html),
  };
}

async function fetchHtml(url: URL): Promise<{ ok: boolean; html?: string; status: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GastoInteligenteBot/1.0; +https://gastointeligente.com.br)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status, error: `http_${res.status}` };
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ok: false, status: 0, error: msg.includes("abort") ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeMarketName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_MARKET_NAME;
  const trimmed = raw.trim().slice(0, 120);
  if (trimmed.length < 2) return DEFAULT_MARKET_NAME;
  return trimmed;
}

export const Route = createFileRoute("/api/mercado-joanin-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse("Você precisa estar logado.");

        // WA-SEC-JOANIN-01 — Restrição total a Admin Master (owner) em produção.
        if (!(await isAdminMasterUser(user))) {
          return Response.json(
            { success: false, code: "forbidden", message: "Acesso restrito para manutenção." },
            { status: 403 }
          );
        }

        const rl = await enforceUserRateLimit({
          scope: "onlineImport",
          userId: user.id,
          route: "mercado-joanin-import",
          request,
        });
        if (rl) return rl;

        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        const validated = validateUrl((body as { url?: string }).url);
        if (!validated.ok) {
          return Response.json(
            { success: false, code: "invalid_url", items: [], message: "URL inválida ou fora do domínio joaninonline.com.br." },
            { status: 400 },
          );
        }
        const url = validated.url;
        const origin = classifyPath(url.pathname);
        const marketName = sanitizeMarketName((body as { marketName?: string }).marketName);
        const maxItemsRaw = Number((body as { maxItems?: number }).maxItems);
        const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0
          ? Math.min(Math.floor(maxItemsRaw), MAX_ITEMS_CAP)
          : DEFAULT_MAX_ITEMS;

        const fetched = await fetchHtml(url);
        const diagnostics: Diagnostics = {
          origin,
          pagePath: url.pathname,
          totalFound: 0,
          paginationAvailable: false,
          paginationBlocked: false,
          warnings: [],
        };

        if (!fetched.ok || !fetched.html) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[mercado-joanin-import] fetch falhou", { status: fetched.status, error: fetched.error });
          }
          return Response.json(
            { success: false, code: "site_unavailable", items: [], diagnostics, message: "Não foi possível acessar a fonte online agora." },
            { status: 200 },
          );
        }

        const category = categoryFromPath(url.pathname);
        let parsed;
        try {
          parsed = parseJoaninHtml(fetched.html, url, marketName, category, maxItems);
        } catch (err) {
          console.error("[mercado-joanin-import] parse erro", err);
          parsed = { items: [], rawCards: 0, skeletons: 0, hasCarregarMais: false };
        }

        diagnostics.totalFound = parsed.items.length;
        if (parsed.hasCarregarMais) {
          diagnostics.paginationBlocked = true;
          diagnostics.warnings.push("pagination_private_blocked");
        }
        const onlySkeletons = parsed.items.length === 0 && parsed.skeletons > 0;
        if (onlySkeletons && (origin === "placement" || origin === "category")) {
          diagnostics.warnings.push("placement_client_rendered_only");
        }
        if (origin === "other") {
          diagnostics.warnings.push("path_unsupported_use_home_or_category");
        }

        if (process.env.NODE_ENV !== "production") {
          console.info("[mercado-joanin-import]", {
            provider: "joanin_online",
            path: url.pathname,
            origin,
            htmlLength: fetched.html.length,
            rawCards: parsed.rawCards,
            skeletons: parsed.skeletons,
            itemCount: parsed.items.length,
            paginationBlocked: diagnostics.paginationBlocked,
          });
        }

        if (parsed.items.length === 0) {
          const dynamicOnly = parsed.skeletons > 0 && (origin === "placement" || origin === "category");
          const code = dynamicOnly ? "placement_no_public_data" : "no_products_found";
          return Response.json(
            {
              success: false,
              code,
              items: [],
              diagnostics,
              message:
                code === "placement_no_public_data"
                  ? "Esta página usa carregamento dinâmico protegido. Importamos apenas os produtos públicos visíveis."
                  : "Nenhum preço foi encontrado nessa busca.",
            },
            { status: 200 },
          );
        }

        return Response.json(
          {
            success: true,
            items: parsed.items,
            sourceName: SOURCE_NAME,
            sourceUrl: url.toString(),
            marketName,
            category,
            fetchedAt: new Date().toISOString(),
            diagnostics,
          },
          { status: 200 },
        );
      },
    },
  },
});


