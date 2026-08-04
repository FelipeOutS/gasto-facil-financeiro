/**
 * Mercado Pago OAuth + Sync service.
 *
 * Server-only. Lida com:
 * - geração da URL de autorização (OAuth)
 * - troca do `code` por access/refresh token
 * - renovação automática do token quando expirado
 * - sincronização de pagamentos via /v1/payments/search
 * - mapeamento das movimentações para o formato interno
 * - desconexão segura
 *
 * Tokens NUNCA saem deste arquivo / dos handlers de rota.
 * As páginas só recebem dados não sensíveis (via view `user_integrations_safe`).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import crypto from "crypto";

const PROVIDER = "mercado_pago" as const;
const MP_AUTH_BASE = "https://auth.mercadopago.com.br/authorization";
const MP_OAUTH_TOKEN = "https://api.mercadopago.com/oauth/token";
const MP_PAYMENTS_SEARCH = "https://api.mercadopago.com/v1/payments/search";

export type MpConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getMercadoPagoConfig(): MpConfig | null {
  const clientId = process.env.MERCADO_PAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET;
  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isMercadoPagoConfigured(): boolean {
  return getMercadoPagoConfig() !== null;
}

// ============= STATE (CSRF) =============
// Geramos um state opaco assinado com SUPABASE_SERVICE_ROLE_KEY para
// vincular ao userId sem persistir no banco.
function signState(payload: { uid: string; nonce: string; ts: number }): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.MERCADO_PAGO_CLIENT_SECRET;
  if (!secret) throw new Error("missing_oauth_state_secret");
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function verifyState(state: string): { uid: string } | null {
  try {
    const [b64, sig] = state.split(".");
    if (!b64 || !sig) return null;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.MERCADO_PAGO_CLIENT_SECRET;
    if (!secret) return null;
    const expected = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as {
      uid: string;
      ts: number;
    };
    if (!payload.uid) return null;
    // 15 min de validade
    if (Date.now() - payload.ts > 15 * 60 * 1000) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

// ============= OAuth =============
export function startMercadoPagoOAuth(userId: string): { url: string } | { error: string } {
  const cfg = getMercadoPagoConfig();
  if (!cfg) return { error: "mercado_pago_not_configured" };
  const state = signState({
    uid: userId,
    nonce: crypto.randomBytes(8).toString("hex"),
    ts: Date.now(),
  });
  const url = new URL(MP_AUTH_BASE);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  return { url: url.toString() };
}

export async function handleMercadoPagoCallback(params: {
  code: string;
  state: string;
}): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const cfg = getMercadoPagoConfig();
  if (!cfg) return { ok: false, error: "mercado_pago_not_configured" };
  const verified = verifyState(params.state);
  if (!verified) return { ok: false, error: "invalid_state" };

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("code", params.code);
  body.set("redirect_uri", cfg.redirectUri);

  const res = await fetch(MP_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await markIntegrationError(
      verified.uid,
      `oauth_exchange_failed: ${res.status} ${text.slice(0, 200)}`,
    );
    return { ok: false, error: "oauth_exchange_failed" };
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user_id?: number | string;
    scope?: string;
  };
  if (!json.access_token) {
    await markIntegrationError(verified.uid, "missing_access_token");
    return { ok: false, error: "missing_access_token" };
  }

  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from("user_integrations").upsert(
    {
      user_id: verified.uid,
      provider: PROVIDER,
      provider_user_id: json.user_id != null ? String(json.user_id) : null,
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      expires_at: expiresAt,
      scope: json.scope ?? null,
      status: "connected",
      last_error: null,
    },
    { onConflict: "user_id,provider" },
  );

  if (error) {
    return { ok: false, error: "db_upsert_failed" };
  }
  return { ok: true, userId: verified.uid };
}

async function markIntegrationError(userId: string, message: string) {
  await supabaseAdmin.from("user_integrations").upsert(
    {
      user_id: userId,
      provider: PROVIDER,
      status: "error",
      last_error: message,
    },
    { onConflict: "user_id,provider" },
  );
}

// ============= Token refresh =============
type IntegrationRow = {
  id: string;
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  status: string;
};

async function getIntegration(userId: string): Promise<IntegrationRow | null> {
  const { data } = await supabaseAdmin
    .from("user_integrations")
    .select("id, user_id, access_token, refresh_token, expires_at, status")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

export async function refreshMercadoPagoTokenIfNeeded(
  integration: IntegrationRow,
): Promise<IntegrationRow | null> {
  const cfg = getMercadoPagoConfig();
  if (!cfg) return integration;
  if (!integration.refresh_token) return integration;

  const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
  // renova com 5 min de antecedência
  if (expiresAt && expiresAt - 5 * 60 * 1000 > Date.now()) return integration;

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("refresh_token", integration.refresh_token);

  const res = await fetch(MP_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    await markIntegrationError(integration.user_id, `token_refresh_failed: ${res.status}`);
    return null;
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) return null;
  const newExpiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;

  const updated: IntegrationRow = {
    ...integration,
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? integration.refresh_token,
    expires_at: newExpiresAt,
    status: "connected",
  };

  await supabaseAdmin
    .from("user_integrations")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
      status: "connected",
      last_error: null,
    })
    .eq("id", integration.id);

  return updated;
}

// ============= Mapper =============
type MpPayment = {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  net_received_amount?: number;
  fee_details?: Array<{ type?: string; amount?: number }>;
  date_approved?: string | null;
  date_created?: string | null;
  description?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  operation_type?: string | null;
  payer?: { email?: string | null } | null;
};

function mapPaymentMethod(p: MpPayment): string {
  const t = (p.payment_type_id ?? "").toLowerCase();
  if (t === "credit_card") return "credit_card";
  if (t === "debit_card") return "debit_card";
  if (t === "account_money") return "account_money";
  if (t === "bank_transfer" || (p.payment_method_id ?? "").toLowerCase() === "pix") return "pix";
  if (t === "ticket" || (p.payment_method_id ?? "").toLowerCase().includes("bolbradesco"))
    return "boleto";
  return t || (p.payment_method_id ?? "outro");
}

export function mapMercadoPagoTransactionToGastoInteligente(
  p: MpPayment,
  userId: string,
  integrationId: string,
) {
  const status = (p.status ?? "").toLowerCase();
  const opType = (p.operation_type ?? "").toLowerCase();
  let type: string = "receita";
  if (status === "refunded" || status === "charged_back") type = "estorno";
  else if (opType === "money_out" || opType === "payment_to_user") type = "despesa";

  return {
    user_id: userId,
    integration_id: integrationId,
    provider: PROVIDER,
    provider_transaction_id: String(p.id),
    type,
    title: p.description ?? `Mercado Pago #${p.id}`,
    description: p.payer?.email ?? null,
    amount: p.transaction_amount ?? 0,
    currency: "BRL",
    payment_method: mapPaymentMethod(p),
    status,
    occurred_at: p.date_approved ?? p.date_created ?? null,
    raw_payload: p as unknown as never,
  };
}

// ============= Sync =============
export type SyncSummary = {
  imported: number;
  updated: number;
  ignored: number;
  errors: number;
  fetched: number;
  failedMonths?: Array<{ month: string; message: string }>;
};

export type SyncPeriod =
  | "last30"
  | "current_month"
  | "last_month"
  | "last3"
  | "last6"
  | "last12"
  | "custom"
  | "months";

export type SyncOptions = {
  period?: SyncPeriod;
  beginDate?: string;
  endDate?: string;
  /** Lista de meses no formato "YYYY-MM" para sincronização mês a mês. */
  months?: string[];
};

