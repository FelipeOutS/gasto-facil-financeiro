/**
 * WA-B2 — Testes HTTP de integração para o webhook do WhatsApp.
 *
 * Esses testes exercitam o mesmo handler HTTP usado em produção
 * (`/api/public/whatsapp/expense`), atravessando rate-limit, feature
 * flag, HMAC, parse Zod, gate de eligibilidade e pipeline de imagens.
 *
 * Bordas externas mockadas:
 *   - `@/server/whatsapp.server` (pipeline financeiro + envio de reply)
 *   - `@/server/whatsapp-authz.server` (gate de telefone/canary + bloqueio 1×/24h)
 *   - `@/server/whatsapp-comprovantes.server` (`podeUsarOcrComprovante`)
 *   - `@/server/logs.server` (webhook_logs)
 *   - `@/server/rate-limit.server` (sem bater no banco)
 *   - `@/integrations/supabase/client.server` (dedup por external_id)
 *   - `global.fetch` (Graph API da Meta)
 *
 * Nenhuma chamada real a Meta, Supabase, OCR ou Gemini acontece.
 * Nenhum teste loga token, URL assinada, telefone bruto, base64, data
 * URL, e-mail ou plano do usuário.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "crypto";

// -------------------- env de teste --------------------

const APP_SECRET = "test-app-secret-abc";
const VERIFY_TOKEN = "test-verify-token-xyz";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_CANARY_ENABLED: process.env.WHATSAPP_CANARY_ENABLED,
};

function setEnabledEnv() {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token-zzz";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999999999";
  process.env.WHATSAPP_CANARY_ENABLED = "false";
}

// -------------------- estado mutável dos mocks --------------------

type EligResult = { allowed: boolean; userId?: string };
const fakeState = {
  rateBlocked: false,
  elig: { allowed: true, userId: "u-test" } as EligResult,
  shouldBlockReply: true,
  ocrAllowed: true,
  externalConfirmed: false,
  processOutcome: {
    status: "salva" as string,
    resposta: "ok" as string | null,
    gastoId: "g-1" as string | undefined,
  },
  // Histórico de chamadas: usado para asserts de "NÃO chamou".
  calls: {
    canUseWhatsAppForSender: 0,
    podeUsarOcrComprovante: 0,
    processarMensagemWhatsApp: 0,
    sendWhatsAppReply: [] as Array<{ telefone: string; texto: string }>,
    downloadFetch: [] as string[],
    externalIdLookup: 0,
    logEvents: [] as Array<Record<string, unknown>>,
  },
};

function resetState() {
  fakeState.rateBlocked = false;
  fakeState.elig = { allowed: true, userId: "u-test" };
  fakeState.shouldBlockReply = true;
  fakeState.ocrAllowed = true;
  fakeState.externalConfirmed = false;
  fakeState.processOutcome = { status: "salva", resposta: "ok", gastoId: "g-1" };
  fakeState.calls = {
    canUseWhatsAppForSender: 0,
    podeUsarOcrComprovante: 0,
    processarMensagemWhatsApp: 0,
    sendWhatsAppReply: [],
    downloadFetch: [],
    externalIdLookup: 0,
    logEvents: [],
  };
}

// -------------------- mocks de módulos --------------------

mock.module("@/server/rate-limit.server", () => ({
  RATE_LIMIT_PRESETS: { whatsappWebhook: { limit: 60, windowSeconds: 60 } },
  getClientIp: (_req: Request) => "203.0.113.10",
  checkRateLimit: async () => ({
    blocked: fakeState.rateBlocked,
    count: fakeState.rateBlocked ? 999 : 1,
    limit: 60,
    retryAfterSeconds: 60,
  }),
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
  processarMensagemWhatsApp: async (_msg: unknown) => {
    fakeState.calls.processarMensagemWhatsApp += 1;
    return fakeState.processOutcome;
  },
  sendWhatsAppReply: async (telefone: string, texto: string) => {
    fakeState.calls.sendWhatsAppReply.push({ telefone, texto });
  },
  // WA-B6 — stub seguro; nunca chama rede real.
  sendWhatsAppInteractiveCtaUrl: async () => ({ ok: true, status: 200 }),
}));

mock.module("@/server/whatsapp-authz.server", () => ({
  canUseWhatsAppForSender: async (_phone: string, _opts?: unknown) => {
    fakeState.calls.canUseWhatsAppForSender += 1;
    return fakeState.elig;
  },
  shouldSendBlockedReply: async (_phone: string) => fakeState.shouldBlockReply,
  WHATSAPP_BLOCKED_REPLY:
    "Olá! No momento, este número não está vinculado a uma conta ativa.",
}));

mock.module("@/server/whatsapp-comprovantes.server", () => ({
  podeUsarOcrComprovante: async (_userId: string) => {
    fakeState.calls.podeUsarOcrComprovante += 1;
    return fakeState.ocrAllowed;
  },
}));

// WA-C11 Fase 3B.2.B — gate produtivo unificado. Testes de webhook HTTP
// verificam o pipeline técnico (download, OCR, parser); o gate C11 é
// bypassado com allowed=true. Cobertura do gate está em
// tests/whatsapp-c11-f3b2b-inbound-gate.test.ts.
mock.module("@/server/whatsapp-c11-gates.server", () => ({
  runInboundProductionGate: async () => ({
    allowed: true,
    reason: "allowed",
    duplicate: false,
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
    quota: null,
  }),
  canCreateNotificationForUser: async () => ({
    allowed: true,
    reason: "allowed",
    adminMaster: false,
    planCode: "pessoal_premium",
    cycleSource: "calendar_month",
  }),
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

// fetch real só seria chamado pelo download da mídia da Meta. Substituímos
// por um stub que registra a URL e NUNCA contacta a rede.
const originalFetch = globalThis.fetch;
beforeEach(() => {
  resetState();
  setEnabledEnv();
  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    fakeState.calls.downloadFetch.push(url);
    // Stub: indisponível, evita qualquer tentativa de OCR real.
    return new Response("not-available", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// -------------------- importa a rota DEPOIS dos mocks --------------------

const { Route } = await import("../src/routes/api/public.whatsapp.expense");
type HttpHandler = (ctx: { request: Request }) => Promise<Response>;
const handlers = (Route as unknown as {
  options: { server: { handlers: Record<string, HttpHandler> } };
}).options.server.handlers;
const POST = handlers.POST;
const GET = handlers.GET;

// -------------------- fixtures de payload Meta --------------------

const PHONE = "5511999998888";

function metaTextPayload(text = "uber 25", id = "wamid.text-1") {
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
                  id,
                  from: PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function metaImagePayload(opts: {
  id?: string;
  mediaId?: string;
  mime?: string;
  sha?: string;
} = {}) {
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
                  id: opts.id ?? "wamid.img-1",
                  from: PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "image",
                  image: {
                    id: opts.mediaId ?? "media-abc",
                    mime_type: opts.mime,
                    sha256: opts.sha,
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

// -------------------- 1) Verificação GET --------------------

test("GET subscribe + verify token correto + challenge → 200 + challenge", async () => {
  const url = new URL("https://example.com/api/public/whatsapp/expense");
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", VERIFY_TOKEN);
  url.searchParams.set("hub.challenge", "1234567");
  const res = await GET({ request: new Request(url.toString()) });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("1234567");
});

test("GET com verify token inválido → 403", async () => {
  const url = new URL("https://example.com/api/public/whatsapp/expense");
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", "errado");
  url.searchParams.set("hub.challenge", "1234567");
  const res = await GET({ request: new Request(url.toString()) });
  expect(res.status).toBe(403);
});

test("POST respostas incluem X-WA-Handler-Version", async () => {
  const req = signedPostRequest(metaTextPayload());
  const res = await POST({ request: req });
  expect(res.headers.get("X-WA-Handler-Version")).toBe("receipt-session-durable-v5");
});

// -------------------- 2) HMAC e feature flag --------------------

test("POST com HMAC inválido → 403 e NÃO chama gate, parser, banco, download, OCR ou envio", async () => {
  const req = signedPostRequest(metaTextPayload(), { signature: "sha256=" + "0".repeat(64) });
  const res = await POST({ request: req });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "invalid_signature" });
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(0);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.sendWhatsAppReply.length).toBe(0);
  expect(fakeState.calls.externalIdLookup).toBe(0);
});

test("POST sem cabeçalho de assinatura → 403", async () => {
  const req = signedPostRequest(metaTextPayload(), { signature: null });
  const res = await POST({ request: req });
  expect(res.status).toBe(403);
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
});

test("POST com WHATSAPP_ENABLED=false → 503 e NÃO processa", async () => {
  process.env.WHATSAPP_ENABLED = "false";
  const req = signedPostRequest(metaTextPayload());
  const res = await POST({ request: req });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "whatsapp_not_configured" });
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("payload inválido no Zod → resposta segura sem acionar pipeline financeiro", async () => {
  const req = signedPostRequest({ totally: "invalid", entry: "not-an-array" });
  const res = await POST({ request: req });
  // Handler responde 200 com skipped:invalid_payload para a Meta não retentar.
  expect(res.status).toBe(200);
  const body = (await res.json()) as { skipped?: string };
  expect(body.skipped).toBe("invalid_payload");
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
});

// -------------------- 3) Acesso e canary --------------------

test("usuário não elegível enviando texto → 200 silencioso, sem gasto/sessão e com reply neutro 1×", async () => {
  fakeState.elig = { allowed: false };
  fakeState.shouldBlockReply = true;
  const req = signedPostRequest(metaTextPayload("uber 25"));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendWhatsAppReply.length).toBe(1);
  expect(fakeState.calls.sendWhatsAppReply[0].texto).not.toContain("plano");
  expect(fakeState.calls.sendWhatsAppReply[0].texto).not.toContain("@");
});

test("número bloqueado: 1×/24h — segunda mensagem não dispara reply", async () => {
  fakeState.elig = { allowed: false };
  fakeState.shouldBlockReply = true;
  await POST({ request: signedPostRequest(metaTextPayload("oi 1", "wamid.t-a")) });
  expect(fakeState.calls.sendWhatsAppReply.length).toBe(1);
  // Janela já consumida.
  fakeState.shouldBlockReply = false;
  await POST({ request: signedPostRequest(metaTextPayload("oi 2", "wamid.t-b")) });
  expect(fakeState.calls.sendWhatsAppReply.length).toBe(1);
});

test("número não vinculado enviando imagem → 200 silencioso, SEM download e SEM OCR", async () => {
  fakeState.elig = { allowed: false };
  const req = signedPostRequest(metaImagePayload({ mime: "image/jpeg" }));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
  expect(fakeState.calls.sendWhatsAppReply.length).toBe(0);
});

test("Admin Master continua autorizado no canary", async () => {
  process.env.WHATSAPP_CANARY_ENABLED = "true";
  fakeState.elig = { allowed: true, userId: "admin-master-1" };
  const req = signedPostRequest(metaTextPayload("uber 25"));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(1);
});

// -------------------- 4) Imagens e deduplicação --------------------

test("imagem com MIME declarado inválido → ignorada antes do download e antes do OCR", async () => {
  const req = signedPostRequest(metaImagePayload({ mime: "application/pdf" }));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("reenvio com mesmo external_message_id já confirmado → NÃO baixa, NÃO chama OCR, NÃO reprocessa", async () => {
  fakeState.externalConfirmed = true;
  const req = signedPostRequest(metaImagePayload({ mime: "image/jpeg", id: "wamid.dup" }));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.externalIdLookup).toBe(1);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("imagem com external_id novo + plano OK → segue para download (que retorna 404 no stub) sem chegar ao OCR", async () => {
  fakeState.externalConfirmed = false;
  fakeState.ocrAllowed = true;
  const req = signedPostRequest(metaImagePayload({ mime: "image/jpeg", id: "wamid.new" }));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  // Caminho normal: external_id consultado → entitlement → download
  expect(fakeState.calls.externalIdLookup).toBe(1);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(1);
  expect(fakeState.calls.downloadFetch.length).toBeGreaterThan(0);
  // download foi para a Graph API (estamos com fetch stub; nenhuma rede real)
  expect(fakeState.calls.downloadFetch[0]).toContain("graph.facebook.com");
  // Como o stub devolve 404, pipeline não é chamado.
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("imagem sem entitlement de OCR → NÃO baixa mídia da Meta", async () => {
  fakeState.ocrAllowed = false;
  const req = signedPostRequest(metaImagePayload({ mime: "image/jpeg" }));
  const res = await POST({ request: req });
  expect(res.status).toBe(200);
  expect(fakeState.calls.podeUsarOcrComprovante).toBe(1);
  expect(fakeState.calls.downloadFetch.length).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

// -------------------- 5) Rate limit e segurança --------------------

test("rate limit excedido → 429 com Retry-After, sem chamar gate ou pipeline", async () => {
  fakeState.rateBlocked = true;
  const req = signedPostRequest(metaTextPayload());
  const res = await POST({ request: req });
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBeTruthy();
  expect(fakeState.calls.canUseWhatsAppForSender).toBe(0);
  expect(fakeState.calls.processarMensagemWhatsApp).toBe(0);
});

test("respostas para número bloqueado não expõem plano, e-mail, banco, usuário ou motivo interno", async () => {
  fakeState.elig = { allowed: false };
  fakeState.shouldBlockReply = true;
  await POST({ request: signedPostRequest(metaTextPayload("oi", "wamid.blk-msg")) });
  const sent = fakeState.calls.sendWhatsAppReply[0]?.texto ?? "";
  for (const forbidden of [
    "plano",
    "premium",
    "pessoal_premium",
    "free_ads",
    "supabase",
    "auth.uid",
    "user_id",
    "@",
    "row level security",
    "RLS",
  ]) {
    expect(sent.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
});

test("logs do webhook NÃO contêm telefone bruto, token, URL de mídia, base64 ou data URL", async () => {
  await POST({ request: signedPostRequest(metaTextPayload("uber 25", "wamid.log-1")) });
  await POST({ request: signedPostRequest(metaImagePayload({ mime: "image/jpeg", id: "wamid.log-2" })) });
  const serialized = JSON.stringify(fakeState.calls.logEvents);
  expect(serialized).not.toContain(PHONE);
  expect(serialized).not.toContain("graph.facebook.com");
  expect(serialized).not.toContain("data:image/");
  expect(serialized).not.toContain("base64,");
  expect(serialized).not.toContain(APP_SECRET);
  expect(serialized).not.toContain(process.env.WHATSAPP_ACCESS_TOKEN!);
});
