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
import { logAuditEvent } from "@/server/logs.server";

const ADMIN_EMAILS = ["felipe.out.silva@outlook.com", "michael@medeiroscenografia.com.br"];

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
    pending_older_than_30min: number;
  };
  pending_payments_to_check: Array<{
    id: string;
    created_at: string;
    user_id_short: string | null;
    user_email: string | null;
    provider_payment_id: string | null;
    amount_cents: number;
    status: string;
    age_minutes: number;
  }>;
  payment_plan_inconsistencies: Array<{
    type: "approved_no_active_plan" | "approved_period_expired" | "active_plan_failed_payment";
    user_id_short: string | null;
    user_email: string | null;
    payment_id: string | null;
    provider_payment_id: string | null;
    payment_status: string | null;
    plan_status: string | null;
    current_period_end: string | null;
    recommended_action: string;
  }>;
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
    metadata: Record<string, SafeMetaValue> | null;
  }>;
  alerts: {
    level: "ok" | "warn" | "error";
    messages: string[];
  };
};

function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.slice(0, 8) + "…";
}

async function emailsForUserIds(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (data?.user?.email) map.set(uid, data.user.email);
      } catch {
        // ignore
      }
    }),
  );
  return map;
}

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
      const rows = (whAgg ?? []).filter((r) => (r.provider ?? "").toLowerCase().includes(provider));
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

    // Inconsistências detalhadas: lista tipada
    const payment_plan_inconsistencies: SystemHealthData["payment_plan_inconsistencies"] = [];
    let inconsistencies_count = 0;
    // a) approved sub_payments (últimos 200) vs user_plans
    const { data: paidRows } = await supabaseAdmin
      .from("subscription_payments")
      .select("id,user_id,status,plano,provider_payment_id,created_at")
      .eq("status", "approved")
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    const paidArr = paidRows ?? [];
    // b) failed sub_payments com provider_payment_id (últimos 200)
    const { data: failedRows } = await supabaseAdmin
      .from("subscription_payments")
      .select("id,user_id,status,provider_payment_id,created_at")
      .in("status", ["rejected", "cancelled", "canceled", "refunded", "charged_back", "failed"])
      .not("provider_payment_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    const failedArr = failedRows ?? [];

    const allUserIds = Array.from(
      new Set([
        ...paidArr.map((p) => p.user_id as string),
        ...failedArr.map((p) => p.user_id as string).filter(Boolean),
      ]),
    );
    const { data: plansForUsers } = allUserIds.length
      ? await supabaseAdmin
          .from("user_plans")
          .select("user_id,status,current_period_end,last_payment_id")
          .in("user_id", allUserIds)
      : {
          data: [] as {
            user_id: string;
            status: string;
            current_period_end: string | null;
            last_payment_id: string | null;
          }[],
        };
    const planByUser = new Map((plansForUsers ?? []).map((p) => [p.user_id, p]));
    const emailMap = await emailsForUserIds(allUserIds);
    const nowMs = Date.now();
    const seenA = new Set<string>();
    for (const p of paidArr) {
      if (!p.user_id || seenA.has(p.user_id)) continue;
      seenA.add(p.user_id);
      const plan = planByUser.get(p.user_id);
      if (!plan || plan.status !== "ativo") {
        payment_plan_inconsistencies.push({
          type: "approved_no_active_plan",
          user_id_short: shortId(p.user_id),
          user_email: emailMap.get(p.user_id) ?? null,
          payment_id: p.id,
          provider_payment_id: p.provider_payment_id,
          payment_status: p.status,
          plan_status: plan?.status ?? null,
          current_period_end: plan?.current_period_end ?? null,
          recommended_action: "Reconciliar via diagnóstico Mercado Pago",
        });
      } else if (!plan.current_period_end || new Date(plan.current_period_end).getTime() < nowMs) {
        payment_plan_inconsistencies.push({
          type: "approved_period_expired",
          user_id_short: shortId(p.user_id),
          user_email: emailMap.get(p.user_id) ?? null,
          payment_id: p.id,
          provider_payment_id: p.provider_payment_id,
          payment_status: p.status,
          plan_status: plan.status,
          current_period_end: plan.current_period_end,
          recommended_action: "Verificar renovação ou ciclo vencido",
        });
      }
    }
    for (const f of failedArr) {
      if (!f.user_id) continue;
      const plan = planByUser.get(f.user_id);
      if (
        plan?.status === "ativo" &&
        plan.last_payment_id &&
        plan.last_payment_id === f.provider_payment_id
      ) {
        payment_plan_inconsistencies.push({
          type: "active_plan_failed_payment",
          user_id_short: shortId(f.user_id),
          user_email: emailMap.get(f.user_id) ?? null,
          payment_id: f.id,
          provider_payment_id: f.provider_payment_id,
          payment_status: f.status,
          plan_status: plan.status,
          current_period_end: plan.current_period_end,
          recommended_action: "Investigar: plano ativo apesar de pagamento falho",
        });
      }
    }
    inconsistencies_count = payment_plan_inconsistencies.length;

    // Pagamentos pendentes há mais de 30 minutos
    const since30min = new Date(nowMs - 30 * 60 * 1000).toISOString();
    const { data: oldPending } = await supabaseAdmin
      .from("subscription_payments")
      .select("id,created_at,user_id,provider_payment_id,amount_cents,status")
      .eq("provider", "mercadopago")
      .eq("status", "pending")
      .not("provider_payment_id", "is", null)
      .lt("created_at", since30min)
      .order("created_at", { ascending: false })
      .limit(20);
    const pendingArr = oldPending ?? [];
    const pendingUserIds = pendingArr.map((p) => p.user_id).filter(Boolean) as string[];
    const pendingEmails = await emailsForUserIds(pendingUserIds);
    const pending_payments_to_check = pendingArr.map((p) => ({
      id: p.id,
      created_at: p.created_at,
      user_id_short: shortId(p.user_id),
      user_email: p.user_id ? (pendingEmails.get(p.user_id) ?? null) : null,
      provider_payment_id: p.provider_payment_id,
      amount_cents: p.amount_cents,
      status: p.status,
      age_minutes: Math.round((nowMs - new Date(p.created_at).getTime()) / 60000),
    }));
    const pending_older_than_30min = pending_payments_to_check.length;

    // 4) Listas recentes
    const [failedWebhooksQ, rlBlocksQ, payEventsQ, auditsQ] = await Promise.all([
      supabaseAdmin
        .from("webhook_logs")
        .select(
          "id,created_at,provider,event_type,external_id,http_status,error_message,processing_time_ms",
        )
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
      messages.push(`${inconsistencies_count} inconsistência(s) pagamento ↔ plano`);
      level = "error";
    }
    if (pending_older_than_30min > 0) {
      messages.push(`${pending_older_than_30min} pagamento(s) pendente(s) há +30 min`);
      if (level !== "error") level = "warn";
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
        pending_older_than_30min,
      },
      pending_payments_to_check,
      payment_plan_inconsistencies,
      recent_failed_webhooks,
      recent_rate_limit_blocks,
      recent_payment_events,
      recent_audit_logs,
      alerts: { level, messages },
    };
  });

