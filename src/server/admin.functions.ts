import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
];

async function ensureAdmin(supabase: any, userId: string): Promise<string> {
  // Pega email pelo admin client (claims já tem userId, mas precisamos do email)
  const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = (u?.user?.email ?? "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    // Verifica role owner como fallback
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isOwner = (roles ?? []).some((r: any) => r.role === "owner");
    if (!isOwner) {
      throw new Response("Forbidden", { status: 403 });
    }
  }
  return email;
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

    // 1) Listar todos os usuários auth (paginação)
    const allAuthUsers: { id: string; email: string | null; phone: string | null; created_at: string }[] = [];
    let page = 1;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      const list = data?.users ?? [];
      for (const u of list) {
        allAuthUsers.push({
          id: u.id,
          email: u.email ?? null,
          phone: (u.phone as string | null) ?? null,
          created_at: u.created_at,
        });
      }
      if (list.length < 1000) break;
      page += 1;
      if (page > 20) break; // safety
    }

    const userIds = allAuthUsers.map((u) => u.id);

    const [profilesRes, plansRes, paymentsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, nome, telefone, tipo_cadastro").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("user_plans").select("*").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("subscription_payments")
        .select("id, user_id, plano, method, status, amount_cents, periodicidade, months, discount_percent, paid_at, created_at")
        .order("created_at", { ascending: false }),
    ]);

    const profiles = profilesRes.data ?? [];
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

    const users: AdminUserRow[] = allAuthUsers.map((au) => {
      const prof: any = profileBy.get(au.id);
      const plan: any = planBy.get(au.id);
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
        plano: plan?.plano ?? "free",
        status: plan?.status ?? "sem_assinatura",
        periodicidade: plan?.periodicidade ?? null,
        months: plan?.months ?? null,
        current_period_start: plan?.current_period_start ?? null,
        current_period_end: plan?.current_period_end ?? null,
        access_until: plan?.access_until ?? null,
        cancelled_at: plan?.cancelled_at ?? null,
        last_payment_id: last?.id ?? null,
        last_payment_amount_cents: last?.amount_cents ?? null,
        last_payment_method: last?.method ?? null,
        last_payment_status: last?.status ?? null,
        last_payment_at: last?.paid_at ?? last?.created_at ?? null,
        next_payment_at: plan?.current_period_end ?? plan?.access_until ?? null,
        total_paid_cents: total,
        payments_count: paid.length,
      };
    });

    // Totais
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const approved = payments.filter((p) => p.status === "approved" || p.status === "paid");
    const revenueAllCents = approved.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
    const revenueMonthCents = approved
      .filter((p) => (p.paid_at ?? p.created_at) >= monthStart)
      .reduce((s, p) => s + (p.amount_cents ?? 0), 0);

    // MRR estimado: somatório do último pagamento aprovado de cada usuário ativo, normalizado para mês
    let mrrCents = 0;
    for (const u of users) {
      if (u.status !== "ativo") continue;
      if (!u.last_payment_amount_cents || u.last_payment_status !== "approved" && u.last_payment_status !== "paid") continue;
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

    const activeUsers = users.filter((u) => u.status === "ativo").length;
    const noPlanUsers = users.filter((u) => u.status === "sem_assinatura" || u.plano === "free").length;
    const cancelledOrExpiredUsers = users.filter((u) => u.status === "cancelado" || u.status === "vencido").length;

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
