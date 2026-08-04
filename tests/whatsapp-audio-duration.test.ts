/**
 * WA-V1.1 — Validação de duração real de áudio.
 *
 * Cobre:
 *   - extrator puro (`measureAudioDuration`) por formato;
 *   - integração HTTP: 20s e 120s seguem; >120s e duração indisponível
 *     bloqueiam antes do transcritor;
 *   - logs estruturados: bucket de duração presente; valor exato ausente;
 *   - usuário bloqueado / flag desligada / áudio inválido NÃO chegam
 *     ao extrator de duração.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "crypto";
import {
  bucketForDuration,
  measureAudioDuration,
} from "../src/server/whatsapp-audio-duration.server";

// ============================================================
// Builders de fixtures binárias sintéticas
// ============================================================

function buildOggOpus(durationSeconds: number): Buffer {
  const opusHead = Buffer.concat([
    Buffer.from("OpusHead", "ascii"),
    Buffer.from([1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]),
  ]);
  const granule = Math.round(durationSeconds * 48000);
  function granuleBytes(g: number): Buffer {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(g >>> 0, 0);
    b.writeUInt32LE(Math.floor(g / 0x100000000) >>> 0, 4);
    return b;
  }
  function page(g: number, payload: Buffer, hdr: number, seq: number): Buffer {
    const segTable: number[] = [];
    let r = payload.length;
    while (r >= 255) {
      segTable.push(255);
      r -= 255;
    }
    segTable.push(r);
    return Buffer.concat([
      Buffer.from("OggS", "ascii"),
      Buffer.from([0, hdr]),
      granuleBytes(g),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([seq & 0xff, (seq >> 8) & 0xff, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([segTable.length]),
      Buffer.from(segTable),
      payload,
    ]);
  }
  return Buffer.concat([page(0, opusHead, 0x02, 0), page(granule, Buffer.from([0xfc]), 0x04, 1)]);
}

function buildWav(durationSeconds: number): Buffer {
  const sr = 8000;
  const byteRate = sr * 1; // mono 8-bit
  const dataSize = Math.round(byteRate * durationSeconds);
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);
  return out;
}

function buildOggOpusNoGranule(): Buffer {
  // OGG válido (OpusHead presente) mas última página tem granule=0,
  // simulando arquivo cuja duração não pode ser determinada.
  const opusHead = Buffer.concat([
    Buffer.from("OpusHead", "ascii"),
    Buffer.from([1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]),
  ]);
  function pageZero(payload: Buffer, hdr: number, seq: number): Buffer {
    return Buffer.concat([
      Buffer.from("OggS", "ascii"),
      Buffer.from([0, hdr]),
      Buffer.alloc(8, 0), // granule zero
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([seq & 0xff, (seq >> 8) & 0xff, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([1]),
      Buffer.from([payload.length]),
      payload,
    ]);
  }
  return Buffer.concat([pageZero(opusHead, 0x02, 0), pageZero(Buffer.from([0xfc]), 0x04, 1)]);
}

// ============================================================
// 1) Testes unitários do extrator puro
// ============================================================

test("OGG Opus 20s → duração ~20s, ok=true", () => {
  const r = measureAudioDuration(buildOggOpus(20), "audio/ogg");
  expect(r.ok).toBe(true);
  expect(r.durationSeconds).toBeGreaterThan(19.5);
  expect(r.durationSeconds).toBeLessThan(20.5);
  expect(r.reason).toBe("valid");
});

test("OGG Opus exatamente no limite (120s) → ok=true", () => {
  const r = measureAudioDuration(buildOggOpus(120), "audio/ogg");
  expect(r.ok).toBe(true);
  expect(r.reason).toBe("valid");
});

test("OGG Opus 150s → ok=false, reason=too_long", () => {
  const r = measureAudioDuration(buildOggOpus(150), "audio/ogg");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("too_long");
});

test("OGG Opus sem granule confiável → duration_unavailable", () => {
  const r = measureAudioDuration(buildOggOpusNoGranule(), "audio/ogg");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("duration_unavailable");
});

test("WAV 30s → ok=true", () => {
  const r = measureAudioDuration(buildWav(30), "audio/wav");
  expect(r.ok).toBe(true);
  expect(r.durationSeconds).toBeGreaterThan(29.9);
  expect(r.durationSeconds).toBeLessThan(30.1);
});

test("WAV 200s → too_long", () => {
  const r = measureAudioDuration(buildWav(200), "audio/wav");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("too_long");
});

test("buffer minúsculo → invalid_media", () => {
  const r = measureAudioDuration(Buffer.alloc(8, 0), "audio/ogg");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("invalid_media");
});

test("bucketForDuration mapeia faixas esperadas", () => {
  expect(bucketForDuration(10, 120)).toBe("under_30s");
  expect(bucketForDuration(45, 120)).toBe("30_to_60s");
  expect(bucketForDuration(90, 120)).toBe("60_to_120s");
  expect(bucketForDuration(150, 120)).toBe("over_limit");
  expect(bucketForDuration(null, 120)).toBeNull();
});

// ============================================================
// 2) Integração HTTP — pipeline real do webhook
// ============================================================

const APP_SECRET = "test-app-secret-dur";
const VERIFY_TOKEN = "test-verify-token-dur";
const ACCESS_TOKEN = "test-access-token-dur";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_CANARY_ENABLED: process.env.WHATSAPP_CANARY_ENABLED,
  WHATSAPP_AUDIO_ENABLED: process.env.WHATSAPP_AUDIO_ENABLED,
  WHATSAPP_AUDIO_MAX_SECONDS: process.env.WHATSAPP_AUDIO_MAX_SECONDS,
};

type EligResult = { allowed: boolean; userId?: string };
type ProcessCall = { texto: string; telefone: string; external_id: string | null };

const fakeState = {
  elig: { allowed: true, userId: "u-dur" } as EligResult,
  fakeAudioBytes: buildOggOpus(20) as Buffer,
  fakeAudioContentType: "audio/ogg",
  calls: {
    processarMensagemWhatsApp: 0,
    processArgs: [] as ProcessCall[],
    sendReply: [] as Array<{ telefone: string; texto: string }>,
    transcribe: 0,
    downloadFetch: [] as string[],
    consoleInfo: [] as unknown[],
    consoleError: [] as unknown[],
    logEvents: [] as Array<Record<string, unknown>>,
  },
};

function setBaseEnv() {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.WHATSAPP_ACCESS_TOKEN = ACCESS_TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999999999";
  process.env.WHATSAPP_CANARY_ENABLED = "false";
  process.env.WHATSAPP_AUDIO_ENABLED = "true";
  process.env.WHATSAPP_AUDIO_MAX_SECONDS = "120";
}

mock.module("@/server/rate-limit.server", () => ({
  RATE_LIMIT_PRESETS: { whatsappWebhook: { limit: 60, windowSeconds: 60 } },
  getClientIp: () => "203.0.113.55",
  checkRateLimit: async () => ({ blocked: false, count: 1, limit: 60, retryAfterSeconds: 60 }),
}));

mock.module("@/server/logs.server", () => ({
  logWebhookEvent: async (ev: Record<string, unknown>) => {
    fakeState.calls.logEvents.push(ev);
    return "log-1";
  },
  updateWebhookLog: async (id: string, patch: Record<string, unknown>) => {
    fakeState.calls.logEvents.push({ _update: id, ...patch });
  },
}));

mock.module("@/server/whatsapp.server", () => ({
  WHATSAPP_HANDLER_VERSION: "receipt-session-durable-v5",
  logWhatsAppInboundReceived: () => {},
  processarMensagemWhatsApp: async (msg: ProcessCall) => {
    fakeState.calls.processarMensagemWhatsApp += 1;
    fakeState.calls.processArgs.push({
      texto: msg.texto,
      telefone: msg.telefone,
      external_id: msg.external_id,
    });
    return { status: "salva", resposta: "ok", gastoId: "g-dur-1" };
  },
  sendWhatsAppReply: async (telefone: string, texto: string) => {
    fakeState.calls.sendReply.push({ telefone, texto });
  },
  // WA-B6 — stub seguro; nunca chama rede real.
  sendWhatsAppInteractiveCtaUrl: async () => ({ ok: true, status: 200 }),
}));

mock.module("@/server/whatsapp-authz.server", () => ({
  canUseWhatsAppForSender: async () => fakeState.elig,
  shouldSendBlockedReply: async () => true,
  WHATSAPP_BLOCKED_REPLY: "Olá! No momento, este número não está vinculado a uma conta ativa.",
}));

mock.module("@/server/whatsapp-c11-gates.server", () => ({
  runInboundProductionGate: async () => ({
    allowed: true as const,
    userId: fakeState.elig.userId ?? "u-audio-dur",
  }),
  runNotificationCreationGate: async () => ({ allowed: true as const }),
}));

mock.module("@/server/whatsapp-comprovantes.server", () => ({
  podeUsarOcrComprovante: async () => true,
}));

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

mock.module("@/server/whatsapp-transcription.server", () => ({
  runTranscriber: async (buffer: Uint8Array, mimeType: string) => {
    fakeState.calls.transcribe += 1;
    void buffer;
    void mimeType;
    return { ok: true, text: "ok", language: "pt" };
  },
  __setTranscriberForTests: () => {},
  transcribeWhatsAppAudio: async () => ({ ok: false, reason: "unavailable" }),
}));

const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalError = console.error;

beforeEach(() => {
  fakeState.elig = { allowed: true, userId: "u-dur" };
  fakeState.fakeAudioBytes = buildOggOpus(20);
  fakeState.fakeAudioContentType = "audio/ogg";
  fakeState.calls = {
    processarMensagemWhatsApp: 0,
    processArgs: [],
    sendReply: [],
    transcribe: 0,
    downloadFetch: [],
    consoleInfo: [],
    consoleError: [],
    logEvents: [],
  };
  setBaseEnv();
  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    fakeState.calls.downloadFetch.push(url);
    if (url.includes("graph.facebook.com/v20.0/")) {
      return new Response(
        JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/audio-x",
          mime_type: fakeState.fakeAudioContentType,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("lookaside.fbsbx.com")) {
      return new Response(new Uint8Array(fakeState.fakeAudioBytes), {
        status: 200,
        headers: { "content-type": fakeState.fakeAudioContentType },
      });
    }
    return new Response("not-found", { status: 404 });
  }) as typeof fetch;
  console.info = ((...args: unknown[]) => {
    fakeState.calls.consoleInfo.push(args[0]);
  }) as typeof console.info;
  console.error = ((...args: unknown[]) => {
    fakeState.calls.consoleError.push(args[0]);
  }) as typeof console.error;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  console.error = originalError;
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { Route } = await import("../src/routes/api/public.whatsapp.expense");
type HttpHandler = (ctx: { request: Request }) => Promise<Response>;
const POST = (
  Route as unknown as {
    options: { server: { handlers: Record<string, HttpHandler> } };
  }
).options.server.handlers.POST;

const PHONE = "5511988887777";
function metaAudioPayload(opts: { id?: string; mediaId?: string; mime?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id: opts.id ?? "wamid.dur-1",
                  from: PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "audio",
                  audio: {
                    id: opts.mediaId ?? "media-dur-1",
                    mime_type: opts.mime ?? "audio/ogg; codecs=opus",
                    sha256: "fakehash",
                    voice: true,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function signedReq(payload: unknown): Request {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  return new Request("https://example.com/api/public/whatsapp/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
    body: raw,
  });
}

// ----------------------------------------------------------------

test("áudio de 20s segue para transcrição e pipeline textual", async () => {
  fakeState.fakeAudioBytes = buildOggOpus(20);
  await POST({ request: signedReq(metaAudioPayload()) });
  expect(fakeState.calls.transcribe).toBe(1);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(1);
});

test("áudio exatamente no limite (120s) segue para transcrição", async () => {
  fakeState.fakeAudioBytes = buildOggOpus(120);
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-120" })) });
  expect(fakeState.calls.transcribe).toBe(1);
});

test("áudio acima de 120s NÃO chama transcrição e envia reply 'muito longo'", async () => {
  fakeState.fakeAudioBytes = buildOggOpus(180);
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-180" })) });
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(1);
  expect(fakeState.calls.sendReply[0].texto).toContain("muito longo");
});

test("duração indisponível NÃO chama transcrição e envia reply específico", async () => {
  fakeState.fakeAudioBytes = buildOggOpusNoGranule();
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-na" })) });
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(1);
  expect(fakeState.calls.sendReply[0].texto).toContain("validar a duração");
});

test("usuário bloqueado: áudio longo → NÃO baixa, NÃO mede duração, NÃO transcreve", async () => {
  fakeState.elig = { allowed: false };
  fakeState.fakeAudioBytes = buildOggOpus(180);
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-blk" })) });
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
});

test("flag desligada: áudio longo → NÃO baixa nem mede duração", async () => {
  process.env.WHATSAPP_AUDIO_ENABLED = "false";
  fakeState.fakeAudioBytes = buildOggOpus(180);
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-flag" })) });
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
});

test("áudio inválido (bytes mágicos errados) NÃO chega ao extrator de duração", async () => {
  fakeState.fakeAudioBytes = Buffer.from("not an audio file at all", "utf8");
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-inv" })) });
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  // Como a validação prévia falhou, o log de decisão sai como
  // unsupported_type/invalid_media, NÃO duration_unavailable.
  const decisions = fakeState.calls.consoleInfo
    .filter((e) => (e as { event?: string })?.event === "wa_audio_decision")
    .map((e) => (e as Record<string, unknown>).decision);
  expect(decisions).not.toContain("duration_unavailable");
  expect(decisions).not.toContain("valid_duration");
});

test("logs de decisão de duração não contêm segundos exatos, telefone, URL, token ou transcript", async () => {
  fakeState.fakeAudioBytes = buildOggOpus(75);
  await POST({ request: signedReq(metaAudioPayload({ id: "wamid.dur-log" })) });
  const decisions = fakeState.calls.consoleInfo.filter(
    (e) => (e as { event?: string })?.event === "wa_audio_decision",
  ) as Array<Record<string, unknown>>;
  expect(decisions.length).toBeGreaterThan(0);
  const valid = decisions.find((d) => d.decision === "valid_duration");
  expect(valid).toBeTruthy();
  expect(valid!.audioDurationBucket).toBe("60_to_120s");
  // Nenhuma chave deve carregar o valor numérico exato em segundos.
  for (const d of decisions) {
    for (const v of Object.values(d)) {
      if (typeof v === "number") {
        // garantimos que valores numéricos do log não correspondem à
        // duração real do arquivo (75s ± 0,5).
        expect(Math.abs(v - 75) > 1).toBe(true);
      }
    }
  }
  const all = JSON.stringify([
    ...fakeState.calls.consoleInfo,
    ...fakeState.calls.consoleError,
    ...fakeState.calls.logEvents,
  ]);
  expect(all).not.toContain(PHONE);
  expect(all).not.toContain("graph.facebook.com");
  expect(all).not.toContain("lookaside.fbsbx.com");
  expect(all).not.toContain(ACCESS_TOKEN);
  expect(all).not.toContain("base64,");
});
