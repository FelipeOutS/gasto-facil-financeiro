/**
 * WA-B3 — Hardening pré-beta: testes das correções P1/P2.
 *
 * Cobertura:
 *   1) Pipeline usa userId vindo do gate sem refazer resolveUserId.
 *   2) Dedup pré-download por external_id agora cobre receita simples,
 *      receita recorrente e gasto/comprovante confirmado.
 *   3) atualizarSessao retorna resultado explícito + falha bloqueia
 *      criação de gasto/receita via wrapper crítico.
 *   4) sendWhatsAppReply NUNCA loga err.message bruto.
 *   5) Fallback diagnóstico de sessão de comprovante NÃO roda por
 *      padrão; hard gate de comprovante continua intacto.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHmac } from "crypto";

// -------------------- shared fake supabaseAdmin ----------------------------

type QueryRecord = { table: string; op: string; filters: Record<string, unknown> };

const state = {
  queries: [] as QueryRecord[],
  // Para buscarSessaoComprovanteAtiva: arrays retornados por cada
  // `.limit(...)`. Index = ordem da query nessa execução.
  comprovanteRows: [] as Array<Record<string, unknown>[]>,
  comprovanteCallIdx: 0,
  // Para externalIdAlreadyConfirmed e outros maybeSingle().
  maybeSingleData: null as Record<string, unknown> | null,
  // Para atualizarSessao: força erro RLS.
  updateError: null as { code: string } | null,
  updateData: null as { id: string; status: string } | null,
  // Para resolveUserId (legacy): retorna null para indicar sem vínculo.
  linkRow: null as Record<string, unknown> | null,
};

function freshState() {
  state.queries = [];
  state.comprovanteRows = [];
  state.comprovanteCallIdx = 0;
  state.maybeSingleData = null;
  state.updateError = null;
  state.updateData = null;
  state.linkRow = null;
}

function buildBuilder(table: string) {
  const ctx: { table: string; op: string; filters: Record<string, unknown> } = {
    table,
    op: "select",
    filters: {},
  };
  const chain: any = {
    select: () => chain,
    insert: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: { id: "ins-1", status: "salva" }, error: null }),
        single: async () => ({ data: { id: "ins-1" }, error: null }),
      }),
    }),
    update: () => {
      ctx.op = "update";
      return {
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              state.queries.push({ ...ctx });
              return { data: state.updateData, error: state.updateError };
            },
          }),
        }),
      };
    },
    delete: () => chain,
    eq: (col: string, val: unknown) => {
      ctx.filters[col] = val;
      return chain;
    },
    in: (col: string, val: unknown) => {
      ctx.filters[col] = val;
      return chain;
    },
    not: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: async () => {
      state.queries.push({ ...ctx });
      if (table === "whatsapp_messages") {
        const idx = state.comprovanteCallIdx++;
        return { data: state.comprovanteRows[idx] ?? [], error: null };
      }
      return { data: [], error: null };
    },
    maybeSingle: async () => {
      state.queries.push({ ...ctx });
      if (table === "whatsapp_links") {
        return { data: state.linkRow, error: null };
      }
      return { data: state.maybeSingleData, error: null };
    },
  };
  return chain;
}

const fakeSupabaseAdmin: any = {
  from: (table: string) => buildBuilder(table),
  rpc: async () => ({ data: null, error: null }),
  auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
};

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeSupabaseAdmin,
}));
mock.module("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeSupabaseAdmin,
}));

// Subscription module: evita network/db real.
mock.module("@/server/subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: false, plan: "free" }),
}));
mock.module("./subscription.server", () => ({
  getSubscriptionForUserIdentity: async () => ({ active: false, plan: "free" }),
}));

// Agora podemos importar o módulo sob teste.
const whatsappServer = await import("../src/server/whatsapp.server");

beforeEach(() => {
  freshState();
});

afterEach(() => {
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
});

// =========================================================================
// 1) Identidade autorizada propagada pelo gate
// =========================================================================

test("WA-B3.1 — processarMensagemWhatsApp com authorizedUserId NÃO consulta whatsapp_links", async () => {
  await whatsappServer.processarMensagemWhatsApp({
    external_id: "wamid.auth-1",
    telefone: "5511999990000",
    texto: "oi",
    authorizedUserId: "u-authorized-1",
  });
  const linkLookups = state.queries.filter((q) => q.table === "whatsapp_links");
  expect(linkLookups.length).toBe(0);
});

test("WA-B3.1 — pipeline SEM authorizedUserId AINDA consulta whatsapp_links (compat)", async () => {
  await whatsappServer.processarMensagemWhatsApp({
    external_id: "wamid.legacy-1",
    telefone: "5511999990001",
    texto: "oi",
  });
  const linkLookups = state.queries.filter((q) => q.table === "whatsapp_links");
  expect(linkLookups.length).toBeGreaterThan(0);
});

// =========================================================================
// 3) atualizarSessao retorna resultado explícito + wrapper crítico
// =========================================================================

test("WA-B3.3 — atualizarSessaoOuFalhar retorna outcome neutro quando update falha e loga sem PII", async () => {
  state.updateError = { code: "42501" }; // RLS-like
  state.updateData = null;

  const logs: any[] = [];
  const origErr = console.error;
  console.error = ((...a: any[]) => logs.push(a)) as any;

  const { atualizarSessaoOuFalhar, WA_SESSION_UPDATE_FALLBACK_REPLY } = whatsappServer as any;
  const r = await atualizarSessaoOuFalhar(
    "11111111-2222-3333-4444-555555555555",
    "salva",
    { nome: "x", valor: 1, data: "2026-01-01", mensagemOriginal: "x", confianca: 0.9 } as any,
    "ok",
    "gasto-xyz",
  );

  console.error = origErr;

  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.outcome.status).toBe("erro");
    expect(r.outcome.resposta).toBe(WA_SESSION_UPDATE_FALLBACK_REPLY);
  }
  const flat = JSON.stringify(logs);
  expect(flat).toContain("wa_session_update_failed");
  expect(flat).toContain("42501");
  expect(flat).not.toContain("Bearer");
  expect(flat).not.toContain("graph.facebook");
  expect(flat).not.toContain("5511");
  expect(flat).not.toContain("mensagemOriginal");
});

test("WA-B3.3 — atualizarSessaoOuFalhar com sucesso devolve {ok:true}", async () => {
  state.updateError = null;
  state.updateData = { id: "abc", status: "salva" };
  const { atualizarSessaoOuFalhar } = whatsappServer as any;
  const r = await atualizarSessaoOuFalhar(
    "abc",
    "salva",
    { nome: "x", valor: 1, data: "2026-01-01", mensagemOriginal: "x", confianca: 0.9 } as any,
    "ok",
  );
  expect(r.ok).toBe(true);
});

// =========================================================================
// 4) sendWhatsAppReply — sanitização de log
// =========================================================================

test("WA-B3.4 — sendWhatsAppReply NÃO loga err.message bruto (exception path)", async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = "supersecret-token-aaaa";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const e = new Error(
      "fetch failed for https://graph.facebook.com/v20.0/999/messages with token supersecret-token-aaaa",
    );
    e.name = "NetworkError";
    throw e;
  }) as any;

  const logs: any[] = [];
  const origErr = console.error;
  console.error = ((...a: any[]) => logs.push(a)) as any;

  const r = await whatsappServer.sendWhatsAppReply("5511999998888", "oi");

  console.error = origErr;
  globalThis.fetch = originalFetch;

  expect(r.sent).toBe(false);
  const flat = JSON.stringify(logs);
  expect(flat).toContain("NetworkError");
  expect(flat).toContain("wa_reply_failed");
  expect(flat).not.toContain("supersecret-token-aaaa");
  expect(flat).not.toContain("graph.facebook.com");
  expect(flat).not.toContain("5511999998888");
});

test("WA-B3.4 — sendWhatsAppReply NÃO loga corpo da resposta quando HTTP status indica erro", async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = "token-xyz";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("internal error body", { status: 500 })) as any;

  const logs: any[] = [];
  const origErr = console.error;
  console.error = ((...a: any[]) => logs.push(a)) as any;
  await whatsappServer.sendWhatsAppReply("5511999998888", "oi");
  console.error = origErr;
  globalThis.fetch = originalFetch;

  const flat = JSON.stringify(logs);
  expect(flat).toContain("wa_reply_failed");
  expect(flat).toContain("500");
  expect(flat).not.toContain("internal error body");
  expect(flat).not.toContain("token-xyz");
  expect(flat).not.toContain("5511999998888");
});

// =========================================================================
// 5) Fallback diagnóstico — desligado por padrão; hard gate intacto
// =========================================================================

test("WA-B3.5 — buscarSessaoComprovanteAtiva NÃO roda fallback diagnóstico por padrão", async () => {
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
  state.comprovanteRows = [[], []]; // byStatus, byKind, sem fallback
  const result = await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  // Apenas 2 queries: byStatus + byKind. O fallback estaria como uma 3ª.
  const msgQueries = state.queries.filter((q) => q.table === "whatsapp_messages");
  expect(msgQueries.length).toBe(2);
  expect(result.sessionFoundByFallbackQuery).toBe(false);
});

test("WA-B3.5 — fallback diagnóstico só ativa quando WHATSAPP_SESSION_AUDIT_FALLBACK=true", async () => {
  process.env.WHATSAPP_SESSION_AUDIT_FALLBACK = "true";
  state.comprovanteRows = [[], [], []];
  await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  const msgQueries = state.queries.filter((q) => q.table === "whatsapp_messages");
  expect(msgQueries.length).toBe(3);
});

test("WA-B3.5 — hard gate de comprovante continua: status pendente é detectado sem precisar de fallback", async () => {
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
  const row = {
    id: "m-1",
    status: "img_aguardando_categoria_obrigatoria",
    parsed: { kind: "imagem_comprovante", confianca: "alta" },
    recebida_em: new Date().toISOString(),
  };
  state.comprovanteRows = [[row], []];
  const result = await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  expect(result.sessao?.id).toBe("m-1");
  expect(result.sessionFoundByStatus).toBe(true);
});

// =========================================================================
// 2) Dedup pré-download por external_id (gasto / receita / recorrência)
// =========================================================================
//
// Este bloco exercita o handler HTTP do webhook real. Mocks específicos
// devem ser registrados ANTES da primeira importação da rota — fazemos
// isso aqui (a rota só é importada uma vez).

let routePOST: ((ctx: { request: Request }) => Promise<Response>) | null = null;
const APP_SECRET = "secret-b3";

async function ensureRoute() {
  if (routePOST) return;
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-b3";
  process.env.WHATSAPP_ACCESS_TOKEN = "token-b3";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  process.env.WHATSAPP_CANARY_ENABLED = "false";

  mock.module("@/server/rate-limit.server", () => ({
    RATE_LIMIT_PRESETS: { whatsappWebhook: { limit: 60, windowSeconds: 60 } },
    getClientIp: () => "1.2.3.4",
    checkRateLimit: async () => ({ blocked: false, count: 1, limit: 60, retryAfterSeconds: 60 }),
  }));
  mock.module("@/server/logs.server", () => ({
    logWebhookEvent: async () => "log-1",
    updateWebhookLog: async () => {},
  }));
  mock.module("@/server/whatsapp.server", () => ({
    WHATSAPP_HANDLER_VERSION: "test-v",
    logWhatsAppInboundReceived: () => {},
    processarMensagemWhatsApp: async () => {
      dedupState.processCalls += 1;
      return { status: "ok", resposta: null };
    },
    sendWhatsAppReply: async () => {},
  }));
  mock.module("@/server/whatsapp-authz.server", () => ({
    canUseWhatsAppForSender: async () => ({ allowed: true, userId: "u-1" }),
    shouldSendBlockedReply: async () => false,
    WHATSAPP_BLOCKED_REPLY: "blocked",
  }));
  mock.module("@/server/whatsapp-comprovantes.server", () => ({
    podeUsarOcrComprovante: async () => true,
  }));

  // SubstituiSubstitui a fonte do externalIdAlreadyConfirmed via supabaseAdmin:
  // o fake global já cobre `.from('whatsapp_messages').select(...).eq(...).maybeSingle()`
  // através de `state.maybeSingleData`.
  const r = await import("../src/routes/api/public.whatsapp.expense");
  routePOST = (r.Route as any).options.server.handlers.POST;
}

const dedupState = { processCalls: 0, downloadCalls: 0 };

function buildImageReq(externalId: string) {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e1",
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id: externalId,
                  from: "5511999990002",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "image",
                  image: { id: "media-x", mime_type: "image/jpeg" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);
  return new Request("https://example.com/api/public/whatsapp/expense", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256":
        "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex"),
    },
    body: raw,
  });
}

test("WA-B3.2 — dedup bloqueia reentrega de GASTO confirmado", async () => {
  await ensureRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    dedupState.downloadCalls += 1;
    return new Response("nope", { status: 404 });
  }) as any;

  state.maybeSingleData = { id: "m-1", status: "salva", gasto_id: "g-1", parsed: {} };
  dedupState.downloadCalls = 0;
  await routePOST!({ request: buildImageReq("wamid.dup-gasto") });
  globalThis.fetch = originalFetch;
  expect(dedupState.downloadCalls).toBe(0);
});

test("WA-B3.2 — dedup bloqueia reentrega de RECEITA SIMPLES confirmada", async () => {
  await ensureRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    dedupState.downloadCalls += 1;
    return new Response("nope", { status: 404 });
  }) as any;

  state.maybeSingleData = {
    id: "m-2",
    status: "salva",
    gasto_id: null,
    parsed: { kind: "receita", status: "salva", receita_id: "r-1" },
  };
  dedupState.downloadCalls = 0;
  await routePOST!({ request: buildImageReq("wamid.dup-receita") });
  globalThis.fetch = originalFetch;
  expect(dedupState.downloadCalls).toBe(0);
});

test("WA-B3.2 — dedup bloqueia reentrega de RECEITA RECORRENTE confirmada", async () => {
  await ensureRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    dedupState.downloadCalls += 1;
    return new Response("nope", { status: 404 });
  }) as any;

  state.maybeSingleData = {
    id: "m-3",
    status: "salva",
    gasto_id: null,
    parsed: { kind: "receita", status: "salva", recorrencia_id: "rec-1" },
  };
  dedupState.downloadCalls = 0;
  await routePOST!({ request: buildImageReq("wamid.dup-recorrencia") });
  globalThis.fetch = originalFetch;
  expect(dedupState.downloadCalls).toBe(0);
});

test("WA-B3.2 — sessão PENDENTE (não salva) NÃO é deduplicada (segue para download)", async () => {
  await ensureRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    dedupState.downloadCalls += 1;
    return new Response("nope", { status: 404 });
  }) as any;

  state.maybeSingleData = {
    id: "m-4",
    status: "aguardando_confirmacao",
    gasto_id: null,
    parsed: {},
  };
  dedupState.downloadCalls = 0;
  await routePOST!({ request: buildImageReq("wamid.pending") });
  globalThis.fetch = originalFetch;
  expect(dedupState.downloadCalls).toBeGreaterThan(0);
});
