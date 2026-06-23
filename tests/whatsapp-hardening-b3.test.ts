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

// =========================================================================
// 1) Identidade autorizada propagada pelo gate (sem novo resolveUserId)
// =========================================================================

import * as whatsappServer from "../src/server/whatsapp.server";

test("WA-B3.1 — processarMensagemWhatsApp usa msg.authorizedUserId e NÃO refaz resolveUserId/userPodeUsarWhatsApp", async () => {
  // Fake supabaseAdmin que registraria QUALQUER lookup em whatsapp_links
  // (resolveUserId) ou checagem de plano. Se forem chamados → falha.
  const calls: string[] = [];
  const fakeSb: any = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      const chain: any = {
        select: () => chain,
        insert: (row: any) => ({
          select: () => ({
            maybeSingle: async () => {
              calls.push(`insert:${table}`);
              return { data: { id: "msg-1", status: row.status }, error: null };
            },
            single: async () => ({ data: { id: "g-1" }, error: null }),
          }),
        }),
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "x" } } }) } },
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  // Forçamos que processarMensagemWhatsApp não consiga avançar muito:
  // queremos provar que com `authorizedUserId`, NÃO há chamada a
  // whatsapp_links (resolveUserId) nem a tabela de assinaturas/plano.
  // Mensagem inválida (sem texto nem imagem) é descartada cedo, MAS
  // depois da decisão de autorização, então o teste real é: se passamos
  // authorizedUserId, o link lookup nem acontece.
  await whatsappServer.processarMensagemWhatsApp({
    external_id: "wamid.auth-1",
    telefone: "5511999990000",
    texto: "oi",
    authorizedUserId: "u-authorized-1",
  });
  // O caminho legado tocaria whatsapp_links e whatsapp_beta_access (RPC).
  // Com authorizedUserId, NENHUM destes lookups deve aparecer.
  expect(calls.filter((c) => c === "from:whatsapp_links").length).toBe(0);
});

test("WA-B3.1 — pipeline SEM authorizedUserId ainda usa resolveUserId (compat retroativa)", async () => {
  const calls: string[] = [];
  const fakeSb: any = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  await whatsappServer.processarMensagemWhatsApp({
    external_id: "wamid.legacy-1",
    telefone: "5511999990001",
    texto: "oi",
  });
  // Sem authorizedUserId, o lookup em whatsapp_links DEVE acontecer.
  expect(calls.filter((c) => c === "from:whatsapp_links").length).toBeGreaterThan(0);
});

// =========================================================================
// 2) Dedup pré-download por external_id (gasto / receita / recorrência)
// =========================================================================

test("WA-B3.2 — externalIdAlreadyConfirmed bloqueia reentrega de gasto confirmado, receita simples e receita recorrente", async () => {
  // Estratégia: importamos o handler do webhook e exercitamos a função
  // através do POST. Para isolar o comportamento da dedup, alternamos
  // o `data` retornado pelo mock supabaseAdmin para cada caso.
  const fakeReturn = { current: null as any };
  const fakeSb: any = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: fakeReturn.current, error: null }) }),
      }),
    }),
  };

  // Setup env completo para o webhook estar habilitado.
  const APP_SECRET = "secret-b3";
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-b3";
  process.env.WHATSAPP_ACCESS_TOKEN = "token-b3";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  process.env.WHATSAPP_CANARY_ENABLED = "false";

  let processCalls = 0;
  let downloadCalls = 0;
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
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
      processCalls += 1;
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
  globalThis.fetch = (async (input: any) => {
    downloadCalls += 1;
    const _ = typeof input === "string" ? input : input?.url ?? "";
    return new Response("nope", { status: 404 });
  }) as any;

  const { Route } = await import("../src/routes/api/public.whatsapp.expense");
  const POST = (Route as any).options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;

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

  // (a) Gasto confirmado → dedup bloqueia download.
  fakeReturn.current = { id: "m-1", status: "salva", gasto_id: "g-1", parsed: {} };
  downloadCalls = 0;
  processCalls = 0;
  await POST({ request: buildImageReq("wamid.dup-gasto") });
  expect(downloadCalls).toBe(0);
  expect(processCalls).toBe(0);

  // (b) Receita simples confirmada → dedup bloqueia.
  fakeReturn.current = {
    id: "m-2",
    status: "salva",
    gasto_id: null,
    parsed: { kind: "receita", status: "salva", receita_id: "r-1" },
  };
  downloadCalls = 0;
  await POST({ request: buildImageReq("wamid.dup-receita") });
  expect(downloadCalls).toBe(0);

  // (c) Receita recorrente confirmada → dedup bloqueia.
  fakeReturn.current = {
    id: "m-3",
    status: "salva",
    gasto_id: null,
    parsed: { kind: "receita", status: "salva", recorrencia_id: "rec-1" },
  };
  downloadCalls = 0;
  await POST({ request: buildImageReq("wamid.dup-recorrencia") });
  expect(downloadCalls).toBe(0);

  // (d) Sessão pendente (não salva) → NÃO bloqueia → download ocorre.
  fakeReturn.current = { id: "m-4", status: "aguardando_confirmacao", gasto_id: null, parsed: {} };
  downloadCalls = 0;
  await POST({ request: buildImageReq("wamid.pending") });
  expect(downloadCalls).toBeGreaterThan(0);
});

// =========================================================================
// 3) Falha de atualizarSessao → wrapper crítico bloqueia commit financeiro
// =========================================================================

