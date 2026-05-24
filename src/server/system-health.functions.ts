/**
 * Sprint 2 — Saúde do Sistema
 *
 * ServerFn admin-only que agrega métricas e listas de diagnóstico para
 * webhooks, rate limits, pagamentos e auditoria. NUNCA retorna tokens,
 * headers sensíveis, payloads brutos ou dados de sessão.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
];

async function ensureAdmin(userId: string): Promise<string> {
  try {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = (u?.user?.email ?? "").toLowerCase();
    if (ADMIN_EMAILS.includes(email)) return email;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isOwner = (roles ?? []).some((r) => r.role === "owner");
    if (isOwner) return email;
    throw new Error("FORBIDDEN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FORBIDDEN";
    if (msg === "FORBIDDEN") throw new Error("FORBIDDEN");
    throw new Error("FORBIDDEN");
  }
}

function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // IPv4 -> 1.2.3.x ; IPv6 -> primeiros 2 blocos + :****
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 2).join(":")}:****`;
  }
  return ip.slice(0, 4) + "***";
}

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 6) return "***";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

type SafeMetaValue = string | number | boolean | null;

function summarizeMetadata(md: unknown): Record<string, SafeMetaValue> | null {
  if (!md || typeof md !== "object") return null;
  const SENSITIVE = new Set([
    "authorization",
    "cookie",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "api_key",
    "apikey",
    "password",
    "payload",
    "request_body",
    "response_body",
    "headers",
  ]);
  const out: Record<string, SafeMetaValue> = {};
  let count = 0;
  for (const [k, v] of Object.entries(md as Record<string, unknown>)) {
    if (count >= 8) break;
    const lk = k.toLowerCase();
    if (SENSITIVE.has(lk)) continue;
    if (v == null) {
      out[k] = null;
    } else if (typeof v === "string") {
      out[k] = v.length > 120 ? v.slice(0, 120) + "…" : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      out[k] = "[obj]";
    }
    count++;
  }
  return out;
}

export type SystemHealthData = {
  generated_at: string;
  webhooks_mp_24h: {
    total: number;
    processed: number;
    failed: number;
    ignored: number;
  };
  webhooks_whatsapp_24h: {
    total: number;
    processed: number;
    failed: number;
    ignored: number;
  };
  rate_limits_24h: {
    total: number;
    blocked: number;
    top_routes: { route: string; blocked: number }[];
  };
  payments: {
    approved_24h: number;
    pending_24h: number;
    rejected_24h: number;
    inconsistencies_count: number;
  };
  recent_failed_webhooks: Array<{
    id: string;
    created_at: string;
    provider: string;
    event_type: string | null;
    external_id: string | null;
    http_status: number | null;
    error_message: string | null;
    processing_time_ms: number | null;
  }>;
  recent_rate_limit_blocks: Array<{
    id: string;
    created_at: string;
    route: string;
    key_masked: string | null;
    user_id: string | null;
    ip_masked: string | null;
    method: string | null;
  }>;
  recent_payment_events: Array<{
    id: string;
    created_at: string;
    external_payment_id: string;
    event_type: string | null;
    status: string;
    raw_status: string | null;
    user_id: string | null;
    payment_id: string | null;
  }>;
  recent_audit_logs: Array<{
    id: string;
    created_at: string;
    actor_email: string | null;
    action: string;
    target_email: string | null;
    entity_type: string | null;
    entity_id: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  alerts: {
    level: "ok" | "warn" | "error";
    messages: string[];
  };
};

export const getSystemHealthDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemHealthData> => {
    const userId = (context as { userId: string }).userId;
    await ensureAdmin(userId);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1) Webhook counts MP/WhatsApp 24h
    const { data: whAgg } = await supabaseAdmin
      .from("webhook_logs")
      .select("provider,status")
      .gte("created_at", since24h);

    const aggWh = (provider: string) => {
      const rows = (whAgg ?? []).filter(
        (r) => (r.provider ?? "").toLowerCase().includes(provider),
      );
      const acc = { total: rows.length, processed: 0, failed: 0, ignored: 0 };
      for (const r of rows) {
        const s = (r.status ?? "").toLowerCase();
        if (s === "processed" || s === "success" || s === "ok") acc.processed++;
        else if (s === "failed" || s === "error") acc.failed++;
        else if (s === "ignored" || s === "duplicate" || s === "skipped") acc.ignored++;
      }
      return acc;
    };
    const webhooks_mp_24h = aggWh("mercado");
    const webhooks_whatsapp_24h = aggWh("whatsapp");

    // 2) Rate limits 24h
    const { data: rlAgg } = await supabaseAdmin
      .from("rate_limit_events")
      .select("route,blocked")
      .gte("created_at", since24h);
    const rlRows = rlAgg ?? [];
    const blockedRows = rlRows.filter((r) => r.blocked);
    const routeMap = new Map<string, number>();
    for (const r of blockedRows) {
      routeMap.set(r.route, (routeMap.get(r.route) ?? 0) + 1);
    }
    const top_routes = Array.from(routeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([route, blocked]) => ({ route, blocked }));

    // 3) Payments 24h
    const { data: payAgg } = await supabaseAdmin
      .from("payment_events")
      .select("status")
      .gte("created_at", since24h);
    const pAgg = payAgg ?? [];
    const approved_24h = pAgg.filter((p) => p.status === "approved").length;
    const pending_24h = pAgg.filter(
      (p) => p.status === "pending" || p.status === "in_process",
    ).length;
    const rejected_24h = pAgg.filter((p) =>
      ["rejected", "cancelled", "canceled", "refunded", "charged_back"].includes(p.status),
    ).length;

    // Inconsistências simples: subscription_payments approved sem user_plans ativo
    const { data: paidRows } = await supabaseAdmin
      .from("subscription_payments")
      .select("user_id,status,plano")
      .eq("status", "approved")
      .not("user_id", "is", null)
      .limit(200);
    let inconsistencies_count = 0;
    if (paidRows && paidRows.length > 0) {
      const userIds = Array.from(new Set(paidRows.map((p) => p.user_id).filter(Boolean) as string[]));
      const { data: plans } = await supabaseAdmin
        .from("user_plans")
        .select("user_id,status")
        .in("user_id", userIds);
      const planMap = new Map((plans ?? []).map((p) => [p.user_id, p.status]));
      for (const p of paidRows) {
        if (p.user_id && planMap.get(p.user_id) !== "ativo") inconsistencies_count++;
      }
    }

    // 4) Listas recentes
    const [failedWebhooksQ, rlBlocksQ, payEventsQ, auditsQ] = await Promise.all([
      supabaseAdmin
        .from("webhook_logs")
        .select("id,created_at,provider,event_type,external_id,http_status,error_message,processing_time_ms")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("rate_limit_events")
        .select("id,created_at,route,key,user_id,ip_address,method")
        .eq("blocked", true)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("payment_events")
        .select("id,created_at,external_payment_id,event_type,status,raw_status,user_id,payment_id")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("audit_logs")
        .select("id,created_at,actor_email,action,target_email,entity_type,entity_id,metadata")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const recent_failed_webhooks = (failedWebhooksQ.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      provider: r.provider,
      event_type: r.event_type,
      external_id: r.external_id,
      http_status: r.http_status,
      error_message: r.error_message ? String(r.error_message).slice(0, 300) : null,
      processing_time_ms: r.processing_time_ms,
    }));

    const recent_rate_limit_blocks = (rlBlocksQ.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      route: r.route,
      key_masked: maskKey(r.key),
      user_id: r.user_id,
      ip_masked: maskIp(r.ip_address),
      method: r.method,
    }));

    const recent_payment_events = (payEventsQ.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      external_payment_id: r.external_payment_id,
      event_type: r.event_type,
      status: r.status,
      raw_status: r.raw_status,
      user_id: r.user_id,
      payment_id: r.payment_id,
    }));

    const recent_audit_logs = (auditsQ.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      actor_email: r.actor_email,
      action: r.action,
      target_email: r.target_email,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      metadata: summarizeMetadata(r.metadata),
    }));

    // 5) Alertas
    const messages: string[] = [];
    let level: "ok" | "warn" | "error" = "ok";
    if (webhooks_mp_24h.failed > 0 || webhooks_whatsapp_24h.failed > 0) {
      messages.push(
        `Webhooks com falha nas últimas 24h: ${webhooks_mp_24h.failed + webhooks_whatsapp_24h.failed}`,
      );
      level = webhooks_mp_24h.failed + webhooks_whatsapp_24h.failed >= 5 ? "error" : "warn";
    }
    if (blockedRows.length > 10) {
      messages.push(`${blockedRows.length} bloqueios por rate limit nas últimas 24h`);
      if (level === "ok") level = "warn";
    }
    if (inconsistencies_count > 0) {
      messages.push(`${inconsistencies_count} pagamento(s) aprovado(s) sem plano ativo`);
      level = "error";
    }
    if (messages.length === 0) messages.push("Tudo certo por aqui");

    return {
      generated_at: new Date().toISOString(),
      webhooks_mp_24h,
      webhooks_whatsapp_24h,
      rate_limits_24h: {
        total: rlRows.length,
        blocked: blockedRows.length,
        top_routes,
      },
      payments: {
        approved_24h,
        pending_24h,
        rejected_24h,
        inconsistencies_count,
      },
      recent_failed_webhooks,
      recent_rate_limit_blocks,
      recent_payment_events,
      recent_audit_logs,
      alerts: { level, messages },
    };
  });
