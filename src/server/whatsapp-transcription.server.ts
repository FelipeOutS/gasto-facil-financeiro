/**
 * WA-V1 — Adaptador server-side de transcrição de áudio para o WhatsApp.
 *
 * Reutiliza o provedor de IA já configurado no projeto: Lovable AI Gateway
 * (`LOVABLE_API_KEY`), endpoint `/v1/audio/transcriptions`, modelo
 * `openai/gpt-4o-mini-transcribe`. Esse provedor já é usado em outros
 * módulos (OCR de comprovante, importações), o que evita introduzir um
 * novo fornecedor externo.
 *
 * Segurança / privacidade:
 *   - apenas server-side; nunca expõe `LOVABLE_API_KEY` ao cliente;
 *   - nunca persiste bytes do áudio nem a transcrição;
 *   - nunca loga token, URL, base64, mensagem original, transcript;
 *   - se a chave não estiver configurada, retorna falha segura
 *     (`reason: "unavailable"`) — o caller deve manter a flag desligada.
 *
 * Não cria parser financeiro paralelo: apenas devolve o texto bruto para
 * o caller encaminhar ao pipeline textual existente.
 */

import { Buffer } from "buffer";

export type TranscriptionResult =
  | { ok: true; text: string; language: string | null }
  | { ok: false; reason: "unavailable" | "empty" | "unsupported_language" | "failed" };

const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

function detectLanguage(text: string): string | null {
  // Heurística mínima: presença de letras acentuadas comuns em português
  // ou palavras-âncora ("gastei", "recebi", "reais") sugere PT. Caso
  // contrário, marcamos como "unknown" e deixamos o caller decidir.
  if (!text) return null;
  const t = text.toLowerCase();
  if (/[áàâãéêíóôõúç]/.test(t)) return "pt";
  if (
    /\b(gastei|recebi|reais|cartao|cartão|pix|debito|débito|credito|crédito|salario|salário|quanto|hoje|ontem)\b/.test(
      t,
    )
  ) {
    return "pt";
  }
  return null;
}

/**
 * Faz a transcrição via Lovable AI Gateway. Sem streaming: precisamos do
 * texto completo para encaminhar ao pipeline textual de uma vez.
 */
export async function transcribeWhatsAppAudio(
  buffer: Uint8Array,
  mimeType: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, reason: "unavailable" };
  }
  if (!buffer || buffer.byteLength === 0) return { ok: false, reason: "empty" };

  const ext = MIME_TO_EXT[mimeType] ?? "ogg";
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: mimeType });
  const form = new FormData();
  form.append("model", "openai/gpt-4o-mini-transcribe");
  form.append("file", blob, `audio.${ext}`);
  // Deixamos a detecção de idioma para o modelo (mais seguro do que forçar
  // "pt" e descartar áudios em outros idiomas no servidor). O caller
  // checa o idioma resultante.
  // Nada de logs com a URL/headers/body.

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) {
      // Sem err.message do upstream: apenas status numérico.

      console.error({ event: "wa_audio_transcription_failed", httpStatus: resp.status });
      return { ok: false, reason: "failed" };
    }
    const data = (await resp.json().catch(() => null)) as {
      text?: string;
      language?: string;
    } | null;
    if (!data || typeof data.text !== "string") return { ok: false, reason: "failed" };
    const text = data.text.trim();
    if (text.length === 0) return { ok: false, reason: "empty" };
    const detectedLanguage =
      (typeof data.language === "string" && data.language.length > 0
        ? data.language.toLowerCase().slice(0, 2)
        : null) ?? detectLanguage(text);
    if (detectedLanguage && detectedLanguage !== "pt") {
      return { ok: false, reason: "unsupported_language" };
    }
    return { ok: true, text, language: detectedLanguage };
  } catch (err) {
    // err.message poderia conter URL/headers — registra apenas o nome.

    console.error({
      event: "wa_audio_transcription_failed",
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false, reason: "failed" };
  }
}

// Para os testes injetarem um stub sem rede.
let __testTranscriber:
  | ((buffer: Uint8Array, mimeType: string) => Promise<TranscriptionResult>)
  | null = null;

export function __setTranscriberForTests(
  fn: ((buffer: Uint8Array, mimeType: string) => Promise<TranscriptionResult>) | null,
): void {
  __testTranscriber = fn;
}

export async function runTranscriber(
  buffer: Uint8Array,
  mimeType: string,
): Promise<TranscriptionResult> {
  if (__testTranscriber) return __testTranscriber(buffer, mimeType);
  return transcribeWhatsAppAudio(buffer, mimeType);
}

// Buffer import-side-effect helper for serverless tree-shake checks.
export const __buffer = Buffer;
