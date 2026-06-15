import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import { reconcilePendingCardPaymentsForUser } from "@/server/mercadopago.server";
import { logAuditEvent } from "@/server/logs.server";
import {
  diagnoseMercadoPagoPayment,
  reconcileMercadoPagoPaymentById,
} from "@/server/mercadopago-diagnostics.server";

const ADMIN_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
];

const USER_DATA_TABLES = [
  "aprendizado_categoria",
  "bancos",
  "cartoes",
  "categorias",
  "contas_a_pagar",
  "contas_a_receber",
  "dinheiro_guardado",
  "extratos_importados",
  "faturas_cartao",
  "gastos",
  "investimentos_ativos",
  "investimentos_atualizacoes",
  "investimentos_importacoes",
  "investimentos_movimentacoes",
  "investimentos_rendimentos",
  "limites",
  "metas_financeiras",
  "movimentacoes_meta",
  "receitas",
  "recorrencias",
  "subscription_payments",
  "transferencias_internas",
  "user_plans",
  "user_roles",
  "whatsapp_links",
  "whatsapp_messages",
] as const;

export const deleteUserById = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ targetUserId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const actorEmail = await ensureAdmin(context.supabase, userId);

    if (data.targetUserId === userId) {
      throw new Error("Você não pode excluir a própria conta de administrador.");
    }

    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const targetEmail = (targetUser?.user?.email ?? "").toLowerCase();
    if (ADMIN_EMAILS.includes(targetEmail)) {
      throw new Error("Não é permitido excluir outro administrador.");
    }
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.targetUserId);
    if ((roles ?? []).some((r: any) => r.role === "owner")) {
      throw new Error("Não é permitido excluir um usuário com papel de owner.");
    }

    await supabaseAdmin.from("profiles").delete().eq("id", data.targetUserId);

    for (const table of USER_DATA_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any).from(table).delete().eq("user_id", data.targetUserId);
      if (error) console.error(`[deleteUserById] ${table}`, error.message);
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(data.targetUserId);
    if (authError) {
      console.error("[deleteUserById] auth.admin.deleteUser", authError);
      await logAuditEvent({
        actor_user_id: userId,
        actor_email: actorEmail,
        action: "admin_delete_user",
        target_user_id: data.targetUserId,
        target_email: targetEmail,
        entity_type: "user",
        entity_id: data.targetUserId,
        metadata: { ok: false, error: authError.message },
      });
      throw new Error("Não foi possível excluir o usuário no provedor de autenticação.");
    }

    await logAuditEvent({
      actor_user_id: userId,
      actor_email: actorEmail,
      action: "admin_delete_user",
      target_user_id: data.targetUserId,
      target_email: targetEmail,
      entity_type: "user",
      entity_id: data.targetUserId,
      metadata: { ok: true, tables_cleared: USER_DATA_TABLES.length },
    });

    return { ok: true };
  });

async function ensureAdmin(_supabase: any, userId: string): Promise<string> {
  try {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = (u?.user?.email ?? "").toLowerCase();
    if (ADMIN_EMAILS.includes(email)) return email;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isOwner = (roles ?? []).some((r: any) => r.role === "owner");
    if (isOwner) return email;
    throw new Error("FORBIDDEN");
  } catch (e: any) {
    if (e?.message === "FORBIDDEN") throw e;
    throw new Error("FORBIDDEN");
  }
}


export type AdminUserRow = {
  user_id: string;
  email: string;
  nome: string | null;
  telefone: string | null;
  tipo_cadastro: string | null;
  created_at: string;
  plano: string;
  status: string;
  periodicidade: string | null;
  months: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  access_until: string | null;
  cancelled_at: string | null;
  last_payment_id: string | null;
  last_payment_amount_cents: number | null;
  last_payment_method: string | null;
  last_payment_status: string | null;
  last_payment_at: string | null;
  next_payment_at: string | null;
  total_paid_cents: number;
  payments_count: number;
};

