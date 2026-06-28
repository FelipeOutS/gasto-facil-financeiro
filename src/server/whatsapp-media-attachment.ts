/**
 * WA-C10.b — modelo explícito de mídia/documento recebida pelo WhatsApp.
 *
 * O webhook tradicional já carrega `image?: ImageAttachment` em
 * `WhatsAppMessageRow`. A WA-C10.b adicionou suporte a PDF, e a regra
 * principal é: **PDF não deve, em nenhum trecho, ser tratado como imagem**.
 * Para isso, o pipeline usa um campo separado `document?: DocumentAttachment`
 * com `kind: "document"` e MIME canônico `application/pdf`.
 *
 * Ambas as estruturas guardam **apenas referências mínimas e em memória**:
 *   - `base64` é a data URL completa (`data:<mime>;base64,...`) enviada
 *     diretamente para o pipeline OCR e para a IA Gateway — nunca é
 *     persistida em banco, nem logada.
 *   - `mimeType` é o MIME REAL detectado por magic bytes após o download.
 *     Não confiamos no MIME declarado pela Meta.
 *   - `sha256` (opcional) é apenas o hash declarado pela Meta, usado para
 *     deduplicação grosseira; o pipeline calcula seu próprio fingerprint
 *     quando precisa de garantia.
 *
 * Esta definição é intencionalmente um arquivo separado para impedir que
 * outros módulos importem o tipo `ImageAttachment` e o reusem para PDFs.
 */

export type DocumentAttachment = {
  kind: "document";
  /** Data URL `data:application/pdf;base64,...`. Nunca persistir. */
  base64: string;
  mimeType: "application/pdf";
  /** Hash declarado pela Meta (opcional). */
  sha256?: string;
};

export function isDocumentAttachment(v: unknown): v is DocumentAttachment {
  if (!v || typeof v !== "object") return false;
  const o = v as { kind?: unknown; base64?: unknown; mimeType?: unknown };
  return o.kind === "document" && typeof o.base64 === "string" && o.mimeType === "application/pdf";
}
