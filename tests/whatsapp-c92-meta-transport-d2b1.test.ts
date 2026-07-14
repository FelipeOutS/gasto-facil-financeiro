/**
 * WA-C9.2 Fase D.2B.1 — Testes do transporte Meta isolado, classificação e gating.
 *
 * NUNCA usa rede. `fetchFn` é sempre injetado. Testes cobrem:
 *  - factory fail-closed (env ausente / inválida)
 *  - sendTemplate: accepted / rejected (categorias) / ambiguous (timeout, 5xx, invalid JSON, 2xx s/ pmid, response too large)
 *  - Authorization Bearer; token não vaza em URL nem body nem log
 *  - endpoint via buildWhatsAppGraphUrl com v20.0
 *  - biz_opaque_callback_data = clientReference
 *  - parseJsonSafe, extractProviderMessageId, extractMetaError, categorizeStatus
 *  - isOutboundHttpAllowed: dupla trava com todas combinações
 */

import { describe, it, expect } from "bun:test";
import {
  MetaWhatsAppNotificationTransport,
  META_TRANSPORT_DEFAULTS,
  categorizeStatus,
  createMetaWhatsAppNotificationTransport,
  extractMetaError,
  extractProviderMessageId,
  parseJsonSafe,
  type FetchLike,
  type MetaFetchResponse,
} from "@/server/whatsapp-meta-transport.server";
import { isOutboundHttpAllowed } from "@/server/whatsapp-outbound-gates.server";
import type { TransportSendInput } from "@/server/whatsapp-outbound-adapter.server";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fetch mock

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

function makeFetch(
  responder: (call: CapturedCall) => Promise<MetaFetchResponse> | MetaFetchResponse,
  captures: CapturedCall[] = [],
): { fetchFn: FetchLike; captures: CapturedCall[] } {
  const fetchFn: FetchLike = async (url, init) => {
    const call: CapturedCall = { url, ...init };
    captures.push(call);
    return await responder(call);
  };
  return { fetchFn, captures };
}

function jsonResponse(status: number, body: unknown): MetaFetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const map = new Map<string, string>([
    ["content-type", "application/json"],
    ["content-length", String(text.length)],
  ]);
  return {
    status,
    headers: { get: (n: string) => map.get(n.toLowerCase()) ?? null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    body: null,
  };
}

function sendInput(overrides: Partial<TransportSendInput> = {}): TransportSendInput {
  return {
    phoneNumberId: "1234567890",
    recipient: "5511999999999",
    templateName: "gi_conta_vencendo_hoje",
    languageCode: "pt_BR",
    components: [],
    clientReference: "cref-abc123def456",
    attemptToken: "tok-xyz",
    ...overrides,
  };
}