export type AdminPaymentRow = {
  id: string;
  user_id: string;
  plano: string;
  method: string;
  status: string;
  amount_cents: number;
  periodicidade: string;
  months: number;
  discount_percent: number;
  paid_at: string | null;
  created_at: string;
};

export type AdminDashboardData = {
  users: AdminUserRow[];
  payments: AdminPaymentRow[];
  totals: {
    totalUsers: number;
    activeUsers: number;
    noPlanUsers: number;
    cancelledOrExpiredUsers: number;
    revenueAllCents: number;
    revenueMonthCents: number;
    mrrCents: number;
    topPlan: string | null;
  };
};

export const getAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminDashboardData> => {
    const { userId } = context;
    await ensureAdmin(context.supabase, userId);

    // 1) Listar todos os usuários auth (paginação) — best-effort para obter emails
    const authMap = new Map<string, { email: string | null; phone: string | null; created_at: string }>();
    try {
      let page = 1;
      while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) break;
        const list = data?.users ?? [];
        for (const u of list) {
          authMap.set(u.id, {
            email: u.email ?? null,
            phone: (u.phone as string | null) ?? null,
            created_at: u.created_at,
          });
        }
        if (list.length < 1000) break;
        page += 1;
        if (page > 20) break;
      }
    } catch {
      // ignore — fallback usa profiles
    }

    // 2) Fonte primária = profiles (todo cadastrado tem profile via trigger)
    const [profilesRes, plansRes, paymentsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, nome, telefone, tipo_cadastro, created_at"),
      supabaseAdmin.from("user_plans").select("*"),
      supabaseAdmin
        .from("subscription_payments")
        .select("id, user_id, plano, method, status, amount_cents, periodicidade, months, discount_percent, paid_at, created_at")
        .order("created_at", { ascending: false }),
    ]);

    // Reconcilia pagamentos por cartão pendentes (best-effort) para usuários
    // com tentativas recentes — assim o admin reflete pagamentos aprovados no MP.
    const pendingCardUsers = new Set<string>();
    for (const p of (paymentsRes.data ?? []) as Array<{ user_id: string; method: string; status: string; created_at: string }>) {
      if (p.method !== "card" || p.status !== "pending") continue;
      const ageMs = Date.now() - new Date(p.created_at).getTime();
      if (ageMs > 3 * 24 * 60 * 60 * 1000) continue;
      pendingCardUsers.add(p.user_id);
    }
    if (pendingCardUsers.size > 0) {
      await Promise.allSettled(
        Array.from(pendingCardUsers).slice(0, 25).map((uid) => reconcilePendingCardPaymentsForUser(uid)),
      );
      // Recarrega pagamentos pós-reconciliação
      const refreshed = await supabaseAdmin
        .from("subscription_payments")
        .select("id, user_id, plano, method, status, amount_cents, periodicidade, months, discount_percent, paid_at, created_at")
        .order("created_at", { ascending: false });
      if (refreshed.data) paymentsRes.data = refreshed.data;
    }

    const profiles = profilesRes.data ?? [];

    // União: profiles ∪ authMap (caso algum usuário auth não tenha profile)
    const allIds = new Set<string>();
    for (const p of profiles) allIds.add((p as any).id);
    for (const id of authMap.keys()) allIds.add(id);

    const allAuthUsers = Array.from(allIds).map((id) => {
      const a = authMap.get(id);
      const p: any = profiles.find((x: any) => x.id === id);
      return {
        id,
        email: a?.email ?? null,
        phone: a?.phone ?? null,
        created_at: a?.created_at ?? p?.created_at ?? new Date().toISOString(),
      };
    });
    const plans = plansRes.data ?? [];
    const payments = (paymentsRes.data ?? []) as AdminPaymentRow[];

    const profileBy = new Map(profiles.map((p: any) => [p.id, p]));
    const planBy = new Map(plans.map((p: any) => [p.user_id, p]));

    const paidPaymentsByUser = new Map<string, AdminPaymentRow[]>();
    const lastPaymentByUser = new Map<string, AdminPaymentRow>();
    for (const p of payments) {
      if (!lastPaymentByUser.has(p.user_id)) lastPaymentByUser.set(p.user_id, p);
      if (p.status === "approved" || p.status === "paid") {
        const arr = paidPaymentsByUser.get(p.user_id) ?? [];
        arr.push(p);
        paidPaymentsByUser.set(p.user_id, arr);
      }
    }

    const users: AdminUserRow[] = await Promise.all(allAuthUsers.map(async (au) => {
      const prof: any = profileBy.get(au.id);
      const sub = await getSubscriptionForUserIdentity({ userId: au.id, email: au.email, repairLink: false });
      const last = lastPaymentByUser.get(au.id);
      const paid = paidPaymentsByUser.get(au.id) ?? [];
      const total = paid.reduce((s, x) => s + (x.amount_cents ?? 0), 0);
      return {
        user_id: au.id,
        email: au.email ?? "",
        nome: prof?.nome ?? null,
        telefone: prof?.telefone ?? au.phone ?? null,
        tipo_cadastro: prof?.tipo_cadastro ?? null,
        created_at: au.created_at,
        plano: sub.storedPlan,
        status: sub.status,
        periodicidade: sub.periodicidade,
        months: sub.months,
        current_period_start: sub.currentPeriodStart,
        current_period_end: sub.currentPeriodEnd,
        access_until: sub.accessUntil,
        cancelled_at: sub.cancelledAt,
        last_payment_id: sub.lastPaymentId ?? last?.id ?? null,
        last_payment_amount_cents: sub.paymentAmountCents ?? last?.amount_cents ?? null,
        last_payment_method: sub.paymentMethod ?? last?.method ?? null,
        last_payment_status: sub.paymentStatus ?? last?.status ?? null,
        last_payment_at: sub.paidAt ?? last?.paid_at ?? last?.created_at ?? null,
        next_payment_at: sub.currentPeriodEnd ?? sub.accessUntil ?? null,
        total_paid_cents: total,
        payments_count: paid.length,
      };
    }));

    // Totais
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const approved = payments.filter((p) => p.status === "approved" || p.status === "paid");
    const revenueAllCents = approved.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
    const revenueMonthCents = approved
      .filter((p) => (p.paid_at ?? p.created_at) >= monthStart)
      .reduce((s, p) => s + (p.amount_cents ?? 0), 0);

    // MRR estimado: somatório do último pagamento aprovado de cada usuário ativo,
    // normalizado para mês. Admin Master e usuários sem pagamento real são excluídos.
    let mrrCents = 0;
    for (const u of users) {
      if (u.status !== "ativo") continue;
      if (u.plano === "admin_master") continue;
      if (!u.last_payment_amount_cents) continue;
      if (u.last_payment_status !== "approved" && u.last_payment_status !== "paid") continue;
      const months = u.months && u.months > 0 ? u.months : 1;
      mrrCents += Math.round((u.last_payment_amount_cents ?? 0) / months);
    }

    const planCount = new Map<string, number>();
    for (const p of approved) {
      planCount.set(p.plano, (planCount.get(p.plano) ?? 0) + 1);
    }
    let topPlan: string | null = null;
    let topN = 0;
    for (const [k, v] of planCount.entries()) {
      if (v > topN) {
        topN = v;
        topPlan = k;
      }
    }

    // Admin Master não conta como pagante real. Considera "ativo" apenas
    // usuários com plano premium (não admin_master/free/sem_assinatura).
    const activeUsers = users.filter(
      (u) => u.status === "ativo" && u.plano !== "admin_master" && u.plano !== "free" && u.plano !== "sem_assinatura",
    ).length;
    const noPlanUsers = users.filter((u) => u.status === "sem_assinatura" || u.plano === "free").length;
    // 'expirado' é o status real devolvido por getSubscriptionForUserIdentity.
    const cancelledOrExpiredUsers = users.filter(
      (u) => u.status === "cancelado" || u.status === "expirado",
    ).length;

    return {
      users,
      payments,
      totals: {
        totalUsers: users.length,
        activeUsers,
        noPlanUsers,
        cancelledOrExpiredUsers,
        revenueAllCents,
        revenueMonthCents,
        mrrCents,
        topPlan,
      },
    };
  });

