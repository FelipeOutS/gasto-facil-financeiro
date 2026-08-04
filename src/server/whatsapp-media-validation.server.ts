/**
 * WA-G5A.1 — validação de segurança da mídia recebida do WhatsApp.
 *
 * Funções puras e sem dependências de I/O, para que possam ser usadas
 * tanto no webhook quanto exercitadas por testes unitários.
 *
 * Regras:
 *   - tamanho máximo de 15 MB (qualquer coisa acima é rejeitada);
 *   - somente JPEG, PNG e WEBP, identificados pelos bytes mágicos reais
 *     (header), não apenas pelo `mime_type` declarado pela Meta;
 *   - mismatch entre mime declarado e bytes reais → rejeitado.
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/** Detecta o formato real do buffer pelos bytes mágicos. */
export function detectImageMimeFromBytes(
  buf: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * Valida buffer recém-baixado da Meta:
 *   - tamanho real entre 1 byte e MAX_IMAGE_BYTES;
 *   - bytes mágicos compatíveis com JPEG/PNG/WEBP;
 *   - quando há mime declarado, ele precisa bater com os bytes reais
 *     (jpeg/jpg são considerados equivalentes).
 *
 * Retorna o mime canônico em caso de sucesso, ou `null` quando o arquivo
 * deve ser silenciosamente descartado.
 */
export function validateDownloadedImage(
  buf: Uint8Array,
  declaredMime?: string,
): { mimeType: "image/jpeg" | "image/png" | "image/webp" } | null {
  if (!buf || buf.byteLength === 0) return null;
  if (buf.byteLength > MAX_IMAGE_BYTES) return null;

  const realMime = detectImageMimeFromBytes(buf);
  if (!realMime) return null;

  if (declaredMime) {
    const d = declaredMime.trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(d)) return null;
    // jpeg/jpg são equivalentes; demais devem bater.
    const norm = d === "image/jpg" ? "image/jpeg" : d;
    if (norm !== realMime) return null;
  }
  return { mimeType: realMime };
}
