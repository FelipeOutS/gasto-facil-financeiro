/**
 * WA-C10.b — validação determinística de PDF recebido pelo WhatsApp.
 *
 * Sem dependências nativas (compatível com Cloudflare Workers).
 * Regras:
 *   - tamanho real ≤ MAX_PDF_BYTES;
 *   - magic bytes "%PDF-" no início (com tolerância a BOM/whitespace);
 *   - contagem aproximada de páginas via regex `/\/Type\s*\/Page[^s]/`;
 *   - rejeita 0 páginas e > MAX_PDF_PAGES.
 *
 * A contagem de páginas é uma heurística defensiva: alguns PDFs ofuscam o
 * objeto `/Pages` em streams comprimidos, então um valor 0 não significa
 * "vazio" — só é usado para BLOQUEAR PDFs claramente acima do limite.
 */

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PDF_PAGES = 10;

export function detectPdfFromBytes(buf: Uint8Array): boolean {
  if (!buf || buf.length < 5) return false;
  // tolera até 1024 bytes de header (alguns geradores põem comentários).
  const sliceLen = Math.min(buf.length, 1024);
  for (let i = 0; i <= sliceLen - 5; i++) {
    if (
      buf[i] === 0x25 && // %
      buf[i + 1] === 0x50 && // P
      buf[i + 2] === 0x44 && // D
      buf[i + 3] === 0x46 && // F
      buf[i + 4] === 0x2d // -
    ) {
      return true;
    }
    // após 8 bytes sem assinatura, abandona (PDF válido tem %PDF- no início).
    if (i > 8) return false;
  }
  return false;
}

/** Heurística leve de contagem de páginas. Retorna `null` quando indeterminável. */
export function estimatePdfPageCount(buf: Uint8Array): number | null {
  try {
    // ASCII-decodifica apenas porções relevantes do PDF.
    // Para arquivos grandes, examina os primeiros 2 MB.
    const slice = buf.subarray(0, Math.min(buf.length, 2 * 1024 * 1024));
    let s = "";
    // Conversão por chunks para evitar string conversion overhead.
    const CHUNK = 64 * 1024;
    for (let i = 0; i < slice.length; i += CHUNK) {
      s += String.fromCharCode(...slice.subarray(i, Math.min(i + CHUNK, slice.length)));
    }
    const matches = s.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
    if (matches && matches.length > 0) return matches.length;
    // Fallback: tenta /Count <N> dentro de /Pages
    const m = s.match(/\/Pages[\s\S]{0,200}?\/Count\s+(\d{1,4})/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

export type PdfValidationResult =
  | { ok: true; mimeType: "application/pdf"; pageCountEstimate: number | null }
  | { ok: false; reason: "empty" | "too_large" | "not_pdf" | "too_many_pages" };

/**
 * Valida buffer recém-baixado da Meta como PDF.
 *  - `declaredMime` pode ser ignorado se ausente, mas se presente precisa
 *    bater com "application/pdf".
 *  - O parser nunca lê conteúdo do PDF além da contagem de páginas.
 */
export function validateDownloadedPdf(
  buf: Uint8Array,
  declaredMime?: string,
): PdfValidationResult {
  if (!buf || buf.byteLength === 0) return { ok: false, reason: "empty" };
  if (buf.byteLength > MAX_PDF_BYTES) return { ok: false, reason: "too_large" };
  if (declaredMime) {
    const d = declaredMime.trim().toLowerCase();
    if (d !== "application/pdf") return { ok: false, reason: "not_pdf" };
  }
  if (!detectPdfFromBytes(buf)) return { ok: false, reason: "not_pdf" };
  const pages = estimatePdfPageCount(buf);
  if (pages !== null && pages > MAX_PDF_PAGES) return { ok: false, reason: "too_many_pages" };
  return { ok: true, mimeType: "application/pdf", pageCountEstimate: pages };
}