const PLAN_TIERS = [
  "pessoal_premium",
  "mei_essencial",
  "mei_inteligente",
  "empresa",
] as const;

const PERIODS = ["mensal", "trimestral", "semestral", "anual"] as const;
const PERIOD_MONTHS: Record<(typeof PERIODS)[number], number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/**
 * Concede manualmente um plano ativo a um usuário. Disponível APENAS para
 * o Admin Master felipe.out.silva@outlook.com (mesmo se outro admin estiver
 * cadastrado no allowlist).
 */
export const grantPlanManually = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        plano: z.enum(PLAN_TIERS),
        periodicidade: z.enum(PERIODS).default("mensal"),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        amountCents: z.number().int().nonnegative().optional(),
        observacao: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const callerEmail = (u?.user?.email ?? "").toLowerCase();
    if (callerEmail !== "felipe.out.silva@outlook.com") {
      throw new Error("Apenas o Admin Master Felipe pode conceder planos manualmente.");
    }

    const months = PERIOD_MONTHS[data.periodicidade];
    const start = data.startDate ? new Date(data.startDate) : new Date();
    const end = data.endDate
      ? new Date(data.endDate)
      : new Date(start.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    // Registro contábil/auditoria do pagamento manual
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("subscription_payments").insert({
      user_id: data.targetUserId,
      plano: data.plano,
      amount_cents: data.amountCents ?? 0,
      method: "manual",
      periodicidade: data.periodicidade,
      months,
      discount_percent: 0,
      provider: "manual",
      status: "approved",
      paid_at: start.toISOString(),
      payload: {
        granted_by: callerEmail,
        granted_at: new Date().toISOString(),
        observacao: data.observacao ?? null,
        manual_grant: true,
      },
    });

    // Ativa o plano no user_plans
    const update = {
      plano: data.plano,
      status: "ativo",
      periodicidade: data.periodicidade,
      months,
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      cancelled_at: null,
      access_until: null,
      last_payment_id: `manual:${callerEmail}:${Date.now()}`,
    } as const;
    const { data: existing } = await supabaseAdmin
      .from("user_plans")
      .select("user_id, plano, status, periodicidade, current_period_start, current_period_end")
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("user_plans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(update as any)
        .eq("user_id", data.targetUserId);
    } else {
      await supabaseAdmin
        .from("user_plans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ user_id: data.targetUserId, ...update } as any);
    }

    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    await logAuditEvent({
      actor_user_id: userId,
      actor_email: callerEmail,
      action: "admin_grant_plan",
      target_user_id: data.targetUserId,
      target_email: targetUser?.user?.email ?? null,
      entity_type: "plan",
      entity_id: data.targetUserId,
      old_data: existing ?? null,
      new_data: update,
      metadata: { observacao: data.observacao ?? null, amount_cents: data.amountCents ?? 0 },
    });

    return { ok: true as const };
  });