test("WA-B3.3 — atualizarSessaoOuFalhar retorna outcome neutro quando update falha (não cria gasto/receita)", async () => {
  // Forçamos `supabaseAdmin.from('whatsapp_messages').update(...).eq().select().maybeSingle()`
  // a devolver `{ data: null, error: { code: 'RLS' } }`.
  const fakeSb: any = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "RLS" } }) }),
        }),
      }),
    }),
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  // Reimporta whatsapp.server para pegar o mock.
  const mod = await import("../src/server/whatsapp.server?b3-update-fail" as any);
  const { atualizarSessaoOuFalhar, WA_SESSION_UPDATE_FALLBACK_REPLY } = (whatsappServer as unknown) as {
    atualizarSessaoOuFalhar: any;
    WA_SESSION_UPDATE_FALLBACK_REPLY: string;
  };
  void mod;

  // Captura logs para checar formato seguro.
  const logs: any[] = [];
  const origErr = console.error;
  console.error = ((...a: any[]) => logs.push(a)) as any;

  const result = await atualizarSessaoOuFalhar(
    "11111111-2222-3333-4444-555555555555",
    "salva",
    { nome: "x", valor: 1, data: "2026-01-01", mensagemOriginal: "x", confianca: 0.9 } as any,
    "ok",
    "gasto-xyz",
  );

  console.error = origErr;

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.outcome.status).toBe("erro");
    expect(result.outcome.resposta).toBe(WA_SESSION_UPDATE_FALLBACK_REPLY);
  }
  // Log de falha existe e NÃO contém telefone, texto, valor, mensagem,
  // OCR, URL, token nem conteúdo da sessão.
  const flat = JSON.stringify(logs);
  expect(flat).toContain("wa_session_update_failed");
  expect(flat).toContain("RLS");
  expect(flat).not.toContain("Bearer");
  expect(flat).not.toContain("graph.facebook");
  expect(flat).not.toContain("5511"); // telefone
  expect(flat).not.toContain("mensagemOriginal");
});

test("WA-B3.3 — sucesso de atualizarSessaoOuFalhar deixa o caller seguir (ok:true)", async () => {
  const fakeSb: any = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { id: "abc", status: "salva" }, error: null }),
          }),
        }),
      }),
    }),
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

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

test("WA-B3.4 — sendWhatsAppReply NÃO loga err.message bruto em falha de rede", async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = "supersecret-token-aaaa";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  // fetch lança erro com mensagem contendo URL e token — esse texto NÃO
  // pode aparecer em logs.
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

  expect(r.sent).toBe(false);
  const flat = JSON.stringify(logs);
  // Apenas o nome do erro vai para o log.
  expect(flat).toContain("NetworkError");
  expect(flat).toContain("wa_reply_failed");
  // E nunca o conteúdo perigoso.
  expect(flat).not.toContain("supersecret-token-aaaa");
  expect(flat).not.toContain("graph.facebook.com");
  expect(flat).not.toContain("5511999998888");
});

test("WA-B3.4 — sendWhatsAppReply NÃO loga corpo do request quando HTTP status indica erro", async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = "token-xyz";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
  globalThis.fetch = (async () => new Response("internal error body", { status: 500 })) as any;

  const logs: any[] = [];
  const origErr = console.error;
  console.error = ((...a: any[]) => logs.push(a)) as any;
  await whatsappServer.sendWhatsAppReply("5511999998888", "oi");
  console.error = origErr;

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
  const queries: Array<{ filters: Record<string, unknown> }> = [];
  const fakeSb: any = {
    from: () => {
      const ctx: any = { filters: {} as Record<string, unknown> };
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          ctx.filters[col] = val;
          return chain;
        },
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: async () => {
          queries.push({ filters: { ...ctx.filters } });
          return { data: [], error: null };
        },
      };
      return chain;
    },
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  const result = await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  // Esperamos 2 queries (byStatus + byKind) — o fallback estaria como uma 3ª.
  expect(queries.length).toBe(2);
  expect(result.sessionFoundByFallbackQuery).toBe(false);
});

test("WA-B3.5 — fallback diagnóstico só ativa quando WHATSAPP_SESSION_AUDIT_FALLBACK=true", async () => {
  process.env.WHATSAPP_SESSION_AUDIT_FALLBACK = "true";
  let queryCount = 0;
  const fakeSb: any = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: async () => {
          queryCount += 1;
          return { data: [], error: null };
        },
      };
      return chain;
    },
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  expect(queryCount).toBe(3); // byStatus + byKind + fallback
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
});

test("WA-B3.5 — hard gate de comprovante continua: status pendente é detectado mesmo sem fallback", async () => {
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
  const fakeRow = {
    id: "m-1",
    status: "img_aguardando_categoria_obrigatoria",
    parsed: { kind: "imagem_comprovante", confianca: "alta" },
    recebida_em: new Date().toISOString(),
  };
  let call = 0;
  const fakeSb: any = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: async () => {
          call += 1;
          // Primeira query (byStatus) devolve a linha.
          return { data: call === 1 ? [fakeRow] : [], error: null };
        },
      };
      return chain;
    },
  };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeSb }));

  const result = await whatsappServer.buscarSessaoComprovanteAtiva("u-1", "5511999998888");
  expect(result.sessao?.id).toBe("m-1");
  expect(result.sessionFoundByStatus).toBe(true);
});

afterEach(() => {
  delete process.env.WHATSAPP_SESSION_AUDIT_FALLBACK;
});
