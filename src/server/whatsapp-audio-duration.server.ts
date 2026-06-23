/**
 * WA-V1.1 — Extração de duração real de áudio antes da transcrição.
 *
 * Recebe APENAS um buffer já validado por `validateDownloadedAudio`
 * (bytes mágicos verificados, MIME compatível, tamanho dentro do limite).
 *
 * Nunca chama rede. Nunca persiste. Nunca lê PII.
 *
 * Formatos suportados (mesmos aceitos pelo módulo de áudio):
 *   - audio/ogg  (Opus — caso real do WhatsApp Voice; OGG Vorbis também)
 *   - audio/wav
 *   - audio/flac
 *   - audio/mp4  (m4a)
 *   - audio/mpeg (mp3)
 *   - audio/webm (Matroska/EBML) — heurística; pode retornar
 *                `duration_unavailable` quando o segmento não traz duração.
 *
 * Política fail-closed: se a duração não puder ser determinada com
 * segurança, devolvemos `{ ok: false, reason: "duration_unavailable" }`
 * e o caller NÃO envia para transcrição.
 */

import { getMaxAudioSeconds, type RealAudioMime } from "./whatsapp-audio.server";

export type DurationReason =
  | "valid"
  | "unsupported_format"
  | "duration_unavailable"
  | "too_long"
  | "invalid_media";

export type AudioDurationResult = {
  ok: boolean;
  durationSeconds: number | null;
  reason: DurationReason;
};

export type AudioDurationBucket =
  | "under_30s"
  | "30_to_60s"
  | "60_to_120s"
  | "over_limit";

export function bucketForDuration(
  seconds: number | null,
  maxSeconds: number,
): AudioDurationBucket | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds > maxSeconds) return "over_limit";
  if (seconds < 30) return "under_30s";
  if (seconds < 60) return "30_to_60s";
  return "60_to_120s";
}

// ---------- utilidades de leitura binária ----------

function readU16BE(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0;
}
function readU32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;
}
function readU64LEAsNumber(b: Uint8Array, o: number): number {
  // OGG granule é 64 bits LE. Para áudio normal cabe em Number com folga.
  const lo = readU32LE(b, o);
  const hi = readU32LE(b, o + 4);
  return hi * 0x100000000 + lo;
}

