/**
 * WA-V1 — Validação e roteamento seguro de áudios do WhatsApp.
 *
 * Este módulo NÃO conhece o pipeline financeiro. Ele só:
 *   - controla a flag `WHATSAPP_AUDIO_ENABLED` (default: desligada);
 *   - valida MIME declarado, bytes mágicos e tamanho;
 *   - classifica o tamanho em buckets ("small" | "medium" | "large");
 *   - expõe a mensagem segura para "transcrição incerta" / "idioma";
 *   - emite logs estruturados sem dados sensíveis.
 *
 * A transcrição em si vive em `whatsapp-transcription.server.ts` para
 * permitir desligar o adaptador sem mexer na validação.
 *
 * Nenhuma chamada externa, nenhuma persistência. Os bytes do áudio só
 * existem em memória durante o processamento. URL da Meta, token e
 * transcript NUNCA chegam aqui.
 */

const TRUTHY = new Set(["true", "1", "yes", "on"]);

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (raw.length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Flag server-side. Default: desligada. */
export function isWhatsAppAudioEnabled(): boolean {
  const flag = (process.env.WHATSAPP_AUDIO_ENABLED ?? "").trim().toLowerCase();
  return TRUTHY.has(flag);
}

/** Limite duro em bytes. Default: 10 MB. */
export function getMaxAudioBytes(): number {
  return envInt("WHATSAPP_AUDIO_MAX_BYTES", 10 * 1024 * 1024);
}

/**
 * Limite duro em segundos. Default: 120 s. Usado apenas para validar a
 * duração declarada pelo provedor de transcrição quando disponível; a
 * Meta não envia duração confiável no payload do webhook.
 */
export function getMaxAudioSeconds(): number {
  return envInt("WHATSAPP_AUDIO_MAX_SECONDS", 120);
}

/** MIMEs aceitos pelo provedor de transcrição configurado (Lovable AI / OpenAI). */
export const ALLOWED_AUDIO_MIME = new Set([
  "audio/ogg",
  "audio/oga",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "audio/flac",
]);

export type RealAudioMime =
  | "audio/ogg"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/wav"
  | "audio/webm"
  | "audio/flac";

/** Detecta o formato real pelos bytes mágicos. Não confia no header da Meta. */
export function detectAudioMimeFromBytes(buf: Uint8Array): RealAudioMime | null {
  if (!buf || buf.length < 12) return null;
  // OGG: "OggS"
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return "audio/ogg";
  }
  // WAV: "RIFF" .... "WAVE"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return "audio/wav";
  }
  // FLAC: "fLaC"
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
    return "audio/flac";
  }
  // WebM/Matroska: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "audio/webm";
  }
  // MP4/M4A: "....ftyp" no offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return "audio/mp4";
  }
  // MP3: ID3 tag
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
  // MP3: frame sync FF Ex/Fx
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

function normalizeMime(declared?: string): string | null {
  if (!declared) return null;
  const d = declared.split(";")[0].trim().toLowerCase();
  return d.length > 0 ? d : null;
}

/** jpeg/jpg style equivalência para áudio. */
function compatibleMime(declared: string, real: RealAudioMime): boolean {
  if (declared === real) return true;
  if (real === "audio/ogg" && (declared === "audio/oga" || declared === "audio/opus")) return true;
  if (real === "audio/mpeg" && declared === "audio/mp3") return true;
  if (real === "audio/mp4" && (declared === "audio/m4a" || declared === "audio/x-m4a")) return true;
  if (real === "audio/wav" && (declared === "audio/x-wav" || declared === "audio/wave"))
    return true;
  return false;
}

export type AudioValidationResult =
  | { ok: true; mimeType: RealAudioMime; bytesBucket: AudioBytesBucket }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" | "mime_mismatch" };

export type AudioBytesBucket = "small" | "medium" | "large";

export function bucketForBytes(bytes: number): AudioBytesBucket {
  if (bytes < 256 * 1024) return "small";
  if (bytes < 2 * 1024 * 1024) return "medium";
  return "large";
}

/**
 * Valida buffer recém-baixado da Meta.
 *
 * Não confia somente no MIME — compara com bytes mágicos reais.
 */
export function validateDownloadedAudio(
  buf: Uint8Array,
  declaredMime: string | undefined,
): AudioValidationResult {
  if (!buf || buf.byteLength === 0) return { ok: false, reason: "empty" };
  if (buf.byteLength > getMaxAudioBytes()) return { ok: false, reason: "too_large" };

  const declared = normalizeMime(declaredMime);
  if (declared !== null && !ALLOWED_AUDIO_MIME.has(declared)) {
    return { ok: false, reason: "unsupported_type" };
  }

  const real = detectAudioMimeFromBytes(buf);
  if (!real) return { ok: false, reason: "unsupported_type" };

  if (declared !== null && !compatibleMime(declared, real)) {
    return { ok: false, reason: "mime_mismatch" };
  }

  return { ok: true, mimeType: real, bytesBucket: bucketForBytes(buf.byteLength) };
}

// ---------- Mensagens seguras ao usuário ----------

export const WHATSAPP_AUDIO_DISABLED_REPLY = "Áudios ainda não estão disponíveis neste canal.";

export const WHATSAPP_AUDIO_UNINTELLIGIBLE_REPLY =
  "Não consegui entender bem o áudio.\n\n" +
  "Pode mandar novamente falando um pouco mais devagar ou escrever a mensagem por texto?";

export const WHATSAPP_AUDIO_UNSUPPORTED_LANGUAGE_REPLY =
  "Por enquanto, consigo entender melhor áudios em português.\n\n" +
  "Pode enviar a informação por texto?";

// ---------- Observabilidade segura ----------

export type WhatsAppAudioDecision =
  | "feature_disabled"
  | "blocked"
  | "unsupported_type"
  | "invalid_media"
  | "too_large"
  | "too_long"
  | "duration_unavailable"
  | "valid_duration"
  | "transcription_failed"
  | "transcription_empty"
  | "transcription_unsupported_language"
  | "routed_to_text_pipeline";

export type AudioDurationBucket = "under_30s" | "30_to_60s" | "60_to_120s" | "over_limit";

export type WhatsAppAudioDecisionLog = {
  event: "wa_audio_decision";
  handlerVersion: string;
  messageKey: string;
  decision: WhatsAppAudioDecision;
  source: "audio";
  mimeTypePresent: boolean;
  audioBytesBucket: AudioBytesBucket | null;
  audioDurationBucket: AudioDurationBucket | null;
};

/**
 * Loga decisão do pipeline de áudio sem expor dados sensíveis.
 *
 * Proibido incluir: telefone, e-mail, URL Graph, token, mídia, base64,
 * transcript, mensagem original, valor, descrição, categoria, banco,
 * duração exata em segundos (usar apenas bucket).
 */
export function logAudioDecision(input: {
  handlerVersion: string;
  externalId: string | null;
  decision: WhatsAppAudioDecision;
  mimeTypePresent: boolean;
  audioBytesBucket: AudioBytesBucket | null;
  audioDurationBucket?: AudioDurationBucket | null;
}): void {
  const log: WhatsAppAudioDecisionLog = {
    event: "wa_audio_decision",
    handlerVersion: input.handlerVersion,
    // messageKey é o external_id da Meta (sem PII; é um identificador opaco).
    messageKey: input.externalId ?? "unknown",
    decision: input.decision,
    source: "audio",
    mimeTypePresent: input.mimeTypePresent,
    audioBytesBucket: input.audioBytesBucket,
    audioDurationBucket: input.audioDurationBucket ?? null,
  };

  console.info(log);
}
