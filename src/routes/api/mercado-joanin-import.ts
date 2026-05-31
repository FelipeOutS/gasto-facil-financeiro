import { createFileRoute } from "@tanstack/react-router";
import {
  getUserFromRequest,
  unauthorizedResponse,
  isAdminMasterUser,
  premiumForbiddenResponse,
} from "@/server/api-auth";
import { enforceUserRateLimit } from "@/server/rate-limit.server";

/**
 * V2.3.2 — Preço Comunitário: importação de preços públicos do Joanin Online.
 *
 * - Apenas leitura de dados públicos (HTML SSR da home).
 * - Sem login, sem captcha, sem armazenar HTML bruto.
 * - Sem expor headers/cookies/chaves na resposta.
 * - Limite máximo de itens por execução (segurança).
 */

const SOURCE_URL = "https://joaninonline.com.br/";
const MAX_ITEMS = 80;
const FETCH_TIMEOUT_MS = 15_000;
const MARKET_NAME = "Supermercados Joanin";
const SOURCE_NAME = "Joanin Online";

type ImportedItem = {
  productName: string;
  price: number;
  oldPrice: number | null;
  unit: string | null;
  category: string | null;
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
  // Ex: "R$ 24,99 kg" → kg
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
  // Padrões comuns
  const m = lower.match(/\b(\d+)\s?(kg|g|ml|l)\b/);
  if (m) return m[2];
  return null;
}

/**
 * Extrai cards de produto do HTML SSR do Joanin (estrutura Angular).
 * Procura blocos delimitados por <app-produtos-produto-adicionar> ... </app-produtos-produto-adicionar>
 * e dentro deles: produto-descricao (nome), produto-preco-por (atual),
 * produto-preco-de (anterior).
 */
function parseJoaninHtml(html: string): ImportedItem[] {
  const items: ImportedItem[] = [];
  const cardRe = /<app-produtos-produto-adicionar[\s\S]{0,6000}?<\/app-produtos-produto-adicionar>/g;
  const cards = html.match(cardRe) ?? [];

  for (const card of cards) {
    if (items.length >= MAX_ITEMS) break;

    // Nome
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

    // Preço atual
    const porMatch = card.match(/<span[^>]*class="produto-preco-por"[^>]*>([\s\S]*?)<\/span>/);
    const porLabel = porMatch ? decodeHtmlEntities(stripTags(porMatch[1])) : "";
    const price = parseBrPrice(porLabel);
    if (price === null) continue;

    // Preço anterior (opcional)
    const deMatch = card.match(/<span[^>]*class="produto-preco-de"[^>]*>([\s\S]*?)<\/span>/);
    const deLabel = deMatch ? decodeHtmlEntities(stripTags(deMatch[1])) : "";
    const oldPrice = deLabel ? parseBrPrice(deLabel) : null;

    const unit = extractUnitFromPriceLabel(porLabel) ?? inferUnitFromName(name);

    const confidence = name && price ? 0.85 : 0.5;

    items.push({
      productName: name,
      price,
      oldPrice: oldPrice && oldPrice !== price ? oldPrice : null,
      unit,
      category: null,
      marketName: MARKET_NAME,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      seenAt: new Date().toISOString(),
      validUntil: null,
      city: null,
      neighborhood: null,
      notes: "Preço consultado online. Pode variar por loja, região e data.",
      confidence,
    });
  }

  // Deduplica por (productName normalizado + price)
  const seen = new Map<string, ImportedItem>();
  for (const it of items) {
    const key = `${normalize(it.productName)}|${it.price.toFixed(2)}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return Array.from(seen.values()).slice(0, MAX_ITEMS);
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

async function fetchJoaninHtml(): Promise<{ ok: boolean; html?: string; status: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SOURCE_URL, {
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
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ok: false, status: 0, error: msg.includes("abort") ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/mercado-joanin-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUserFromRequest(request);
        if (!user) return unauthorizedResponse("Você precisa estar logado.");

        // Gate de plano (mercado_avancado).
        if (!isAdminMasterUser(user)) {
          try {
            const { getSubscriptionForUserIdentity } = await import("@/server/subscription.server");
            const { planAllowsFeature } = await import("@/lib/plans");
            const sub = await getSubscriptionForUserIdentity({
              userId: user.id,
              email: user.email ?? null,
              repairLink: false,
            });
            if (!sub.active) {
              return premiumForbiddenResponse(
                "mercado_avancado",
                "Sua assinatura não está ativa. Acesse Meu plano para liberar este recurso.",
              );
            }
            if (!planAllowsFeature(sub.plan, "mercado_avancado")) {
              return premiumForbiddenResponse(
                "mercado_avancado",
                "Importação online está disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa.",
                "Controle Completo Pessoal",
              );
            }
          } catch (err) {
            console.error("[mercado-joanin-import] gate erro", err);
            return premiumForbiddenResponse("mercado_avancado", "Não foi possível validar seu plano.");
          }
        }

        const rl = await enforceUserRateLimit({
          scope: "import",
          userId: user.id,
          route: "mercado-joanin-import",
          request,
        });
        if (rl) return rl;

        const fetched = await fetchJoaninHtml();
        if (!fetched.ok || !fetched.html) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[mercado-joanin-import] fetch falhou", { status: fetched.status, error: fetched.error });
          }
          return Response.json(
            {
              success: false,
              code: "site_unavailable",
              items: [],
              message: "Não foi possível acessar a fonte online agora.",
            },
            { status: 200 },
          );
        }

        let items: ImportedItem[] = [];
        try {
          items = parseJoaninHtml(fetched.html);
        } catch (err) {
          console.error("[mercado-joanin-import] parse erro", err);
          items = [];
        }

        if (process.env.NODE_ENV !== "production") {
          console.info("[mercado-joanin-import]", {
            provider: "joanin_online",
            htmlLength: fetched.html.length,
            itemCount: items.length,
          });
        }

        if (items.length === 0) {
          return Response.json(
            {
              success: false,
              code: "no_products_found",
              items: [],
              message: "Nenhum preço foi encontrado nessa busca.",
            },
            { status: 200 },
          );
        }

        return Response.json(
          {
            success: true,
            items,
            sourceName: SOURCE_NAME,
            sourceUrl: SOURCE_URL,
            marketName: MARKET_NAME,
            fetchedAt: new Date().toISOString(),
          },
          { status: 200 },
        );
      },
    },
  },
});
