/**
 * WA-C10.b.1 — Sanitização defensiva de sessões antes da persistência.
 *
 * Garante que NENHUM dado de mídia (base64, data URL, document, image,
 * media_id, storage path, OCR bruto) seja gravado em `whatsapp_messages.parsed`,
 * mesmo se alguém adicionar um campo novo no futuro.
 *
 * Aplicada em todas as gravações de sessão de boleto/comprovante onde
 * possa haver risco de carregar mídia inadvertidamente.
 */

const FORBIDDEN_KEYS = new Set([
  "base64",
  "dataurl",
  "data_url",
  "mediaurl",
  "media_url",
  "media",
  "mediaid",
  "media_id",
  "providermediaid",
  "provider_media_id",
  "storagepath",
  "storage_path",
  "ocrrawtext",
  "ocr_raw_text",
  "rawocrtext",
  "raw_ocr_text",
  "document",
  "image",
  "filebytes",
  "file_bytes",
  "bytes",
]);

/** Remove campos sensíveis de qualquer objeto/array (deep). NUNCA muta a entrada. */
export function stripMediaFields<T>(value: T): T {
  return _strip(value, 0) as T;
}

function _strip(v: unknown, depth: number): unknown {
  if (depth > 8) return v;
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => _strip(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
      // Detecta data URLs em qualquer string — se uma string parece um
      // data URL grande, trunca-a defensivamente.
      if (typeof val === "string" && val.startsWith("data:") && val.length > 80) continue;
      out[k] = _strip(val, depth + 1);
    }
    return out;
  }
  return v;
}