// ============================================================
// Log Retention Preview (apenas diagnóstico — NÃO apaga nada)
// ============================================================

export type LogRetentionPreview = {
  generated_at: string;
  policies: Array<{
    table: "webhook_logs" | "audit_logs" | "rate_limit_events" | "payment_events";
    retention_days: number;
    cutoff_at: string;
    eligible_to_delete: number;
    total: number;
  }>;
};

export const getLogRetentionPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LogRetentionPreview> => {
    const userId = (context as { userId: string }).userId;
    await ensureAdmin(userId);

    const policies = [
      { table: "webhook_logs" as const, retention_days: 90 },
      { table: "audit_logs" as const, retention_days: 180 },
      { table: "rate_limit_events" as const, retention_days: 30 },
      { table: "payment_events" as const, retention_days: 180 },
    ];

    const results = await Promise.all(
      policies.map(async (pol) => {
        const cutoff = new Date(
          Date.now() - pol.retention_days * 24 * 60 * 60 * 1000,
        ).toISOString();
        const [{ count: total }, { count: eligible }] = await Promise.all([
          supabaseAdmin.from(pol.table).select("id", { count: "exact", head: true }),
          supabaseAdmin
            .from(pol.table)
            .select("id", { count: "exact", head: true })
            .lt("created_at", cutoff),
        ]);
        return {
          table: pol.table,
          retention_days: pol.retention_days,
          cutoff_at: cutoff,
          eligible_to_delete: eligible ?? 0,
          total: total ?? 0,
        };
      }),
    );

    return { generated_at: new Date().toISOString(), policies: results };
  });

// ============================================================
// Log Retention Cleanup (apaga apenas logs antigos — admin only)
// Política FIXA no servidor — não aceita parâmetros do cliente.
// ============================================================

export type LogRetentionCleanupResult = {
  executed_at: string;
  actor_email: string | null;
  results: Array<{
    table: "webhook_logs" | "audit_logs" | "rate_limit_events" | "payment_events";
    retention_days: number;
    cutoff_at: string;
    deleted: number;
    success: boolean;
    error?: string;
  }>;
};

const RETENTION_POLICY = [
  { table: "webhook_logs" as const, retention_days: 90 },
  { table: "audit_logs" as const, retention_days: 180 },
  { table: "rate_limit_events" as const, retention_days: 30 },
  { table: "payment_events" as const, retention_days: 180 },
];

export const runLogRetentionCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LogRetentionCleanupResult> => {
    const userId = (context as { userId: string }).userId;
    const actorEmail = await ensureAdmin(userId);

    const results: LogRetentionCleanupResult["results"] = [];

    for (const pol of RETENTION_POLICY) {
      const cutoff = new Date(Date.now() - pol.retention_days * 24 * 60 * 60 * 1000).toISOString();
      try {
        // Pre-count elegíveis (mais confiável que `count: exact` no delete em alguns providers)
        const { count: eligible, error: countErr } = await supabaseAdmin
          .from(pol.table)
          .select("id", { count: "exact", head: true })
          .lt("created_at", cutoff);
        if (countErr) throw new Error(countErr.message);

        const { error: delErr } = await supabaseAdmin
          .from(pol.table)
          .delete()
          .lt("created_at", cutoff);
        if (delErr) throw new Error(delErr.message);

        results.push({
          table: pol.table,
          retention_days: pol.retention_days,
          cutoff_at: cutoff,
          deleted: eligible ?? 0,
          success: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "erro desconhecido";
        results.push({
          table: pol.table,
          retention_days: pol.retention_days,
          cutoff_at: cutoff,
          deleted: 0,
          success: false,
          error: msg,
        });
      }
    }

    const executedAt = new Date().toISOString();

    // Registra auditoria (depois da limpeza para não ser apagada por ela mesma)
    await logAuditEvent({
      actor_user_id: userId,
      actor_email: actorEmail,
      action: "log_retention_cleanup",
      entity_type: "system",
      metadata: {
        executed_at: executedAt,
        tables: results.map((r) => ({
          table: r.table,
          retention_days: r.retention_days,
          cutoff_at: r.cutoff_at,
          deleted: r.deleted,
          success: r.success,
        })),
      },
    });

    return {
      executed_at: executedAt,
      actor_email: actorEmail ?? null,
      results,
    };
  });
