/**
 * WA-C10.b.1 / WA-C10.b.2 — Extração textual leve de PDF para encontrar
 * candidatos de boleto SEM chamar IA/OCR.
 *
 * Estratégia (pura JS, compatível com Cloudflare Workers):
 *  1. Scan latin1 dos primeiros MAX_SCAN_BYTES bytes — captura PDFs cujos
 *     content streams NÃO estão comprimidos, formulários (`/T`), `/Contents`
 *     ou metadados expostos em claro.
 *  2. WA-C10.b.2 — Localiza objetos com `/Filter /FlateDecode`, descomprime
 *     cada stream via `DecompressionStream("deflate")` (zlib header) com
 *     fallback `"deflate-raw"`, e roda o mesmo scan latin1 sobre os bytes
 *     inflados. Suporta PDFs digitais "modernos" sem libs nativas.
 *
 * Limites de segurança contra decompression-bomb:
 *  - MAX_PDF_INPUT_BYTES         — input máximo lido.
 *  - MAX_STREAMS                 — número máximo de streams inflados por doc.
 *  - MAX_COMPRESSED_PER_STREAM   — bytes comprimidos lidos por stream.
 *  - MAX_INFLATED_PER_STREAM     — bytes descomprimidos aceitos por stream.
 *  - MAX_INFLATED_TOTAL          — somatório global por documento.
 *  Ao ultrapassar qualquer limite: aborta APENAS aquela inflação, segue com
 *  os candidatos já coletados. Nunca trava o handler. Nunca loga conteúdo.
 *
 * Princípios:
 *  - NUNCA persiste texto bruto.
 *  - NUNCA loga conteúdo.
 *  - Falha silenciosa em qualquer exceção.
 *  - Validação final fica com `tryParseBoleto` (DV mod10/mod11).
 */

const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const MAX_PDF_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_STREAMS = 24;
const MAX_COMPRESSED_PER_STREAM = 2 * 1024 * 1024;
const MAX_INFLATED_PER_STREAM = 2 * 1024 * 1024;
const MAX_INFLATED_TOTAL = 6 * 1024 * 1024;

const RE_BOLETO_DIGITS = /[0-9](?:[ .]?[0-9]){43,60}/g;
const RE_FLATE_OBJ =
  /<<([^>]{0,2048}?)\/Filter\s*\/FlateDecode([^>]{0,2048}?)>>\s*stream\r?\n/g;

function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 64 * 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return s;
}

function pushCandidates(haystack: string, out: string[], seen: Set<string>): void {
  RE_BOLETO_DIGITS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_BOLETO_DIGITS.exec(haystack)) !== null) {
    const digits = m[0].replace(/[^0-9]/g, "");
    if (digits.length !== 44 && digits.length !== 47 && digits.length !== 48) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
    if (out.length >= 8) return;
  }
}

async function inflateOnce(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw",
  capBytes: number,
): Promise<Uint8Array | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DS: any = (globalThis as any).DecompressionStream;
  if (typeof DS !== "function") return null;
  try {
    const ds = new DS(format);
    const writer = ds.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > capBytes) {
          try { await reader.cancel(); } catch { /* noop */ }
          return null;
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  } catch {
    return null;
  }
}

async function inflateFlateStream(
  bytes: Uint8Array,
  capBytes: number,
): Promise<Uint8Array | null> {
  // PDF FlateDecode geralmente é zlib (cabeçalho 78 9C / 78 DA). Algumas
  // ferramentas emitem deflate puro. Tenta zlib primeiro, depois raw.
  const a = await inflateOnce(bytes, "deflate", capBytes);
  if (a) return a;
  return await inflateOnce(bytes, "deflate-raw", capBytes);
}

/**
 * Coleta payloads comprimidos de streams marcados com `/FlateDecode`.
 * Retorna `Uint8Array[]` na ordem encontrada, limitado por MAX_STREAMS e
 * MAX_COMPRESSED_PER_STREAM. Não decodifica nada.
 */