const STATUS_VALUES = [
  "ativo",
  "aguardando_pagamento",
  "cancelado",
  "expirado",
  "sem_assinatura",
  "teste",
] as const;

/**
 * Permite ao admin alterar manualmente o status do plano de um usuário.
 * - "ativo": requer pagamento aprovado existente OU forceActivate=true.
 * - "sem_assinatura": também limpa o plano (plano = sem_assinatura).
 * - "cancelado" / "expirado": preserva o plano para histórico, marca encerramento.
 */
export const setUserStatusManually = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        status: z.enum(STATUS_VALUES),
        forceActivate: z.boolean().optional(),
        clearPlan: z.boolean().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const actorEmail = await ensureAdmin(context.supabase, userId);

    const now = new Date();
    const { data: existing } = await supabaseAdmin
      .from("user_plans")
      .select("user_id, plano, status, current_period_start, current_period_end")
      .eq("user_id", data.targetUserId)
      .maybeSingle();

    if (data.status === "ativo" && !data.forceActivate) {
      const { data: paid } = await supabaseAdmin
        .from("subscription_payments")
        .select("id")
        .eq("user_id", data.targetUserId)
        .in("status", ["approved", "paid"])
        .limit(1);
      if (!paid || paid.length === 0) {
        throw new Error(
          "Para marcar como Plano ativo é necessário ter pagamento aprovado. Marque 'Confirmar pagamento manualmente' para forçar.",
        );
      }
    }

    let update: Record<string, unknown> = {
      status: data.status,
      updated_at: now.toISOString(),
    };

    if (data.status === "sem_assinatura" || data.clearPlan) {
      update.plano = "sem_assinatura";
      update.cancelled_at = null;
      update.access_until = null;
      update.current_period_start = null;
      update.current_period_end = null;
      update.last_payment_id = null;
      update.periodicidade = null;
      update.months = null;
    } else if (data.status === "cancelado") {
      update.cancelled_at = now.toISOString();
    } else if (data.status === "expirado") {
      update.access_until = now.toISOString();
    } else if (data.status === "ativo") {
      update.cancelled_at = null;
      update.access_until = null;
    }

    if (existing) {
      await supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("user_plans").update(update as any).eq("user_id", data.targetUserId);
    } else {
      await supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("user_plans").insert({ user_id: data.targetUserId, plano: "sem_assinatura", ...update } as any);
    }

    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    await logAuditEvent({
      actor_user_id: userId,
      actor_email: actorEmail,
      action: "admin_set_status",
      target_user_id: data.targetUserId,
      target_email: targetUser?.user?.email ?? null,
      entity_type: "subscription",
      entity_id: data.targetUserId,
      old_data: existing ?? null,
      new_data: update,
      metadata: { force_activate: !!data.forceActivate, clear_plan: !!data.clearPlan },
    });

    return { ok: true as const };
  });



