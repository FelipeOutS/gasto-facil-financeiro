/**
 * Pacote 2 / C — fetch com tempo limite e leitura de corpo com limite de bytes
 * aplicado DURANTE o streaming (Content-Length pode faltar ou mentir).
 * Nenhum log de URL, token ou conteúdo.
 */

export const MEDIA_LOOKUP_TIMEOUT_MS = 8_000;
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;
export const AI_TRANSCRIPTION_TIMEOUT_MS = 30_000;
export const AI_OCR_TIMEOUT_MS = 45_000;

export type BoundedFailure = "timeout" | "oversized" | "http_error" | "network" | "empty" | "invalid";

export class BoundedFetchError extends Error {
  constructor(public readonly kind: BoundedFailure, public readonly httpStatus?: number) {
    super(kind);
    this.name = "BoundedFetchError";
  }
}

function isAbort(err: unknown): boolean {
  const n = (err as { name?: string } | null)?.name;
  return n === "TimeoutError" || n === "AbortError";
}

/** fetch com AbortSignal.timeout (combinado ao signal do caller, se houver). */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const t = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, t]) : t;
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (err) {
    throw new BoundedFetchError(isAbort(err) || t.aborted ? "timeout" : "network");
  }
}

/**
 * Lê o corpo acumulando bytes; cancela o stream assim que passar de maxBytes.
 * O tempo total de leitura também é limitado (corpo infinito/pendurado).
 */
export async function readBodyLimited(res: Response, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new BoundedFetchError("oversized");
  }
  if (!res.body) throw new BoundedFetchError("empty");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new BoundedFetchError("timeout")), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BoundedFetchError("oversized");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (err instanceof BoundedFetchError) throw err;
    throw new BoundedFetchError(isAbort(err) ? "timeout" : "network");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (total === 0) throw new BoundedFetchError("empty");
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total);
}

export type MediaDownloadResult =
  | { ok: true; buffer: Buffer; declaredMime?: string }
  | { ok: false; reason: BoundedFailure | "not_configured" };

/** Download de mídia Meta em 2 passos (lookup + bytes), ambos limitados. */
export async function downloadWhatsappMediaBounded(
  args: { lookupUrl: string; token: string; mimeFromMeta?: string; maxBytes: number },
  opts: { fetchImpl?: typeof fetch; lookupTimeoutMs?: number; downloadTimeoutMs?: number } = {},
): Promise<MediaDownloadResult> {
  const f = opts.fetchImpl ?? fetch;
  const auth = { Authorization: `Bearer ${args.token}` };
  try {
    if (!isTrustedMetaUrl(args.lookupUrl, true)) return { ok: false, reason: "invalid" };
    const lookup = await fetchWithTimeout(args.lookupUrl, { headers: auth, redirect: "error" }, opts.lookupTimeoutMs ?? MEDIA_LOOKUP_TIMEOUT_MS, f);
    if (!lookup.ok) {
      await lookup.body?.cancel().catch(() => {});
      return { ok: false, reason: "http_error" };
    }
    const metaBuf = await readBodyLimited(lookup, 16 * 1024, opts.lookupTimeoutMs ?? MEDIA_LOOKUP_TIMEOUT_MS);
    let meta: { url?: unknown; mime_type?: unknown };
    try { meta = JSON.parse(metaBuf.toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
    if (typeof meta.url !== "string" || !isTrustedMetaUrl(meta.url)) return { ok: false, reason: "invalid" };
    const dlTimeout = opts.downloadTimeoutMs ?? MEDIA_DOWNLOAD_TIMEOUT_MS;
    const dl = await fetchWithTimeout(meta.url, { headers: auth, redirect: "error" }, dlTimeout, f);
    if (!dl.ok) {
      await dl.body?.cancel().catch(() => {});
      return { ok: false, reason: "http_error" };
    }
    const buffer = await readBodyLimited(dl, args.maxBytes, dlTimeout);
    const mime = typeof meta.mime_type === "string" ? meta.mime_type : args.mimeFromMeta;
    return { ok: true, buffer, declaredMime: mime?.toLowerCase() };
  } catch (err) {
    return { ok: false, reason: err instanceof BoundedFetchError ? err.kind : "network" };
  }
}

/** Bearer credentials may only reach Meta-controlled HTTPS hosts. */
export function isTrustedMetaUrl(raw: string, lookup = false): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    if (lookup) return u.hostname === "graph.facebook.com";
    return ["facebook.com", "fbcdn.net", "fbsbx.com", "whatsapp.net"].some(h => u.hostname === h || u.hostname.endsWith("." + h));
  } catch { return false; }
}
