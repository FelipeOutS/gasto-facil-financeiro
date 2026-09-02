import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAILS = ["felipe.out.silva@outlook.com", "michael@medeiroscenografia.com.br"];

export type UserActivityRow = {
  userId: string;
  email: string;
  nome: string | null;
  plano: string | null;
  criadoEm: string;
  ultimoAcesso: string | null;
  diasSemAcessar: number | null;
  ultimaAcao: string | null;
  ultimaAcaoTipo: string | null;
  gastos: number;
  receitas: number;
  contas: number;
  outros: number;
  totalLancamentos: number;
  diasAtivos: number;
  situacao: "ativo" | "em_risco" | "inativo" | "nunca_acessou" | "sem_lancamento";
};

export type UserActivityReport = {
  geradoEm: string;
  janelaDias: number;
  totais: {
    usuarios: number;
    acessaramNaJanela: number;
    ativos24h: number;
    ativos7d: number;
    comLancamentos: number;
    semLancamentos: number;
    nuncaAcessaram: number;
    retornaram: number;
  };
  usuarios: UserActivityRow[];
};

const ACTIVITY_TABLES: Array<{ table: string; label: string; bucket: keyof Pick<UserActivityRow, "gastos" | "receitas" | "contas" | "outros"> }> = [
  { table: "gastos", label: "Lançou um gasto", bucket: "gastos" },
  { table: "receitas", label: "Lançou uma receita", bucket: "receitas" },
  { table: "contas_a_pagar", label: "Cadastrou conta a pagar", bucket: "contas" },
  { table: "contas_a_receber", label: "Cadastrou conta a receber", bucket: "contas" },
  { table: "cartoes", label: "Cadastrou um cartão", bucket: "outros" },
  { table: "metas_financeiras", label: "Criou uma meta", bucket: "outros" },
  { table: "mercado_listas", label: "Criou lista de mercado", bucket: "outros" },
  { table: "investimentos_ativos", label: "Cadastrou investimento", bucket: "outros" },
  { table: "bens", label: "Cadastrou um bem", bucket: "outros" },
];

function daysBetween(fromIso: string, to: Date): number {
  const ms = to.getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Relatório de acesso e uso por usuário. Admin Master apenas.
 * Não expõe valores financeiros — apenas contagem de ações e datas.
 */
export const getUserActivityReport = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({ days: z.number().int().min(1).max(365).optional() })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Autorização: e-mail de admin master ou papel owner.
    const { data: me } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const myEmail = (me?.user?.email ?? "").toLowerCase();
    let allowed = ADMIN_EMAILS.includes(myEmail);
    if (!allowed) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      allowed = (roles ?? []).some((r: { role: string }) => r.role === "owner");
    }
    if (!allowed) throw new Error("FORBIDDEN");

    const days = data.days ?? 30;
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);

    // 1. Usuários do Auth (last_sign_in_at é a fonte de verdade do último acesso).
    type AuthUser = {
      id: string;
      email?: string | null;
      created_at: string;
      last_sign_in_at?: string | null;
    };
    const authUsers: AuthUser[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data: pageData, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error(error.message);
      const users = (pageData?.users ?? []) as unknown as AuthUser[];
      authUsers.push(...users);
      if (users.length < 200) break;
    }

    const rows = new Map<string, UserActivityRow>();
    for (const u of authUsers) {
      rows.set(u.id, {
        userId: u.id,
        email: u.email ?? "(sem e-mail)",
        nome: null,
        plano: null,
        criadoEm: u.created_at,
        ultimoAcesso: u.last_sign_in_at ?? null,
        diasSemAcessar: u.last_sign_in_at ? daysBetween(u.last_sign_in_at, now) : null,
        ultimaAcao: null,
        ultimaAcaoTipo: null,
        gastos: 0,
        receitas: 0,
        contas: 0,
        outros: 0,
        totalLancamentos: 0,
        diasAtivos: 0,
        situacao: "nunca_acessou",
      });
    }

    // 2. Nome do perfil e plano.
    const [{ data: profiles }, { data: planos }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, nome").limit(5000),
      supabaseAdmin.from("user_plans").select("user_id, plan_tier").limit(5000),
    ]);
    for (const p of (profiles ?? []) as Array<{ id: string; nome: string | null }>) {
      const row = rows.get(p.id);
      if (row) row.nome = p.nome ?? null;
    }
    for (const p of (planos ?? []) as Array<{ user_id: string; plan_tier: string | null }>) {
      const row = rows.get(p.user_id);
      if (row) row.plano = p.plan_tier ?? null;
    }

    // 3. Ações por usuário (apenas contagens e datas, nunca valores).
    const activeDays = new Map<string, Set<string>>();
    const lastAction = new Map<string, { at: string; label: string; table: string }>();

    for (const spec of ACTIVITY_TABLES) {
      const { data: records, error } = await supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(spec.table as any)
        .select("user_id, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(20000);
      if (error) continue;
      for (const rec of (records ?? []) as Array<{
        user_id: string | null;
        created_at: string | null;
      }>) {
        if (!rec.user_id || !rec.created_at) continue;
        const row = rows.get(rec.user_id);
        if (!row) continue;
        row[spec.bucket] += 1;
        row.totalLancamentos += 1;
        const set = activeDays.get(rec.user_id) ?? new Set<string>();
        set.add(rec.created_at.slice(0, 10));
        activeDays.set(rec.user_id, set);
        const prev = lastAction.get(rec.user_id);
        if (!prev || prev.at < rec.created_at) {
          lastAction.set(rec.user_id, {
            at: rec.created_at,
            label: spec.label,
            table: spec.table,
          });
        }
      }
    }

    for (const row of rows.values()) {
      const la = lastAction.get(row.userId);
      row.ultimaAcao = la?.at ?? null;
      row.ultimaAcaoTipo = la?.label ?? null;
      row.diasAtivos = activeDays.get(row.userId)?.size ?? 0;
      const semAcesso = row.diasSemAcessar;
      if (semAcesso === null) row.situacao = "nunca_acessou";
      else if (semAcesso <= 7) row.situacao = row.totalLancamentos > 0 ? "ativo" : "sem_lancamento";
      else if (semAcesso <= 30) row.situacao = "em_risco";
      else row.situacao = "inativo";
    }

    const list = Array.from(rows.values()).sort((a, b) => {
      const av = a.ultimoAcesso ?? "";
      const bv = b.ultimoAcesso ?? "";
      return bv.localeCompare(av);
    });

    const report: UserActivityReport = {
      geradoEm: now.toISOString(),
      janelaDias: days,
      totais: {
        usuarios: list.length,
        acessaramNaJanela: list.filter(
          (r) => r.ultimoAcesso && new Date(r.ultimoAcesso) >= since,
        ).length,
        ativos24h: list.filter((r) => r.diasSemAcessar !== null && r.diasSemAcessar < 1).length,
        ativos7d: list.filter((r) => r.diasSemAcessar !== null && r.diasSemAcessar <= 7).length,
        comLancamentos: list.filter((r) => r.totalLancamentos > 0).length,
        semLancamentos: list.filter((r) => r.totalLancamentos === 0).length,
        nuncaAcessaram: list.filter((r) => r.ultimoAcesso === null).length,
        retornaram: list.filter((r) => r.diasAtivos > 1).length,
      },
      usuarios: list,
    };
    return report;
  });
