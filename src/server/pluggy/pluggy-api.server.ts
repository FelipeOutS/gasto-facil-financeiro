/**
 * Cliente HTTP mínimo da Pluggy (server-only). Credenciais lidas de
 * process.env dentro das chamadas; nunca registradas em log.
 */
const BASE = "https://api.pluggy.ai";
const TIMEOUT_MS = 15_000;

export class PluggyHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`pluggy_http_${status}:${code}`);
  }
}

type Fetch = typeof fetch;
let cachedKey: { key: string; exp: number } | null = null;

export function __resetPluggyKeyForTests() {
  cachedKey = null;
}

export function pluggyConfigured(): boolean {
  return !!process.env.PLUGGY_CLIENT_ID && !!process.env.PLUGGY_CLIENT_SECRET;
}

async function call(f: Fetch, path: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await f(BASE + path, { ...init, signal: ctrl.signal });
  } catch {
    throw new PluggyHttpError(0, "rede_ou_timeout");
  } finally {
    clearTimeout(t);
  }
}

async function apiKey(f: Fetch): Promise<string> {
  if (cachedKey && cachedKey.exp > Date.now()) return cachedKey.key;
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new PluggyHttpError(0, "credenciais_ausentes");
  const r = await call(f, "/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!r.ok) throw new PluggyHttpError(r.status, "auth");
  const j = (await r.json()) as { apiKey?: string };
  if (!j.apiKey) throw new PluggyHttpError(502, "auth_sem_chave");
  cachedKey = { key: j.apiKey, exp: Date.now() + 100 * 60_000 }; // expira em 2h; renova antes
  return j.apiKey;
}

export function createPluggyApi(f: Fetch = fetch) {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const key = await apiKey(f);
    const r = await call(f, path, {
      method,
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) cachedKey = null;
    if (!r.ok) throw new PluggyHttpError(r.status, path.split("?")[0]);
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  }

  return {
    connectToken: (clientUserId: string, webhookUrl: string | null, itemId?: string) =>
      req<{ accessToken: string }>("POST", "/connect_token", {
        ...(itemId ? { itemId } : {}),
        options: { clientUserId, ...(webhookUrl ? { webhookUrl } : {}), avoidDuplicates: true },
      }),
    sandboxConnectors: () =>
      req<{ results: Array<{ id: number; name: string; isSandbox?: boolean }> }>("GET", "/connectors?sandbox=true"),
    connector: (id: number) => req<{ id: number; name: string; isSandbox?: boolean }>("GET", `/connectors/${id}`),
    /** Conectores reais do Brasil (sem Sandbox); filtragem por instituição é feita no servidor. */
    liveConnectors: () =>
      req<{ results: Array<{ id: number; name: string; isSandbox?: boolean }> }>("GET", "/connectors?countries=BR&sandbox=false"),
    item: (id: string) => req<PluggyItem>("GET", `/items/${encodeURIComponent(id)}`),
    deleteItem: (id: string) => req<void>("DELETE", `/items/${encodeURIComponent(id)}`),
    accounts: (itemId: string) =>
      req<{ results: PluggyAccount[] }>("GET", `/accounts?itemId=${encodeURIComponent(itemId)}`),
    /**
     * GET /v2/transactions (paginação por cursor). `next` é a query string
     * devolvida pela Pluggy, usada sem decodificar; só é aceita se apontar
     * para o mesmo endpoint autorizado.
     */
    transactionsV2: (accountId: string, dateFrom: string, next?: string | null) =>
      req<{ results: unknown[]; next: string | null }>("GET", transactionsV2Path(accountId, dateFrom, next)),
  };
}
/** Monta o caminho da próxima página sem nunca sair de /v2/transactions. */
export function transactionsV2Path(accountId: string, dateFrom: string, next?: string | null): string {
  if (next == null) {
    return `/v2/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${encodeURIComponent(dateFrom)}`;
  }
  let qs = next.trim();
  if (/^https?:\/\//i.test(qs)) {
    const u = new URL(qs);
    if (u.origin !== BASE || u.pathname !== "/v2/transactions") throw new PluggyHttpError(502, "next_invalido");
    qs = u.search;
  } else if (qs.startsWith("/v2/transactions?")) {
    qs = qs.slice("/v2/transactions".length);
  }
  if (!qs.startsWith("?")) qs = `?${qs}`;
  if (qs.length < 2 || qs.length > 4000 || /[\s#]/.test(qs)) throw new PluggyHttpError(502, "next_invalido");
  return `/v2/transactions${qs}`;
}
export type PluggyApi = ReturnType<typeof createPluggyApi>;

export type PluggyItem = {
  id: string;
  clientUserId?: string | null;
  status: string;
  executionStatus?: string | null;
  error?: { code?: string; message?: string } | null;
  connector: { id: number; name: string; isSandbox?: boolean | null };
  consentExpiresAt?: string | null;
  lastUpdatedAt?: string | null;
};

export type PluggyAccount = {
  id: string;
  itemId: string;
  type: "BANK" | "CREDIT";
  subtype?: string | null;
  name: string;
  number?: string | null;
  balance: number;
  currencyCode?: string | null;
  owner?: string | null;
  taxNumber?: string | null;
  creditData?: { creditLimit?: number | null; availableCreditLimit?: number | null; balanceDueDate?: string | null } | null;
};
