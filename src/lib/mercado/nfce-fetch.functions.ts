/**
 * Mercado Inteligente — fetch server-side da página pública de NFC-e.
 *
 * Faz GET na URL pública da SEFAZ (consultaPublica), valida o host contra
 * whitelist de domínios gov.br/sefaz/fazenda e devolve dados estruturados
 * (itens, total, mercado, CNPJ, data). NÃO usa cookies privados, NÃO faz
 * login, NÃO tenta quebrar captcha. Em dev, loga só diagnóstico seguro.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { parseNfceHtml } from "./nfce-html-parser";
import type { CupomItemPreview } from "./nfce-items-parser";

// Hosts públicos esperados para NFC-e. Whitelist por sufixo.
const HOST_ALLOW_SUFFIXES = [
  ".gov.br",
  // alguns estados publicam em subdomínios fora do .gov.br padrão; aqui restringimos a .gov.br.
];

const HOST_HINTS = [
  "fazenda",
  "sefaz",
  "set.",
  "sef.",
  "economia",
  "receita",
];

const InputSchema = z.object({
  url: z.string().url().max(2048),
});

export type NfceFetchStatus =
  | "items_found"
  | "total_only"
  | "link_no_items"
  | "protected"
  | "invalid_url"
  | "http_error"
  | "timeout"
  | "network_error";

export interface NfceFetchResult {
  status: NfceFetchStatus;
  host?: string;
  httpStatus?: number;
  items: CupomItemPreview[];
  totalDeclared?: number;
  marketName?: string;
  cnpj?: string;
  dateISO?: string;
  warnings: string[];
}

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!HOST_ALLOW_SUFFIXES.some((suf) => h.endsWith(suf))) return false;
  return HOST_HINTS.some((hint) => h.includes(hint));
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GastoInteligenteBot/1.0; +https://gastointeligente.com.br)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(id);
  }
}

export const fetchNfceFromUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<NfceFetchResult> => {
    const isDev = process.env.NODE_ENV !== "production";

    let parsed: URL;
    try {
      parsed = new URL(data.url);
    } catch {
      return { status: "invalid_url", items: [], warnings: ["url_parse_failed"] };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { status: "invalid_url", items: [], warnings: ["bad_protocol"] };
    }

    const host = parsed.host.toLowerCase();
    if (!isAllowedHost(host)) {
      if (isDev) {
        console.warn("[nfce-fetch] host fora da whitelist", { host });
      }
      return { status: "invalid_url", host, items: [], warnings: ["host_not_allowed"] };
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(parsed.toString(), 8000);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isDev) {
        console.warn("[nfce-fetch] erro de rede", {
          host,
          provider: "nfce",
          reason: isAbort ? "timeout" : "network",
        });
      }
      return {
        status: isAbort ? "timeout" : "network_error",
        host,
        items: [],
        warnings: [isAbort ? "timeout" : "network_error"],
      };
    }

    if (!res.ok) {
      if (isDev) {
        console.warn("[nfce-fetch] http error", { host, httpStatus: res.status });
      }
      return {
        status: "http_error",
        host,
        httpStatus: res.status,
        items: [],
        warnings: [`http_${res.status}`],
      };
    }

    let html = "";
    try {
      html = await res.text();
    } catch {
      return {
        status: "network_error",
        host,
        httpStatus: res.status,
        items: [],
        warnings: ["body_read_failed"],
      };
    }

    // Limite defensivo de tamanho (3MB).
    if (html.length > 3_000_000) {
      html = html.slice(0, 3_000_000);
    }

    const parsedHtml = parseNfceHtml(html);

    let status: NfceFetchStatus;
    if (parsedHtml.protectedPage && parsedHtml.items.length === 0) {
      status = "protected";
    } else if (parsedHtml.items.length > 0) {
      status = "items_found";
    } else if (typeof parsedHtml.totalDeclared === "number") {
      status = "total_only";
    } else {
      status = "link_no_items";
    }

    if (isDev) {
      console.info("[nfce-fetch] diagnostic", {
        provider: "nfce",
        status,
        urlHost: host,
        httpStatus: res.status,
        htmlLength: html.length,
        itemCount: parsedHtml.items.length,
        totalFound: typeof parsedHtml.totalDeclared === "number",
        parseWarnings: parsedHtml.warnings,
      });
    }

    return {
      status,
      host,
      httpStatus: res.status,
      items: parsedHtml.items,
      totalDeclared: parsedHtml.totalDeclared,
      marketName: parsedHtml.marketName,
      cnpj: parsedHtml.cnpj,
      dateISO: parsedHtml.dateISO,
      warnings: parsedHtml.warnings,
    };
  });
