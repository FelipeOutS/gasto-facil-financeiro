/**
 * Segurança — rotas /api/integrations/mercadopago/* devem exigir admin
 * master (a checagem é assíncrona; antes faltava `await` e a Promise
 * sempre passava). Também garante que cada operação usa apenas o
 * user.id da sessão (sem acesso cruzado).
 */
import { test, expect, beforeEach, mock } from "bun:test";

const state = {
  user: null as null | { id: string; email?: string },
  admins: new Set<string>(),
  calls: [] as Array<{ fn: string; userId: string }>,
};

mock.module("@/server/admin-master.server", () => ({
  hasAdminMasterRole: async (id: string) => state.admins.has(id),
}));
mock.module("@/server/api-auth", () => ({
  getUserFromRequest: async () => state.user,
  unauthorizedResponse: () => new Response("unauthorized", { status: 401 }),
  forbiddenResponse: () => new Response("forbidden", { status: 403 }),
  isAdminMasterUser: async (u: { id: string } | null) => !!u && state.admins.has(u.id),
}));
mock.module("@/server/mercado-pago-integration.server", () => ({
  syncMercadoPagoTransactions: async (userId: string) => {
    state.calls.push({ fn: "sync", userId });
    return { ok: true, summary: {} };
  },
  disconnectMercadoPago: async (userId: string) => {
    state.calls.push({ fn: "disconnect", userId });
    return { ok: true };
  },
  getIntegrationSummary: async (userId: string) => {
    state.calls.push({ fn: "status", userId });
    return { configured: true };
  },
  startMercadoPagoOAuth: (userId: string) => {
    state.calls.push({ fn: "connect", userId });
    return { url: "https://auth.example/x" };
  },
}));

const { Route: ActionRoute } = await import("../src/routes/api/integrations.mercadopago.$action");
const { Route: ConnectRoute } = await import("../src/routes/api/integrations.mercadopago.connect");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const action = (ActionRoute as any).options.server.handlers;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connect = (ConnectRoute as any).options.server.handlers;

const req = (method = "POST", body = "{}") =>
  new Request("http://localhost/api/x", { method, body: method === "GET" ? undefined : body });

beforeEach(() => {
  state.user = null;
  state.admins = new Set(["admin-1"]);
  state.calls = [];
});

test("sem sessão: 401 em sync/disconnect/status/connect e nada executa", async () => {
  expect((await action.POST({ request: req(), params: { action: "sync" } })).status).toBe(401);
  expect((await action.POST({ request: req(), params: { action: "disconnect" } })).status).toBe(401);
  expect((await action.GET({ request: req("GET"), params: { action: "status" } })).status).toBe(401);
  expect((await connect.POST({ request: req() })).status).toBe(401);
  expect(state.calls).toEqual([]);
});

test("usuário comum autenticado: 403 em todas as ações e nada executa", async () => {
  state.user = { id: "user-comum" };
  expect((await action.POST({ request: req(), params: { action: "sync" } })).status).toBe(403);
  expect((await action.POST({ request: req(), params: { action: "disconnect" } })).status).toBe(403);
  expect((await action.GET({ request: req("GET"), params: { action: "status" } })).status).toBe(403);
  expect((await connect.POST({ request: req() })).status).toBe(403);
  const r = await connect.GET({ request: req("GET") });
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toContain("/app/dashboard");
  expect(state.calls).toEqual([]);
});

test("admin autorizado: opera somente sobre o próprio user.id", async () => {
  state.user = { id: "admin-1" };
  expect((await action.POST({ request: req(), params: { action: "sync" } })).status).toBe(200);
  expect((await action.POST({ request: req(), params: { action: "disconnect" } })).status).toBe(200);
  expect((await action.GET({ request: req("GET"), params: { action: "status" } })).status).toBe(200);
  expect((await connect.POST({ request: req() })).status).toBe(200);
  expect(state.calls.map((c) => c.userId)).toEqual(["admin-1", "admin-1", "admin-1", "admin-1"]);
});

test("corpo não permite escolher outro usuário", async () => {
  state.user = { id: "admin-1" };
  await action.POST({
    request: req("POST", JSON.stringify({ userId: "outro", user_id: "outro" })),
    params: { action: "disconnect" },
  });
  expect(state.calls).toEqual([{ fn: "disconnect", userId: "admin-1" }]);
});