function makeTransport(
  fetchFn: FetchLike,
  opts: { logger?: (e: Record<string, unknown>) => void; now?: () => number; responseMaxBytes?: number; timeoutMs?: number } = {},
) {
  return new MetaWhatsAppNotificationTransport({
    graphApiVersion: "v20.0",
    phoneNumberId: "1234567890",
    accessToken: "SECRET_TOKEN_DO_NOT_LEAK",
    timeoutMs: opts.timeoutMs ?? 5_000,
    fetchFn,
    logger: opts.logger,
    now: opts.now,
    responseMaxBytes: opts.responseMaxBytes,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory

describe("createMetaWhatsAppNotificationTransport — factory fail-closed", () => {
  it("fail: phone_number_id_missing", () => {
    const r = createMetaWhatsAppNotificationTransport({
      accessToken: "t", fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn, phoneNumberId: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("phone_number_id_missing");
  });
  it("fail: phone_number_id_invalid (não-digits)", () => {
    const r = createMetaWhatsAppNotificationTransport({
      accessToken: "t", phoneNumberId: "abc-123", fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("phone_number_id_invalid");
  });
  it("fail: access_token_missing", () => {
    const r = createMetaWhatsAppNotificationTransport({
      phoneNumberId: "1", accessToken: "", fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("access_token_missing");
  });
  it("fail: timeout_invalid (fora do intervalo)", () => {
    const r = createMetaWhatsAppNotificationTransport({
      phoneNumberId: "1", accessToken: "t", timeoutMs: 999, fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout_invalid");
  });
  it("ok: retorna transporte quando tudo válido", () => {
    const r = createMetaWhatsAppNotificationTransport({
      phoneNumberId: "1234567890", accessToken: "t", fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.transport.sendTemplate).toBe("function");
  });
  it("resultado NUNCA contém accessToken via keys/toJSON", () => {
    const r = createMetaWhatsAppNotificationTransport({
      phoneNumberId: "1234567890", accessToken: "SECRET_LEAKABLE", fetchFn: makeFetch(() => jsonResponse(200, {})).fetchFn,
    });
    if (!r.ok) throw new Error("expected ok");
    const s = JSON.stringify(r.transport);
    expect(s).not.toContain("SECRET_LEAKABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint / headers / body

describe("MetaWhatsAppNotificationTransport — request shape", () => {
  it("usa v20.0, phone number ID no path, Authorization Bearer, e client_reference como biz_opaque_callback_data", async () => {
    const { fetchFn, captures } = makeFetch(() =>
      jsonResponse(200, { messages: [{ id: "wamid.HBg=" }] }),
    );
    const t = makeTransport(fetchFn);
    const res = await t.sendTemplate(sendInput());
    expect(res.kind).toBe("accepted");
    expect(captures).toHaveLength(1);
    const c = captures[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe("https://graph.facebook.com/v20.0/1234567890/messages");
    expect(c.headers.Authorization).toBe("Bearer SECRET_TOKEN_DO_NOT_LEAK");
    expect(c.headers["Content-Type"]).toBe("application/json");
    // URL nunca contém o token
    expect(c.url).not.toContain("SECRET_TOKEN");
    const parsed = JSON.parse(c.body);
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.to).toBe("5511999999999");
    expect(parsed.template.name).toBe("gi_conta_vencendo_hoje");
    expect(parsed.biz_opaque_callback_data).toBe("cref-abc123def456");
    // body nunca contém token
    expect(c.body).not.toContain("SECRET_TOKEN");
    expect(c.body).not.toContain("access_token");
  });

  it("logs padrão NÃO contêm token nem PMID cru", async () => {
    const events: Record<string, unknown>[] = [];
    const { fetchFn } = makeFetch(() => jsonResponse(200, { messages: [{ id: "wamid.SUPERSECRETPMID" }] }));
    const t = makeTransport(fetchFn, { logger: (e) => events.push(e) });
    await t.sendTemplate(sendInput());
    const joined = JSON.stringify(events);
    expect(joined).not.toContain("SECRET_TOKEN");
    expect(joined).not.toContain("wamid.SUPERSECRETPMID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Classificação

describe("sendTemplate — classificação", () => {
  it("2xx com messages[0].id → accepted com PMID", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(200, { messages: [{ id: "wamid.ABC123" }] }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("accepted");
    if (r.kind === "accepted") {
      expect(r.providerMessageId).toBe("wamid.ABC123");
      expect(r.httpStatus).toBe(200);
    }
  });

  it("2xx sem messages[].id → ambiguous(missing_pmid)", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(200, { messages: [] }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("missing_pmid");
  });

  it("2xx com error estruturado → ambiguous(2xx_with_error)", async () => {
    const { fetchFn } = makeFetch(() =>
      jsonResponse(200, { messages: [{ id: "wamid.X" }], error: { code: 131047, message: "policy" } }),
    );
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("2xx_with_error");
  });

  it("401 estruturado → rejected authentication não-retryable", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(401, { error: { code: 190, message: "invalid token" } }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") {
      expect(r.errorCategory).toBe("authentication");
      expect(r.retryable).toBe(false);
    }
  });

  it("403 estruturado → rejected configuration não-retryable", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(403, { error: { code: 10, message: "forbidden" } }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") {
      expect(r.errorCategory).toBe("configuration");
      expect(r.retryable).toBe(false);
    }
  });

  it("429 estruturado → rejected rate_limit retryable", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(429, { error: { code: 80007, message: "rate limit" } }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") {
      expect(r.errorCategory).toBe("rate_limit");
      expect(r.retryable).toBe(true);
    }
  });

  it("400 estruturado → rejected permanent não-retryable", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(400, { error: { code: 100, message: "bad param" } }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") {
      expect(r.errorCategory).toBe("permanent");
      expect(r.retryable).toBe(false);
    }
  });

  it("500 estruturado → ambiguous(5xx_inconclusive)", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(500, { error: { code: 1, message: "server" } }));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("5xx_inconclusive");
  });

  it("4xx sem estrutura → ambiguous(unstructured_error) exceto 401/403/429", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(418, "not json at all"));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
  });

  it("401 sem body → rejected authentication", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(401, ""));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.errorCategory).toBe("authentication");
  });

  it("JSON inválido em 2xx → ambiguous(invalid_json)", async () => {
    const { fetchFn } = makeFetch(() => jsonResponse(200, "{not-json"));
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("invalid_json");
  });

  it("network error → ambiguous(network_error), zero retry interno", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      throw new Error("ECONNRESET");
    };
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("network_error");
    expect(calls).toBe(1);
  });

  it("timeout → ambiguous(timeout) e AbortSignal disparado", async () => {
    const fetchFn: FetchLike = (_url, init) =>
      new Promise<MetaFetchResponse>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e: Error & { name: string } = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    const t = makeTransport(fetchFn, { timeoutMs: 1_000 });
    const p = t.sendTemplate(sendInput({ timeoutMs: 1_000 }));
    // não pode setar timeoutMs muito curto — o construtor exige >=1000; use fake fetch que aborta imediatamente
    const r = await p;
    expect(r.kind).toBe("ambiguous");
  });

  it("response too large via content-length → ambiguous(response_too_large)", async () => {
    const bigLen = META_TRANSPORT_DEFAULTS.RESPONSE_MAX_BYTES + 1;
    const { fetchFn } = makeFetch(() => {
      const map = new Map<string, string>([["content-length", String(bigLen)]]);
      return {
        status: 200,
        headers: { get: (n) => map.get(n.toLowerCase()) ?? null },
        text: async () => "x".repeat(bigLen),
      } as MetaFetchResponse;
    });
    const t = makeTransport(fetchFn);
    const r = await t.sendTemplate(sendInput());
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("response_too_large");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parsers puros

describe("parsers puros", () => {
  it("parseJsonSafe", () => {
    expect(parseJsonSafe("").ok).toBe(false);
    expect(parseJsonSafe("null").ok).toBe(true);
    expect(parseJsonSafe("{oops").ok).toBe(false);
    expect(parseJsonSafe('{"a":1}').ok).toBe(true);
  });
  it("extractProviderMessageId", () => {
    expect(extractProviderMessageId(null)).toBeNull();
    expect(extractProviderMessageId({})).toBeNull();
    expect(extractProviderMessageId({ messages: [] })).toBeNull();
    expect(extractProviderMessageId({ messages: [{ id: 42 }] })).toBeNull();
    expect(extractProviderMessageId({ messages: [{ id: "wamid.OK" }] })).toBe("wamid.OK");
    expect(extractProviderMessageId({ messages: [{ id: "  " }] })).toBeNull();
  });
  it("extractMetaError sanitiza título/mensagem", () => {
    const info = extractMetaError({
      error: { code: 190, error_subcode: 460, type: "OAuth", message: "invalid\u0000token", error_user_title: "  Erro  " },
    });
    expect(info?.code).toBe("190");
    expect(info?.subcode).toBe("460");
    expect(info?.type).toBe("OAuth");
    expect(info?.title).toBe("Erro");
    expect(info?.message).toBe("invalid token");
  });
  it("categorizeStatus mapping", () => {
    expect(categorizeStatus(200, "0")).toEqual({ category: "unknown", retryable: false });
    expect(categorizeStatus(401, "x")).toEqual({ category: "authentication", retryable: false });
    expect(categorizeStatus(403, "x")).toEqual({ category: "configuration", retryable: false });
    expect(categorizeStatus(404, "x")).toEqual({ category: "configuration", retryable: false });
    expect(categorizeStatus(429, "x")).toEqual({ category: "rate_limit", retryable: true });
    expect(categorizeStatus(400, "x")).toEqual({ category: "permanent", retryable: false });
    expect(categorizeStatus(502, "x")).toEqual({ category: "retryable", retryable: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gates

describe("isOutboundHttpAllowed — dupla trava", () => {
  const fullEnv = {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_CANARY_ENABLED: "true",
    WHATSAPP_DISPATCH_ENABLED: "true",
    WHATSAPP_OUTBOUND_HTTP_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_ACCESS_TOKEN: "abc",
    WHATSAPP_CANARY_USERS: "u1,u2",
  };

  it("todos true + user canary → allowed", () => {
    const r = isOutboundHttpAllowed({ userId: "u1", env: fullEnv });
    expect(r.allowed).toBe(true);
  });

  it("user fora da lista canary → user_not_in_canary", () => {
    const r = isOutboundHttpAllowed({ userId: "u9", env: fullEnv });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("user_not_in_canary");
  });

  it("WHATSAPP_ENABLED=false → whatsapp_disabled", () => {
    const r = isOutboundHttpAllowed({ env: { ...fullEnv, WHATSAPP_ENABLED: "false" } });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("whatsapp_disabled");
  });

  it("parse estrito: '1' NÃO é true", () => {
    const r = isOutboundHttpAllowed({ env: { ...fullEnv, WHATSAPP_OUTBOUND_HTTP_ENABLED: "1" } });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("outbound_http_disabled");
  });

  it("phone_number_id inválido (não-dígitos) → phone_number_id_invalid", () => {
    const r = isOutboundHttpAllowed({ env: { ...fullEnv, WHATSAPP_PHONE_NUMBER_ID: "abc" } });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("phone_number_id_invalid");
  });

  it("access_token vazio → access_token_missing", () => {
    const r = isOutboundHttpAllowed({ env: { ...fullEnv, WHATSAPP_ACCESS_TOKEN: "" } });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain("access_token_missing");
  });

  it("todas as flags off → acumula todas as razões de flag", () => {
    const r = isOutboundHttpAllowed({
      env: { ...fullEnv, WHATSAPP_ENABLED: "false", WHATSAPP_CANARY_ENABLED: "false", WHATSAPP_DISPATCH_ENABLED: "false", WHATSAPP_OUTBOUND_HTTP_ENABLED: "false" },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reasons).toContain("whatsapp_disabled");
      expect(r.reasons).toContain("canary_disabled");
      expect(r.reasons).toContain("dispatch_disabled");
      expect(r.reasons).toContain("outbound_http_disabled");
    }
  });

  it("canaryUserIds override respeitado", () => {
    const r = isOutboundHttpAllowed({ userId: "u42", canaryUserIds: ["u42"], env: fullEnv });
    expect(r.allowed).toBe(true);
  });
});