function indexOfAscii(buf: Uint8Array, needle: string, start = 0): number {
  outer: for (let i = start; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

// ---------- OGG (Opus / Vorbis) ----------

function durationOgg(buf: Uint8Array): AudioDurationResult {
  // Identifica codec via primeira página: OpusHead ou \x01vorbis.
  const opusHead = indexOfAscii(buf, "OpusHead", 0);
  const vorbisIdent = indexOfAscii(buf, "vorbis", 0);
  let sampleRate = 48000;
  let preSkip = 0;
  if (opusHead >= 0) {
    // Opus granule é sempre 48000 Hz.
    sampleRate = 48000;
    // OpusHead: magic(8) + version(1) + channelCount(1) + preSkip(2 LE)
    if (opusHead + 12 <= buf.length) {
      preSkip = buf[opusHead + 10] | (buf[opusHead + 11] << 8);
    }
  } else if (vorbisIdent >= 0) {
    // \x01vorbis identification header. sample_rate em LE @ offset +12 do início do payload.
    // Encontre o byte 0x01 imediatamente antes de "vorbis".
    const start = vorbisIdent - 1;
    if (start >= 0 && buf[start] === 0x01) {
      // header: packet_type(1) + "vorbis"(6) + version(4) + channels(1) + sample_rate(4 LE)
      const srOff = start + 1 + 6 + 4 + 1;
      if (srOff + 4 <= buf.length) {
        const sr = readU32LE(buf, srOff);
        if (sr > 0 && sr < 1_000_000) sampleRate = sr;
      }
    }
  } else {
    return { ok: false, durationSeconds: null, reason: "unsupported_format" };
  }

  // Caminhe do fim para a última página "OggS" e leia granule_position
  // (8 bytes LE no offset 6 do header da página).
  for (let i = buf.length - 27; i >= 0; i--) {
    if (
      buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53
    ) {
      const granule = readU64LEAsNumber(buf, i + 6);
      if (granule <= 0) return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
      const samples = Math.max(0, granule - preSkip);
      const seconds = samples / sampleRate;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
      }
      return { ok: true, durationSeconds: seconds, reason: "valid" };
    }
  }
  return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
}

// ---------- WAV ----------

function durationWav(buf: Uint8Array): AudioDurationResult {
  // "RIFF" .... "WAVE" — depois chunks: id(4) + size(4 LE) + dados
  if (buf.length < 44) return { ok: false, durationSeconds: null, reason: "invalid_media" };
  let off = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (off + 8 <= buf.length) {
    const id =
      String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    const size = readU32LE(buf, off + 4);
    if (id === "fmt ") {
      if (off + 8 + 16 > buf.length) break;
      // PCM fmt: audioFormat(2) + nChannels(2) + sampleRate(4) + byteRate(4) + blockAlign(2) + bitsPerSample(2)
      byteRate = readU32LE(buf, off + 8 + 8);
    } else if (id === "data") {
      dataSize = size;
      break;
    }
    // chunks são word-aligned
    const adv = 8 + size + (size % 2);
    if (adv <= 0) break;
    off += adv;
  }
  if (byteRate <= 0 || dataSize <= 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  return { ok: true, durationSeconds: dataSize / byteRate, reason: "valid" };
}

// ---------- FLAC ----------

function durationFlac(buf: Uint8Array): AudioDurationResult {
  // "fLaC" + blocos METADATA_BLOCK. STREAMINFO é tipo 0 e tem 34 bytes.
  if (buf.length < 4 + 4 + 34) {
    return { ok: false, durationSeconds: null, reason: "invalid_media" };
  }
  const blockType = buf[4] & 0x7f;
  if (blockType !== 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  const si = 8; // início do payload STREAMINFO
  // sample rate: 20 bits começando em byte 10 do payload (si + 10)
  const sr =
    (buf[si + 10] << 12) | (buf[si + 11] << 4) | (buf[si + 12] >> 4);
  // total samples: 36 bits — 4 bits baixos do byte 13 + 32 bits do byte 14..17
  const totalHi = buf[si + 13] & 0x0f;
  const totalLo = readU32BE(buf, si + 14);
  const totalSamples = totalHi * 0x100000000 + totalLo;
  if (sr <= 0 || totalSamples <= 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  return { ok: true, durationSeconds: totalSamples / sr, reason: "valid" };
}

// ---------- MP4 / M4A ----------

function durationMp4(buf: Uint8Array): AudioDurationResult {
  // Procura átomos no nível raiz; entra em moov → trak/mvhd; usa mvhd.
  function findAtom(b: Uint8Array, name: string, start: number, end: number): { off: number; size: number } | null {
    let o = start;
    while (o + 8 <= end) {
      const size = readU32BE(b, o);
      const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
      if (size < 8 || o + size > end) return null;
      if (type === name) return { off: o, size };
      o += size;
    }
    return null;
  }
  const moov = findAtom(buf, "moov", 0, buf.length);
  if (!moov) return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  const mvhd = findAtom(buf, "mvhd", moov.off + 8, moov.off + moov.size);
  if (!mvhd) return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  const p = mvhd.off + 8; // pular size+type
  const version = buf[p];
  let timescale = 0;
  let durationUnits = 0;
  if (version === 0) {
    // version(1) + flags(3) + creation(4) + modification(4) + timescale(4) + duration(4)
    timescale = readU32BE(buf, p + 12);
    durationUnits = readU32BE(buf, p + 16);
  } else if (version === 1) {
    // version(1) + flags(3) + creation(8) + modification(8) + timescale(4) + duration(8)
    timescale = readU32BE(buf, p + 20);
    const hi = readU32BE(buf, p + 24);
    const lo = readU32BE(buf, p + 28);
    durationUnits = hi * 0x100000000 + lo;
  } else {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  if (timescale <= 0 || durationUnits <= 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  return { ok: true, durationSeconds: durationUnits / timescale, reason: "valid" };
}

// ---------- MP3 ----------

function mp3FrameInfo(b: Uint8Array, o: number): { samples: number; sampleRate: number; bitrate: number; frameLen: number } | null {
  if (o + 4 > b.length) return null;
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const versionId = (b[o + 1] >> 3) & 0x03; // 0=MPEG2.5, 2=MPEG2, 3=MPEG1
  const layer = (b[o + 1] >> 1) & 0x03; // 1=L3
  if (layer === 0 || versionId === 1) return null;
  const bitrateIndex = (b[o + 2] >> 4) & 0x0f;
  const sampleRateIndex = (b[o + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const padding = (b[o + 2] >> 1) & 0x01;
  // Tabelas mínimas (apenas Layer III, que é o caso de qualquer mp3 real)
  const L3_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const L3_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR_V1 = [44100, 48000, 32000];
  const SR_V2 = [22050, 24000, 16000];
  const SR_V25 = [11025, 12000, 8000];
  let bitrate = 0;
  let sampleRate = 0;
  let samples = 0;
  if (versionId === 3) {
    if (layer !== 1) return null;
    bitrate = L3_V1[bitrateIndex] * 1000;
    sampleRate = SR_V1[sampleRateIndex];
    samples = 1152;
  } else {
    if (layer !== 1) return null;
    bitrate = L3_V2[bitrateIndex] * 1000;
    sampleRate = (versionId === 2 ? SR_V2 : SR_V25)[sampleRateIndex];
    samples = 576;
  }
  if (bitrate <= 0 || sampleRate <= 0) return null;
  const frameLen = Math.floor((samples * bitrate) / (sampleRate * 8)) + padding;
  return { samples, sampleRate, bitrate, frameLen };
}

function durationMp3(buf: Uint8Array): AudioDurationResult {
  // Pular ID3v2 se houver
  let start = 0;
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    start = 10 + size;
  }
  // Procurar sync
  let frame: ReturnType<typeof mp3FrameInfo> = null;
  let frameOffset = -1;
  for (let i = start; i < Math.min(buf.length - 4, start + 8192); i++) {
    const f = mp3FrameInfo(buf, i);
    if (f) {
      frame = f;
      frameOffset = i;
      break;
    }
  }
  if (!frame || frameOffset < 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  // Xing/Info header: offset depende do MPEG version e channel mode
  // Buscamos a tag literal "Xing" ou "Info" dentro do primeiro frame.
  const limit = Math.min(buf.length, frameOffset + frame.frameLen);
  const xingOff = (() => {
    const x = indexOfAscii(buf.subarray(frameOffset, limit), "Xing");
    if (x >= 0) return frameOffset + x;
    const i = indexOfAscii(buf.subarray(frameOffset, limit), "Info");
    if (i >= 0) return frameOffset + i;
    return -1;
  })();
  if (xingOff > 0 && xingOff + 8 <= buf.length) {
    const flags = readU32BE(buf, xingOff + 4);
    if ((flags & 0x01) && xingOff + 12 <= buf.length) {
      const frames = readU32BE(buf, xingOff + 8);
      if (frames > 0) {
        const seconds = (frames * frame.samples) / frame.sampleRate;
        if (seconds > 0 && Number.isFinite(seconds)) {
          return { ok: true, durationSeconds: seconds, reason: "valid" };
        }
      }
    }
  }
  // Sem Xing: estimar como CBR
  const audioBytes = buf.length - frameOffset;
  const seconds = (audioBytes * 8) / frame.bitrate;
  if (seconds <= 0 || !Number.isFinite(seconds)) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  return { ok: true, durationSeconds: seconds, reason: "valid" };
}

// ---------- WebM / Matroska ----------

function durationWebm(buf: Uint8Array): AudioDurationResult {
  // Implementação intencionalmente conservadora: tentamos achar o
  // elemento "Duration" (id 0x4489) e "TimecodeScale" (id 0x2AD7B1) por
  // varredura simples. Se não encontrarmos com segurança, devolvemos
  // duration_unavailable — fail-closed por design.
  let timecodeScaleNs = 1_000_000; // default Matroska
  let durationFloat: number | null = null;

  // varredura linear; identifiers conhecidos
  const len = Math.min(buf.length, 256 * 1024); // limite de segurança
  for (let i = 0; i < len - 8; i++) {
    // Duration: 0x44 0x89
    if (durationFloat === null && buf[i] === 0x44 && buf[i + 1] === 0x89) {
      // size byte com leading 1 bits
      const sizeByte = buf[i + 2];
      if (sizeByte >= 0x80) {
        const size = sizeByte & 0x7f;
        const dataOff = i + 3;
        if (size === 4 && dataOff + 4 <= buf.length) {
          const dv = new DataView(buf.buffer, buf.byteOffset + dataOff, 4);
          durationFloat = dv.getFloat32(0, false);
        } else if (size === 8 && dataOff + 8 <= buf.length) {
          const dv = new DataView(buf.buffer, buf.byteOffset + dataOff, 8);
          durationFloat = dv.getFloat64(0, false);
        }
      }
    }
    // TimecodeScale: 0x2A 0xD7 0xB1
    if (
      buf[i] === 0x2a && buf[i + 1] === 0xd7 && buf[i + 2] === 0xb1
    ) {
      const sizeByte = buf[i + 3];
      if (sizeByte >= 0x80) {
        const size = sizeByte & 0x7f;
        const dataOff = i + 4;
        if (size > 0 && size <= 8 && dataOff + size <= buf.length) {
          let v = 0;
          for (let k = 0; k < size; k++) v = v * 256 + buf[dataOff + k];
          if (v > 0) timecodeScaleNs = v;
        }
      }
    }
  }

  if (durationFloat === null || !Number.isFinite(durationFloat) || durationFloat <= 0) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  const seconds = (durationFloat * timecodeScaleNs) / 1e9;
  if (seconds <= 0 || !Number.isFinite(seconds)) {
    return { ok: false, durationSeconds: null, reason: "duration_unavailable" };
  }
  return { ok: true, durationSeconds: seconds, reason: "valid" };
}

// ---------- API pública ----------

/**
 * Mede a duração real de um áudio JÁ VALIDADO e aplica
 * `WHATSAPP_AUDIO_MAX_SECONDS` (fallback 120 s).
 *
 * Não confia em qualquer duração declarada pela Meta.
 */
export function measureAudioDuration(
  buf: Uint8Array,
  mimeType: RealAudioMime,
): AudioDurationResult {
  if (!buf || buf.byteLength < 16) {
    return { ok: false, durationSeconds: null, reason: "invalid_media" };
  }
  let raw: AudioDurationResult;
  switch (mimeType) {
    case "audio/ogg":
      raw = durationOgg(buf);
      break;
    case "audio/wav":
      raw = durationWav(buf);
      break;
    case "audio/flac":
      raw = durationFlac(buf);
      break;
    case "audio/mp4":
      raw = durationMp4(buf);
      break;
    case "audio/mpeg":
      raw = durationMp3(buf);
      break;
    case "audio/webm":
      raw = durationWebm(buf);
      break;
    default:
      return { ok: false, durationSeconds: null, reason: "unsupported_format" };
  }
  if (!raw.ok || raw.durationSeconds === null) return raw;

  const max = getMaxAudioSeconds();
  if (raw.durationSeconds > max + 0.5 /* tolerância de arredondamento */) {
    return { ok: false, durationSeconds: raw.durationSeconds, reason: "too_long" };
  }
  return { ok: true, durationSeconds: raw.durationSeconds, reason: "valid" };
}

// ---------- Mensagens seguras ao usuário ----------

export const WHATSAPP_AUDIO_DURATION_UNAVAILABLE_REPLY =
  "Não consegui validar a duração desse áudio.\n\n" +
  "Pode mandar uma mensagem mais curta ou enviar por texto?";

export const WHATSAPP_AUDIO_TOO_LONG_REPLY =
  "Esse áudio ficou muito longo para eu processar por aqui.\n\n" +
  "Envie um áudio de até 2 minutos ou escreva a mensagem por texto.";
