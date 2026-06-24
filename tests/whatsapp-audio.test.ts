/**
 * WA-V1 — Testes HTTP do suporte a áudio no webhook do WhatsApp.
 *
 * Exercita o mesmo handler HTTP (`/api/public/whatsapp/expense`):
 *   - flag `WHATSAPP_AUDIO_ENABLED`;
 *   - ordem obrigatória (gate → flag → dedup → tipo/tamanho → download
 *     → bytes reais → transcrição → pipeline textual);
 *   - reuso de `processarMensagemWhatsApp`;
 *   - mensagens seguras ao usuário;
 *   - privacidade dos logs (sem telefone, token, URL, base64, transcript).
 *
 * Nenhum teste fala com Meta, Graph API ou Lovable AI Gateway de verdade.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "crypto";

const APP_SECRET = "test-app-secret-audio";
const VERIFY_TOKEN = "test-verify-token-audio";
const ACCESS_TOKEN = "test-access-token-audio";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_CANARY_ENABLED: process.env.WHATSAPP_CANARY_ENABLED,
  WHATSAPP_AUDIO_ENABLED: process.env.WHATSAPP_AUDIO_ENABLED,
};

function setBaseEnv() {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.WHATSAPP_ACCESS_TOKEN = ACCESS_TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999999999";
  process.env.WHATSAPP_CANARY_ENABLED = "false";
}

// ---------------- estado mutável dos mocks ----------------

// ---------------- builders de fixtures sintéticas ----------------

// Constrói um OGG Opus válido o suficiente para o validador
// (bytes mágicos + OpusHead) e para a extração de duração
// (granule_position da última página = sampleRate * segundos).
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
  function buildPage(g: number, payload: Buffer, headerType: number, seq: number): Buffer {
    const segTable: number[] = [];
    let remaining = payload.length;
    while (remaining >= 255) { segTable.push(255); remaining -= 255; }
    segTable.push(remaining);
    return Buffer.concat([
      Buffer.from("OggS", "ascii"),
      Buffer.from([0, headerType]),
      granuleBytes(g),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([seq & 0xff, (seq >> 8) & 0xff, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([segTable.length]),
      Buffer.from(segTable),
      payload,
    ]);
  }
  return Buffer.concat([
    buildPage(0, opusHead, 0x02, 0),
    buildPage(granule, Buffer.from([0xfc]), 0x04, 1),
  ]);
}

const DEFAULT_OGG_BYTES = buildOggOpus(20);

type EligResult = { allowed: boolean; userId?: string };
type ProcessCall = {
  authorizedUserId?: string;
  texto: string;
  telefone: string;
  external_id: string | null;
};

const fakeState = {
  elig: { allowed: true, userId: "u-audio" } as EligResult,
  externalConfirmed: false,
  // Bytes reais a "baixar" da Meta. Default: OGG Opus de 20 s sintético.
  fakeAudioBytes: DEFAULT_OGG_BYTES as Buffer,
  fakeAudioContentType: "audio/ogg",
  transcribeResult: {
    ok: true as boolean,
    text: "gastei quarenta e dois reais no almoço",
    language: "pt" as string | null,
    reason: undefined as undefined | string,
  },
  processOutcome: {
    status: "salva" as string,
    resposta: "ok" as string | null,
    gastoId: "g-audio-1" as string | undefined,
  },
  calls: {
    canUseWhatsAppForSender: 0,
    processarMensagemWhatsApp: 0 as number,
    processArgs: [] as ProcessCall[],
    sendReply: [] as Array<{ telefone: string; texto: string }>,
    transcribe: 0 as number,
    transcribeArgs: [] as Array<{ mimeType: string; size: number }>,
    downloadFetch: [] as string[],
    externalIdLookup: 0,
    logEvents: [] as Array<Record<string, unknown>>,
    consoleInfo: [] as unknown[],
    consoleError: [] as unknown[],
  },
};

function resetState() {
  fakeState.elig = { allowed: true, userId: "u-audio" };
  fakeState.externalConfirmed = false;
  fakeState.fakeAudioBytes = DEFAULT_OGG_BYTES;
  fakeState.fakeAudioContentType = "audio/ogg";
  fakeState.transcribeResult = {
    ok: true,
    text: "gastei quarenta e dois reais no almoço",
    language: "pt",
    reason: undefined,
  };
  fakeState.processOutcome = { status: "salva", resposta: "ok", gastoId: "g-audio-1" };
  fakeState.calls = {
    canUseWhatsAppForSender: 0,
    processarMensagemWhatsApp: 0,
    processArgs: [],
    sendReply: [],
    transcribe: 0,
    transcribeArgs: [],
    downloadFetch: [],
    externalIdLookup: 0,
    logEvents: [],
    consoleInfo: [],
    consoleError: [],
  };
}

// ---------------- mocks de módulos ----------------

mock.module("@/server/rate-limit.server", () => ({
  RATE_LIMIT_PRESETS: { whatsappWebhook: { limit: 60, windowSeconds: 60 } },
  getClientIp: () => "203.0.113.20",
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
      authorizedUserId: msg.authorizedUserId,
      texto: msg.texto,
      telefone: msg.telefone,
      external_id: msg.external_id,
    });
    return fakeState.processOutcome;
  },
  sendWhatsAppReply: async (telefone: string, texto: string) => {
    fakeState.calls.sendReply.push({ telefone, texto });
  },
}));

mock.module("@/server/whatsapp-authz.server", () => ({
  canUseWhatsAppForSender: async () => {
    fakeState.calls.canUseWhatsAppForSender += 1;
    return fakeState.elig;
  },
  shouldSendBlockedReply: async () => true,
  WHATSAPP_BLOCKED_REPLY:
    "Olá! No momento, este número não está vinculado a uma conta ativa.",
}));

mock.module("@/server/whatsapp-comprovantes.server", () => ({
  podeUsarOcrComprovante: async () => true,
}));

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            fakeState.calls.externalIdLookup += 1;
            return {
              data: fakeState.externalConfirmed
                ? { id: "m-1", status: "salva", gasto_id: "g-1" }
                : null,
              error: null,
            };
          },
        }),
      }),
    }),
  },
}));

mock.module("@/server/whatsapp-transcription.server", () => ({
  runTranscriber: async (buffer: Uint8Array, mimeType: string) => {
    fakeState.calls.transcribe += 1;
    fakeState.calls.transcribeArgs.push({ mimeType, size: buffer.byteLength });
    if (fakeState.transcribeResult.ok) {
      return {
        ok: true,
        text: fakeState.transcribeResult.text,
        language: fakeState.transcribeResult.language,
      };
    }
    return { ok: false, reason: fakeState.transcribeResult.reason ?? "failed" };
  },
  __setTranscriberForTests: () => {},
  transcribeWhatsAppAudio: async () => ({ ok: false, reason: "unavailable" }),
}));

// ---------------- stub do fetch (download da Meta) ----------------

const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalError = console.error;

beforeEach(() => {
  resetState();
  setBaseEnv();
  process.env.WHATSAPP_AUDIO_ENABLED = "true";

  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    fakeState.calls.downloadFetch.push(url);
    // (1) lookup do mediaId — devolve URL "assinada" fictícia.
    if (url.includes("graph.facebook.com/v20.0/")) {
      return new Response(
        JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/audio-x",
          mime_type: fakeState.fakeAudioContentType,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // (2) download dos bytes.
    if (url.includes("lookaside.fbsbx.com")) {
      const arr = new Uint8Array(fakeState.fakeAudioBytes);
      return new Response(arr, {
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
const handlers = (Route as unknown as {
  options: { server: { handlers: Record<string, HttpHandler> } };
}).options.server.handlers;
const POST = handlers.POST;

// ---------------- fixtures ----------------

const PHONE = "5511999990000";

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
                  id: opts.id ?? "wamid.audio-1",
                  from: PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "audio",
                  audio: {
                    id: opts.mediaId ?? "media-audio-1",
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

function signedPostRequest(payload: unknown, opts: { signature?: string | null } = {}) {
  const raw = JSON.stringify(payload);
  const sig =
    opts.signature === undefined
      ? "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex")
      : opts.signature;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return new Request("https://example.com/api/public/whatsapp/expense", {
    method: "POST",
    headers,
    body: raw,
  });
}

// ============================================================
// 1) Flag, gate e ordem antes do download
// ============================================================

test("flag desligada: usuário autorizado → reply seguro, NÃO baixa, NÃO transcreve", async () => {
  process.env.WHATSAPP_AUDIO_ENABLED = "false";
  const res = await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(1);
  expect(fakeState.calls.sendReply[0].texto).toContain("Áudios ainda não estão disponíveis");
});

test("usuário não autorizado: áudio → silêncio total (sem download, transcrição ou reply)", async () => {
  fakeState.elig = { allowed: false };
  const res = await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(0);
});

test("HMAC inválido → 403, sem chamar gate, sem download, sem transcrição", async () => {
  const res = await POST({
    request: signedPostRequest(metaAudioPayload(), {
      signature: "sha256=" + "0".repeat(64),
    }),
  });
  expect(res.status).toBe(403);
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
});

// ============================================================
// 2) Validação de tipo / tamanho / bytes mágicos
// ============================================================

test("MIME declarado inválido → não baixa nem transcreve", async () => {
  const res = await POST({
    request: signedPostRequest(metaAudioPayload({ mime: "audio/amr" })),
  });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("bytes mágicos incompatíveis com MIME declarado → não chama transcrição", async () => {
  fakeState.fakeAudioBytes = Buffer.from("isto não é áudio nenhum", "utf8");
  fakeState.fakeAudioContentType = "audio/ogg";
  const res = await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBeGreaterThan(0);
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("áudio acima do limite → não chama transcrição", async () => {
  process.env.WHATSAPP_AUDIO_MAX_BYTES = "32"; // 32 bytes
  // bytes mágicos OK mas tamanho acima do limite
  fakeState.fakeAudioBytes = Buffer.concat([
    Buffer.from([0x4f, 0x67, 0x67, 0x53]),
    Buffer.alloc(200, 0),
  ]);
  const res = await POST({ request: signedPostRequest(metaAudioPayload()) });
  delete process.env.WHATSAPP_AUDIO_MAX_BYTES;
  expect(res.status).toBe(200);
  // O download é abortado pelo próprio limite passado ao downloader,
  // portanto a transcrição não é chamada.
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("external_id repetido (já confirmado) → não baixa, não transcreve, não reprocessa", async () => {
  fakeState.externalConfirmed = true;
  const res = await POST({ request: signedPostRequest(metaAudioPayload({ id: "wamid.dup" })) });
  expect(res.status).toBe(200);
  expect(fakeState.calls.externalIdLookup).toBe(1);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.transcribe).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

// ============================================================
// 3) Caminho feliz e integração com pipeline textual
// ============================================================

test("áudio válido → transcreve e encaminha o TEXTO ao processarMensagemWhatsApp", async () => {
  const res = await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(res.status).toBe(200);
  expect(fakeState.calls.transcribe).toBe(1);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(1);
  const arg = fakeState.calls.processArgs[0];
  // WA-V1.2 — valor falado por extenso é normalizado em memória antes
  // do pipeline textual existente. Transcript original não é persistido.
  expect(arg.texto).toBe("gastei R$ 42,00 no almoço");
});

test("authorizedUserId do gate é preservado no runMsg enviado ao pipeline", async () => {
  fakeState.elig = { allowed: true, userId: "u-audio-xyz" };
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(fakeState.calls.processArgs[0].authorizedUserId).toBe("u-audio-xyz");
});

test("áudio NÃO cria gasto sem confirmação: o pipeline textual é a fonte única", async () => {
  // O fake do pipeline é o mesmo orquestrador; não criamos outro parser.
  // O número de chamadas a processarMensagemWhatsApp é o único caminho.
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  // Apenas o pipeline textual roda; não há helper financeiro paralelo
  // chamado a partir do handler de áudio.
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(1);
});

// ============================================================
// 4) Falhas de transcrição
// ============================================================

test("transcrição falha → resposta segura ao usuário, NÃO encaminha ao pipeline", async () => {
  fakeState.transcribeResult = { ok: false, text: "", language: null, reason: "failed" };
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(1);
  expect(fakeState.calls.sendReply[0].texto).toContain("Não consegui entender bem o áudio");
});

test("transcrição em idioma não suportado → resposta segura específica", async () => {
  fakeState.transcribeResult = {
    ok: false,
    text: "",
    language: null,
    reason: "unsupported_language",
  };
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply.length).toBe(1);
  expect(fakeState.calls.sendReply[0].texto).toContain("português");
});

test("transcrição vazia → mensagem 'não entendi'", async () => {
  fakeState.transcribeResult = { ok: false, text: "", language: null, reason: "empty" };
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendReply[0].texto).toContain("Não consegui entender");
});

// ============================================================
// 5) Privacidade e observabilidade
// ============================================================

test("transcript NÃO aparece nos logs estruturados de decisão", async () => {
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  const serializedInfo = JSON.stringify(fakeState.calls.consoleInfo);
  expect(serializedInfo).not.toContain(fakeState.transcribeResult.text);
});

test("logs de decisão NÃO contêm telefone, URL Graph, token, base64 ou data URL", async () => {
  await POST({ request: signedPostRequest(metaAudioPayload()) });
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
  expect(all).not.toContain("data:audio/");
  // texto transcrito também não pode vazar
  expect(all).not.toContain(fakeState.transcribeResult.text);
});

test("logs de decisão emitem evento wa_audio_decision com bucket e mimeTypePresent", async () => {
  await POST({ request: signedPostRequest(metaAudioPayload()) });
  const decisions = fakeState.calls.consoleInfo.filter(
    (e) => (e as { event?: string })?.event === "wa_audio_decision",
  ) as Array<Record<string, unknown>>;
  const last = decisions.at(-1);
  expect(last).toBeTruthy();
  expect(last!.decision).toBe("routed_to_text_pipeline");
  expect(last!.source).toBe("audio");
  expect(last!.mimeTypePresent).toBe(true);
  expect(["small", "medium", "large"]).toContain(last!.audioBytesBucket as string);
});
