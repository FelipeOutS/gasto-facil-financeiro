/**
 * STABILITY-02 — Pipeline de telemetria de carregamento e CSP.
 *
 * Exercita os handlers HTTP reais de `/api/public/client-load-error` e
 * `/api/public/csp-report`, com Supabase e rate-limit mockados nas bordas.
 * Fixtures são 100% sintéticas: nenhum dado pessoal real é usado.
 */
import { test, expect, beforeEach, mock } from "bun:test";

type Inserted = { table: string; row: Record<string, unknown> };

const state = {
  inserts: [] as Inserted[],
  blocked: false,
  insertError: null as { message: string } | null,
};

beforeEach(() => {
  state.inserts = [];
  state.blocked = false;
  state.insertError = null;
});

mock.module("@/server/rate-limit.server", () => ({
  RATE_LIMIT_PRESETS: {},
  getClientIp: () => "203.0.113.55",
  checkRateLimit: async () => ({
    blocked: state.blocked,
    count: 1,
    limit: 30,
    retryAfterSeconds: 300,
  }),
}));

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) state.inserts.push({ table, row: r });
        return { error: state.insertError };
      },
    }),
  },
}));

const { Route: LoadErrorRoute } = await import("@/routes/api/public/client-load-error");
const { Route: CspRoute } = await import("@/routes/api/public/csp-report");

function loadErrorHandler() {
  const handlers = (LoadErrorRoute.options as any).server.handlers;
  return handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

function cspHandler() {
  const handlers = (CspRoute.options as any).server.handlers;
  return handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

function postJson(url: string, body: unknown, contentType = "application/json") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": contentType, "user-agent": "QA-Synthetic/1.0" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------- 17. endpoint client-load-error ----------

test("client-load-error: payload sanitizado persiste 1 registro", async () => {
  const res = await loadErrorHandler()({
    request: postJson("https://qa.invalid/api/public/client-load-error", {
      error_type: "DYNAMIC_IMPORT_FAILED",
      error_name: "TypeError",
      error_message: "Failed to fetch dynamically imported module",
      stack_trace: "at chunk-abc.js:1:1",
      resource_url: "https://qa.invalid/assets/chunk-abc.js?v=1#frag",
      current_route: "/app/ajustes?token=zzz",
      navigator_online: true,
      js_build_id: "build-client-1",
      server_build_id: "build-server-2",
      sw_state: "activated",
      cache_names: "gi-shell-v1",
      recovery_attempted: true,
      lineno: 12,
      colno: 7,
    }),
  });

  expect(res.status).toBe(204);
  expect(state.inserts).toHaveLength(1);
  const row = state.inserts[0]!;
  expect(row.table).toBe("client_load_errors");
  expect(row.row.error_type).toBe("DYNAMIC_IMPORT_FAILED");
  expect(row.row.resource_url).toBe("https://qa.invalid/assets/chunk-abc.js");
  expect(row.row.current_route).toBe("/app/ajustes");
  expect(row.row.lineno).toBe(12);
  expect(row.row.cache_names).toBe("gi-shell-v1");
  expect(row.row.user_agent).toBe("QA-Synthetic/1.0");
});

// ---------- 18. sanitização ----------

test("client-load-error: não persiste e-mail/UUID/token/CPF/telefone/query", async () => {
  const { buildDiagnosticPayload } = await import("@/lib/diagnostic-logger");
  const payload = buildDiagnosticPayload({
    error_type: "RUNTIME_ERROR",
    error_message:
      "falhou para fake@example.invalid uuid 123e4567-e89b-12d3-a456-426614174000 bearer abc.def.ghi cpf 12345678901 tel 11987654321",
    stack_trace: "at https://qa.invalid/x.js?access_token=fake-token-123#h",
    current_route: "/app?cpf=12345678901",
  });

  const res = await loadErrorHandler()({
    request: postJson("https://qa.invalid/api/public/client-load-error", payload),
  });
  expect(res.status).toBe(204);

  const stored = JSON.stringify(state.inserts[0]!.row);
  for (const secret of [
    "fake@example.invalid",
    "123e4567-e89b-12d3-a456-426614174000",
    "12345678901",
    "11987654321",
    "fake-token-123",
  ]) {
    expect(stored).not.toContain(secret);
  }
});

// ---------- 21. limite de tamanho ----------

test("client-load-error: payload acima do limite é rejeitado sem persistir", async () => {
  const huge = JSON.stringify({
    error_type: "RUNTIME_ERROR",
    stack_trace: "x".repeat(40_000),
  });
  const res = await loadErrorHandler()({
    request: postJson("https://qa.invalid/api/public/client-load-error", huge),
  });
  expect(res.status).toBe(413);
  expect(state.inserts).toHaveLength(0);
});

test("client-load-error: schema inválido devolve 400 sem persistir", async () => {
  const res = await loadErrorHandler()({
    request: postJson("https://qa.invalid/api/public/client-load-error", { foo: "bar" }),
  });
  expect(res.status).toBe(400);
  expect(state.inserts).toHaveLength(0);
});

test("client-load-error: rate limit bloqueado devolve 429 sem persistir", async () => {
  state.blocked = true;
  const res = await loadErrorHandler()({
    request: postJson("https://qa.invalid/api/public/client-load-error", {
      error_type: "RUNTIME_ERROR",
    }),
  });
  expect(res.status).toBe(429);
  expect(state.inserts).toHaveLength(0);
});

// ---------- 20. CSP ----------

test("csp-report: relatório válido persiste em csp_reports sanitizado", async () => {
  const res = await cspHandler()({
    request: postJson(
      "https://qa.invalid/api/public/csp-report",
      {
        "csp-report": {
          "document-uri": "https://qa.invalid/app?token=fake-token-123",
          referrer: "https://qa.invalid/login?x=1",
          "violated-directive": "script-src",
          "effective-directive": "script-src",
          "blocked-uri": "https://cdn.invalid/x.js?sig=abc",
          "source-file": "https://qa.invalid/assets/a.js?v=2",
          "line-number": 3,
        },
      },
      "application/csp-report",
    ),
  });

  expect(res.status).toBe(204);
  expect(state.inserts).toHaveLength(1);
  const row = state.inserts[0]!;
  expect(row.table).toBe("csp_reports");
  expect(row.row.document_uri).toBe("https://qa.invalid/app");
  expect(row.row.blocked_uri).toBe("https://cdn.invalid/x.js");
  expect(row.row.source_file).toBe("https://qa.invalid/assets/a.js");
  expect(JSON.stringify(row.row)).not.toContain("fake-token-123");
});

test("csp-report: payload inválido devolve 4xx sem persistir", async () => {
  const bad = await cspHandler()({
    request: postJson("https://qa.invalid/api/public/csp-report", { hello: "world" }),
  });
  expect(bad.status).toBe(400);
  expect(state.inserts).toHaveLength(0);

  const broken = await cspHandler()({
    request: postJson("https://qa.invalid/api/public/csp-report", "{not-json"),
  });
  expect(broken.status).toBe(400);
  expect(state.inserts).toHaveLength(0);
});

test("csp-report: payload acima de 10KB devolve 413 sem persistir", async () => {
  const res = await cspHandler()({
    request: postJson(
      "https://qa.invalid/api/public/csp-report",
      JSON.stringify({ "csp-report": { "original-policy": "y".repeat(11_000) } }),
    ),
  });
  expect(res.status).toBe(413);
  expect(state.inserts).toHaveLength(0);
});