function collectFlateStreams(buf: Uint8Array): Uint8Array[] {
  const head = bytesToLatin1(buf.subarray(0, Math.min(buf.length, MAX_PDF_INPUT_BYTES)));
  const streams: Uint8Array[] = [];
  RE_FLATE_OBJ.lastIndex = 0;
  let m: RegExpExecArray | null;
  const ENDSTREAM = "endstream";
  while ((m = RE_FLATE_OBJ.exec(head)) !== null) {
    if (streams.length >= MAX_STREAMS) break;
    const startInStr = RE_FLATE_OBJ.lastIndex;
    const endInStr = head.indexOf(ENDSTREAM, startInStr);
    if (endInStr < 0) continue;
    // Remove o newline final imediatamente antes de endstream se houver.
    let endByte = endInStr;
    if (endByte > 0 && head.charCodeAt(endByte - 1) === 0x0a) endByte--;
    if (endByte > 0 && head.charCodeAt(endByte - 1) === 0x0d) endByte--;
    const len = endByte - startInStr;
    if (len <= 0 || len > MAX_COMPRESSED_PER_STREAM) continue;
    // Os índices em `head` correspondem 1:1 a `buf` porque head é latin1
    // dos primeiros MAX_PDF_INPUT_BYTES bytes.
    streams.push(buf.subarray(startInStr, startInStr + len));
  }
  return streams;
}

/**
 * Retorna candidatos numéricos plausíveis encontrados no PDF.
 * Cada candidato é uma string com apenas dígitos (44/47/48).
 * A validação por DV é responsabilidade do caller (`tryParseBoleto`).
 *
 * Síncrono: cobre PDFs textuais não comprimidos. Para PDFs FlateDecode use
 * `extractBoletoCandidatesFromPdfAsync` (faz o scan síncrono + inflate).
 */
export function extractBoletoCandidatesFromPdf(buf: Uint8Array): string[] {
  if (!buf || buf.byteLength === 0) return [];
  try {
    const slice = buf.subarray(0, Math.min(buf.length, MAX_SCAN_BYTES));
    const s = bytesToLatin1(slice);
    const out: string[] = [];
    const seen = new Set<string>();
    pushCandidates(s, out, seen);
    return out;
  } catch {
    return [];
  }
}

/**
 * WA-C10.b.2 — Variante async que tenta extrair candidatos tanto do texto
 * em claro quanto de streams FlateDecode. Usa `DecompressionStream` nativo
 * do runtime. Falha silenciosa preserva o caller (handler cai em OCR).
 */
export async function extractBoletoCandidatesFromPdfAsync(
  buf: Uint8Array,
): Promise<string[]> {
  if (!buf || buf.byteLength === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  try {
    // (1) scan direto (cobre PDFs já textuais).
    const sliceDirect = buf.subarray(0, Math.min(buf.length, MAX_SCAN_BYTES));
    pushCandidates(bytesToLatin1(sliceDirect), out, seen);
    if (out.length >= 8) return out;

    // (2) FlateDecode streams.
    const streams = collectFlateStreams(buf);
    let totalInflated = 0;
    for (const compressed of streams) {
      if (out.length >= 8) break;
      if (totalInflated >= MAX_INFLATED_TOTAL) break;
      const remainingGlobal = MAX_INFLATED_TOTAL - totalInflated;
      const cap = Math.min(MAX_INFLATED_PER_STREAM, remainingGlobal);
      const inflated = await inflateFlateStream(compressed, cap);
      if (!inflated) continue;
      totalInflated += inflated.byteLength;
      pushCandidates(bytesToLatin1(inflated), out, seen);
    }
    return out;
  } catch {
    return out;
  }
}

// Exposto apenas para testes — limites legíveis em asserts.
export const __PDF_EXTRACT_LIMITS_FOR_TEST = {
  MAX_SCAN_BYTES,
  MAX_PDF_INPUT_BYTES,
  MAX_STREAMS,
  MAX_COMPRESSED_PER_STREAM,
  MAX_INFLATED_PER_STREAM,
  MAX_INFLATED_TOTAL,
};
