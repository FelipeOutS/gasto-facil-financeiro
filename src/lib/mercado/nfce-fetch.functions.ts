/**
 * Consulta server-side da página pública de NFC-e.
 *
 * Segurança (endurecida na melhoria do fluxo de nota/comprovante):
 *  - exige usuário autenticado (não é endpoint aberto);
 *  - valida a URL em `validateNfceUrl` (HTTPS, allowlist .gov.br + pista fiscal,
 *    bloqueio de IP literal/loopback/privado/metadata/porta/credenciais);
 *  - redirects em modo MANUAL: cada hop é revalidado pela mesma guarda (máx. 3);
 *  - timeout de 8s e limite de resposta de 2 MB lido em streaming;
 *  - nunca usa cookies/login, nunca tenta quebrar CAPTCHA.
 *
 * NÃO persiste HTML nem dados fiscais: devolve só o que a revisão precisa.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { parseNfceHtml } from "./nfce-html-parser";
import type { CupomItemPreview } from "./nfce-items-parser";
import { validateNfceUrl } from "@/lib/nota/nfce-url-guard";

const InputSchema = z.object({
  url: z.string().url().max(2048),
});

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8000;

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

async function fetchNoRedirect(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
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

/** Lê no máximo `maxBytes` do corpo, abortando o resto. */
async function readLimitedText(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    if (offset >= merged.length) break;
    const slice = c.subarray(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export const fetchNfceFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<NfceFetchResult> => {
    const isDev = process.env.NODE_ENV !== "production";

    let guard = validateNfceUrl(data.url);
    if (!guard.ok) {
      if (isDev) console.warn("[nfce-fetch] url rejeitada", { reason: guard.reason });
      return { status: "invalid_url", host: guard.host, items: [], warnings: [guard.reason] };
    }

    let current = guard.url;
    let host = guard.host;
    let res: Response;

    for (let hop = 0; ; hop += 1) {
      try {
        res = await fetchNoRedirect(current, TIMEOUT_MS);
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (isDev) {
          console.warn("[nfce-fetch] erro de rede", {
            host,
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

      const isRedirect = res.status >= 300 && res.status < 400;
      if (!isRedirect) break;

      if (hop >= MAX_REDIRECTS) {
        return { status: "http_error", host, items: [], warnings: ["too_many_redirects"] };
      }
      const location = res.headers.get("location");
      if (!location) {
        return { status: "http_error", host, items: [], warnings: ["redirect_without_location"] };
      }
      // Cada hop passa pela MESMA guarda (impede escapar da allowlist via redirect).
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { status: "invalid_url", host, items: [], warnings: ["bad_redirect_url"] };
      }
      guard = validateNfceUrl(next);
      if (!guard.ok) {
        if (isDev) console.warn("[nfce-fetch] redirect bloqueado", { reason: guard.reason });
        return {
          status: "invalid_url",
          host: guard.host,
          items: [],
          warnings: [`redirect_${guard.reason}`],
        };
      }
      current = guard.url;
      host = guard.host;
    }

    if (!res.ok) {
      if (isDev) console.warn("[nfce-fetch] http error", { host, httpStatus: res.status });
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
      html = await readLimitedText(res, MAX_BYTES);
    } catch {
      return {
        status: "network_error",
        host,
        httpStatus: res.status,
        items: [],
        warnings: ["body_read_failed"],
      };
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