/** Converte "YYYY-MM" em intervalo [início, fim] do mês. */
function monthKeyToRange(key: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  return { from, to };
}

function monthKeyLabel(key: string): string {
  const r = monthKeyToRange(key);
  if (!r) return key;
  return r.from.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function computePeriodRange(opts: SyncOptions): { begin: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  let begin = new Date(now);
  switch (opts.period ?? "last30") {
    case "current_month":
      begin = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "last_month":
      return {
        begin: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    case "last3":
      begin.setMonth(begin.getMonth() - 3);
      break;
    case "last6":
      begin.setMonth(begin.getMonth() - 6);
      break;
    case "last12":
      begin.setMonth(begin.getMonth() - 12);
      break;
    case "custom":
      return {
        begin: opts.beginDate ? new Date(opts.beginDate) : new Date(now.getTime() - 30 * 86400000),
        end: opts.endDate ? new Date(opts.endDate) : end,
      };
    case "last30":
    default:
      begin = new Date(now.getTime() - 30 * 86400000);
      break;
  }
  return { begin, end };
}

/** Quebra o intervalo em blocos mensais para evitar limites de offset/total da API. */
function chunkMonthly(begin: Date, end: Date): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(begin);
  while (cursor < end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const to = next < end ? new Date(next.getTime() - 1) : new Date(end);
    chunks.push({ from: new Date(cursor), to });
    cursor = next;
  }
  if (chunks.length === 0) chunks.push({ from: new Date(begin), to: new Date(end) });
  return chunks;
}

async function fetchPaymentsChunk(
  accessToken: string,
  from: Date,
  to: Date,
): Promise<{ results: MpPayment[]; error: string | null }> {
  const limit = 50;
  const all: MpPayment[] = [];
  let offset = 0;
  const HARD_MAX = 5000;

  while (all.length < HARD_MAX) {
    const url = new URL(MP_PAYMENTS_SEARCH);
    url.searchParams.set("sort", "date_created");
    url.searchParams.set("criteria", "desc");
    url.searchParams.set("range", "date_created");
    url.searchParams.set("begin_date", from.toISOString());
    url.searchParams.set("end_date", to.toISOString());
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { results: all, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      results?: MpPayment[];
      paging?: { total?: number; limit?: number; offset?: number };
    };
    const page = json.results ?? [];
    all.push(...page);
    const total = json.paging?.total ?? page.length;
    offset += limit;
    if (page.length < limit) break;
    if (offset >= total) break;
  }
  return { results: all, error: null };
}

export async function syncMercadoPagoTransactions(
  userId: string,
  options: SyncOptions = {},
): Promise<{ ok: true; summary: SyncSummary } | { ok: false; error: string }> {
  if (!isMercadoPagoConfigured()) return { ok: false, error: "mercado_pago_not_configured" };
  let integration = await getIntegration(userId);
  if (!integration || integration.status !== "connected" || !integration.access_token) {
    return { ok: false, error: "not_connected" };
  }
  integration = await refreshMercadoPagoTokenIfNeeded(integration);
  if (!integration?.access_token) return { ok: false, error: "token_refresh_failed" };

  const summary: SyncSummary = { imported: 0, updated: 0, ignored: 0, errors: 0, fetched: 0 };

  async function upsertPayments(payments: MpPayment[]) {
    for (const p of payments) {
      try {
        const row = mapMercadoPagoTransactionToGastoInteligente(p, userId, integration!.id);
        const { data: existing } = await supabaseAdmin
          .from("imported_transactions")
          .select("id, status, amount")
          .eq("user_id", userId)
          .eq("provider", PROVIDER)
          .eq("provider_transaction_id", row.provider_transaction_id)
          .maybeSingle();

        if (!existing) {
          const { error: insErr } = await supabaseAdmin.from("imported_transactions").insert(row);
          if (insErr) summary.errors += 1;
          else summary.imported += 1;
        } else if (
          existing.status !== row.status ||
          Number(existing.amount) !== Number(row.amount)
        ) {
          const { error: updErr } = await supabaseAdmin
            .from("imported_transactions")
            .update({
              status: row.status,
              amount: row.amount,
              raw_payload: row.raw_payload,
              occurred_at: row.occurred_at,
            })
            .eq("id", existing.id);
          if (updErr) summary.errors += 1;
          else summary.updated += 1;
        } else {
          summary.ignored += 1;
        }
      } catch {
        summary.errors += 1;
      }
    }
  }

  try {
    // === Modo MESES: sincroniza mês a mês com tratamento de falha por mês ===
    if (options.months && options.months.length > 0) {
      const failedMonths: Array<{ month: string; message: string }> = [];
      const now = new Date();
      const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const uniqueMonths = Array.from(new Set(options.months)).filter((k) => k <= nowKey);

      for (const key of uniqueMonths) {
        const range = monthKeyToRange(key);
        if (!range) {
          failedMonths.push({ month: key, message: "Formato de mês inválido." });
          continue;
        }
        try {
          const { results, error } = await fetchPaymentsChunk(
            integration.access_token,
            range.from,
            range.to,
          );
          if (error && results.length === 0) {
            failedMonths.push({
              month: key,
              message: "Erro ao buscar movimentações deste mês.",
            });
            summary.errors += 1;
            continue;
          }
          summary.fetched += results.length;
          await upsertPayments(results);
        } catch {
          failedMonths.push({
            month: key,
            message: "Erro ao buscar movimentações deste mês.",
          });
          summary.errors += 1;
        }
      }
      summary.failedMonths = failedMonths;

      await supabaseAdmin
        .from("user_integrations")
        .update({ last_sync_at: new Date().toISOString(), last_error: null, status: "connected" })
        .eq("id", integration.id);

      return { ok: true, summary };
    }

    // === Modo PERÍODO (compatibilidade) ===
    const { begin, end } = computePeriodRange(options);
    const chunks = chunkMonthly(begin, end);
    let lastChunkError: string | null = null;

    for (const c of chunks) {
      const { results, error } = await fetchPaymentsChunk(integration.access_token, c.from, c.to);
      if (error && results.length === 0) {
        lastChunkError = error;
        summary.errors += 1;
        continue;
      }
      summary.fetched += results.length;
      await upsertPayments(results);
    }

    if (summary.fetched === 0 && lastChunkError) {
      await markIntegrationError(userId, `sync_fetch_failed: ${lastChunkError}`);
      return { ok: false, error: "sync_fetch_failed" };
    }

    await supabaseAdmin
      .from("user_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_error: null, status: "connected" })
      .eq("id", integration.id);

    return { ok: true, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markIntegrationError(userId, `sync_exception: ${msg.slice(0, 200)}`);
    return { ok: false, error: "sync_exception" };
  }
}

export async function disconnectMercadoPago(userId: string): Promise<{ ok: true }> {
  await supabaseAdmin
    .from("user_integrations")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      expires_at: null,
      last_error: null,
    })
    .eq("user_id", userId)
    .eq("provider", PROVIDER);
  return { ok: true };
}

export async function getIntegrationSummary(userId: string) {
  const { data: integ } = await supabaseAdmin
    .from("user_integrations_safe")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  const { count } = await supabaseAdmin
    .from("imported_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", PROVIDER);
  return {
    configured: isMercadoPagoConfigured(),
    integration: integ ?? null,
    importedCount: count ?? 0,
  };
}