/**
 * Diagnóstico de um pagamento do Mercado Pago. Admin only.
 * NÃO altera estado — apenas reporta.
 */
export const diagnoseMpPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ paymentId: z.string().trim().min(3).max(64) }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await ensureAdmin(context.supabase, userId);
    const diagnosis = await diagnoseMercadoPagoPayment(data.paymentId);
    return { ok: true as const, diagnosis };
  });

/**
 * Reconciliação manual de um pagamento do Mercado Pago. Admin only.
 * Se MP estiver approved e o estado local divergir, corrige e ativa assinatura.
 * Idempotente: chamadas repetidas não duplicam ativação.
 */
export const reconcileMpPaymentById = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ paymentId: z.string().trim().min(3).max(64) }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const actorEmail = await ensureAdmin(context.supabase, userId);
    const result = await reconcileMercadoPagoPaymentById(data.paymentId, {
      user_id: userId,
      email: actorEmail,
    });
    return { ok: result.ok, applied: result.applied, message: result.message, diagnosis: result.diagnosis };
  });

/**
 * Lista os últimos eventos de pagamento (payment_events). Admin only.
 */
export const listRecentPaymentEvents = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await ensureAdmin(context.supabase, userId);
    const limit = data.limit ?? 20;
    const { data: rows, error } = await supabaseAdmin
      .from("payment_events")
      .select("id, created_at, provider, external_payment_id, status, raw_status, event_type, user_id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[]));
    const emailById = new Map<string, string>();
    for (const uid of userIds) {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (u?.user?.email) emailById.set(uid, u.user.email);
      } catch {
        // ignore
      }
    }
    return {
      events: (rows ?? []).map((r) => ({
        ...r,
        user_email: r.user_id ? emailById.get(r.user_id) ?? null : null,
      })),
    };
  });



