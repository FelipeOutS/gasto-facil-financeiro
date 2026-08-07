import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { PLAN_LABEL } from "@/lib/plans";
import {
  formatAdminDate,
  formatAdminDateTime,
  formatAdminTime,
  adminDateTimeTooltip,
  compareCreatedAtDesc,
} from "@/lib/admin-datetime";

import { usePlan } from "@/lib/use-plan";
import {
  getAdminDashboard,
  deleteUserById,
  grantPlanManually,
  setUserStatusManually,
  diagnoseMpPayment,
  reconcileMpPaymentById,
  listRecentPaymentEvents,
  type AdminDashboardData,
  type AdminUserRow,
} from "@/lib/admin.functions";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  CheckCircle2,
  XCircle,
  Ban,
  DollarSign,
  TrendingUp,
  Repeat,
  Crown,
  Download,
  Search,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — Gasto Inteligente" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: AdminPage,
});

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(s: string | null) {
  return formatAdminDate(s);
}

/** Data + horário do cadastro (America/Sao_Paulo). */
function fmtDateTime(s: string | null) {
  return formatAdminDateTime(s);
}

type DisplayStatus = "ativo" | "aguardando" | "cancelado_vencido" | "conta_criada";

// Nota: estes rótulos representam status COMERCIAL (plano/pagamento),
// não integridade técnica do cadastro (Auth/profile/user_plans).
const STATUS_LABEL: Record<DisplayStatus, string> = {
  ativo: "Plano ativo",
  aguardando: "Pagamento pendente",
  cancelado_vencido: "Cancelado/Vencido",
  conta_criada: "Gratuito ativo",
};

const STATUS_COLORS: Record<DisplayStatus, string> = {
  ativo: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  aguardando: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  cancelado_vencido: "bg-red-500/15 text-red-500 border-red-500/30",
  conta_criada: "bg-muted text-muted-foreground border-border",
};


function getDisplayStatus(u: AdminUserRow): DisplayStatus {
  const paid = u.last_payment_status === "approved" || u.last_payment_status === "paid";
  const hasPlan = !!u.plano && u.plano !== "free" && u.plano !== "sem_assinatura";
  if (u.status === "ativo" && paid && hasPlan) return "ativo";
  if (
    u.status === "cancelado" ||
    u.status === "vencido" ||
    u.status === "expirado" ||
    u.last_payment_status === "rejected" ||
    u.last_payment_status === "expired" ||
    u.last_payment_status === "cancelled"
  ) {
    return "cancelado_vencido";
  }
  // "Aguardando pagamento" só vale se o usuário escolheu plano e o pagamento
  // pendente foi criado nos últimos 3 dias.
  const lastAt = u.last_payment_at ? new Date(u.last_payment_at).getTime() : 0;
  const within3d = lastAt > 0 && Date.now() - lastAt <= 3 * 24 * 60 * 60 * 1000;
  if (u.last_payment_status === "pending" && within3d) return "aguardando";
  if (hasPlan && !paid && within3d) return "aguardando";
  // Pendente expirado conta como cancelado/vencido
  if (u.last_payment_status === "pending" && !within3d) return "cancelado_vencido";
  return "conta_criada";
}

const PAY_STATUS_COLORS: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-500",
  paid: "bg-emerald-500/15 text-emerald-500",
  pending: "bg-amber-500/15 text-amber-500",
  rejected: "bg-red-500/15 text-red-500",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-orange-500/15 text-orange-500",
};

function periodToDate(period: string): Date | null {
  const now = new Date();
  if (period === "all") return null;
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "3m") return new Date(now.getFullYear(), now.getMonth() - 3, 1);
  if (period === "6m") return new Date(now.getFullYear(), now.getMonth() - 6, 1);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdminMaster } = usePlan();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [toDelete, setToDelete] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editStatus, setEditStatus] = useState<AdminUserRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Guard de acesso
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      void navigate({ to: "/login" });
      return;
    }
    if (!isAdminMaster) {
      setAuthorized(false);
      return;
    }
    setAuthorized(true);
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (authorized !== true) return;
    let cancel = false;
    setLoading(true);
    getAdminDashboard()
      .then((d) => {
        if (!cancel) setData(d);
      })
      .catch((e) => {
        if (!cancel) setErr(e?.message ?? "Erro ao carregar dados");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [authorized, reloadKey]);

  // A lista de e-mails de Admin Master vive server-side (fail-closed).
  // Client protege apenas o próprio usuário logado; ações destrutivas contra
  // outros Admin Master são enforced no servidor (delete/grant/status).
  // Fallback: reconhece admin master pelo plano armazenado.
  const isProtectedAdmin = (email: string) => {
    if (isAdminMaster && email === user?.email) return true;
    const row = data?.users.find((u) => u.email === email);
    return (row?.plano ?? "").toLowerCase() === "admin_master";
  };

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteUserById({ data: { targetUserId: toDelete.user_id } });
      toast.success("Usuário excluído com sucesso");
      setToDelete(null);
      setSelected(null);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir usuário");
    } finally {
      setDeleting(false);
    }
  }

  const usersList = data?.users ?? [];
  const paymentsList = data?.payments ?? [];

  const filteredUsers = useMemo(() => {
    const sd = periodToDate(filterPeriod);
    const q = search.trim().toLowerCase();
    return (
      usersList
        .filter((u) => {
          if (
            q &&
            !(u.email.toLowerCase().includes(q) || (u.nome ?? "").toLowerCase().includes(q))
          )
            return false;
          if (filterPlan !== "all" && u.plano !== filterPlan) return false;
          if (filterStatus !== "all" && getDisplayStatus(u) !== filterStatus) return false;
          if (filterMethod !== "all" && u.last_payment_method !== filterMethod) return false;
          if (sd && new Date(u.created_at) < sd) return false;
          return true;
        })
        // Ordena pelo timestamp real do cadastro (mais recente primeiro)
        .sort(compareCreatedAtDesc)
    );


  }, [usersList, search, filterPlan, filterStatus, filterMethod, filterPeriod]);

  // Charts data
  const revByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paymentsList) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      const dt = new Date(p.paid_at ?? p.created_at);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + (p.amount_cents ?? 0));
    }
    return [...map.entries()]
      .sort()
      .slice(-12)
      .map(([k, v]) => ({ mes: k, valor: v / 100 }));
  }, [paymentsList]);

  const usersByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usersList) {
      const dt = new Date(u.created_at);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort()
      .slice(-12)
      .map(([k, v]) => ({ mes: k, total: v }));
  }, [usersList]);

  const planMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paymentsList) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      map.set(p.plano, (map.get(p.plano) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, v]) => ({
      name: PLAN_LABEL[k as keyof typeof PLAN_LABEL] ?? k,
      value: v,
    }));
  }, [paymentsList]);

  const methodMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paymentsList) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      map.set(p.method, (map.get(p.method) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, v]) => ({
      name: k === "pix" ? "Pix" : k === "card" ? "Cartão" : k,
      value: v,
    }));
  }, [paymentsList]);

  const statusMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usersList) {
      map.set(u.status, (map.get(u.status) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, v]) => ({ name: k, value: v }));
  }, [usersList]);

  function exportCsv() {
    const rows = filteredUsers.map((u) => ({
      nome: u.nome ?? "",
      email: u.email,
      telefone: u.telefone ?? "",
      tipo_cadastro: u.tipo_cadastro ?? "",
      cadastro: fmtDateTime(u.created_at),
      plano: PLAN_LABEL[u.plano as keyof typeof PLAN_LABEL] ?? u.plano,
      ciclo: u.periodicidade ?? "",
      valor_pago: u.last_payment_amount_cents ? fmtMoney(u.last_payment_amount_cents) : "",
      forma: u.last_payment_method ?? "",
      status_pgto: u.last_payment_status ?? "",
      status_plano: u.status,
      inicio_plano: fmtDate(u.current_period_start),
      vencimento_plano: fmtDate(u.current_period_end),
      ultimo_pgto: fmtDate(u.last_payment_at),
      proximo: fmtDate(u.next_payment_at),
      total_pago: fmtMoney(u.total_paid_cents),
    }));
    const headers = Object.keys(rows[0] ?? { vazio: "" });
    const csv = [
      headers.join(";"),
      ...rows.map((r) =>
        headers.map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(";"),
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authorized === false) {
    return (
      <MobileShell>
        <div className="mt-10 flex flex-col items-center text-center">
          <Ban className="h-10 w-10 text-destructive" />
          <h1 className="mt-3 text-xl font-bold">Acesso negado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área é exclusiva do administrador master.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/app" })}>
            Voltar ao Dashboard
          </Button>
        </div>
      </MobileShell>
    );
  }

  if (authorized !== true || loading) {
    return (
      <MobileShell wide>
        <div className="py-10 text-center text-sm text-muted-foreground">
          Carregando dados administrativos…
        </div>
      </MobileShell>
    );
  }

  const t = data?.totals ?? {
    totalUsers: 0,
    activeUsers: 0,
    noPlanUsers: 0,
    cancelledOrExpiredUsers: 0,
    revenueAllCents: 0,
    revenueMonthCents: 0,
    mrrCents: 0,
    topPlan: null as string | null,
  };

  // Recalcula contagens excluindo admins e usando o status de exibição,
  // que reflete corretamente "Plano ativo / Cancelado-Vencido / Conta criada".
  const commonUsers = usersList.filter((u) => !isProtectedAdmin(u.email));
  const activeCount = commonUsers.filter((u) => getDisplayStatus(u) === "ativo").length;
  const cancelledCount = commonUsers.filter(
    (u) => getDisplayStatus(u) === "cancelado_vencido",
  ).length;
  const noPlanCount = commonUsers.filter((u) => {
    const ds = getDisplayStatus(u);
    return ds === "conta_criada" || ds === "aguardando";
  }).length;

  const cards = [
    { label: "Total cadastrados", value: t.totalUsers, icon: Users, color: "text-blue-500" },
    { label: "Plano ativo", value: activeCount, icon: CheckCircle2, color: "text-emerald-500" },
    { label: "Sem plano", value: noPlanCount, icon: XCircle, color: "text-muted-foreground" },
    { label: "Cancelados/vencidos", value: cancelledCount, icon: Ban, color: "text-orange-500" },
    {
      label: "Receita total",
      value: fmtMoney(t.revenueAllCents),
      icon: DollarSign,
      color: "text-emerald-500",
    },
    {
      label: "Receita do mês",
      value: fmtMoney(t.revenueMonthCents),
      icon: TrendingUp,
      color: "text-emerald-500",
    },
    {
      label: "Recorrente (MRR)",
      value: fmtMoney(t.mrrCents),
      icon: Repeat,
      color: "text-violet-500",
    },
    {
      label: "Plano mais vendido",
      value: t.topPlan ? (PLAN_LABEL[t.topPlan as keyof typeof PLAN_LABEL] ?? t.topPlan) : "—",
      icon: Crown,
      color: "text-amber-500",
    },
  ];

  const PIE_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 8,
      color: "hsl(var(--popover-foreground))",
      fontSize: 12,
    },
    labelStyle: { color: "hsl(var(--popover-foreground))" },
    itemStyle: { color: "hsl(var(--popover-foreground))" },
    cursor: { fill: "hsl(var(--muted) / 0.3)", stroke: "hsl(var(--border))" } as any,
  };

  return (
    <MobileShell wide>
      <div className="pt-4 sm:pt-6 overflow-x-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Painel Admin</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Visão geral de usuários, planos e arrecadação.
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" asChild className="gap-2 flex-1 sm:flex-none">
              <a href="/admin/saude">
                <Activity className="h-4 w-4" /> Saúde do Sistema
              </a>
            </Button>
            <Button variant="outline" onClick={exportCsv} className="gap-2 flex-1 sm:flex-none">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        </div>

        {err && (
          <Card className="mt-4 border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">
              Não foi possível carregar todos os dados administrativos: {err}
            </CardContent>
          </Card>
        )}

        {/* Cards */}
        <div className="mt-4 sm:mt-6 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
                <div
                  className={`grid h-9 w-9 sm:h-10 sm:w-10 shrink-0 place-items-center rounded-xl bg-muted ${c.color}`}
                >
                  <c.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground leading-tight break-words">
                    {c.label}
                  </p>
                  <p className="text-sm sm:text-lg font-bold leading-tight truncate">{c.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-4 sm:mt-6 grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-sm">Receita por mês</CardTitle>
            </CardHeader>
            <CardContent className="h-56 sm:h-64 p-2 sm:p-6 sm:pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revByMonth} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" fontSize={10} />
                  <YAxis fontSize={10} width={40} />
                  <Tooltip
                    formatter={(v: any) => `R$ ${Number(v).toLocaleString("pt-BR")}`}
                    contentStyle={tooltipStyle.contentStyle}
                    labelStyle={tooltipStyle.labelStyle}
                    itemStyle={tooltipStyle.itemStyle}
                    cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="valor"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-sm">Novos usuários por mês</CardTitle>
            </CardHeader>
            <CardContent className="h-56 sm:h-64 p-2 sm:p-6 sm:pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usersByMonth} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" fontSize={10} />
                  <YAxis fontSize={10} width={32} />
                  <Tooltip
                    contentStyle={tooltipStyle.contentStyle}
                    labelStyle={tooltipStyle.labelStyle}
                    itemStyle={tooltipStyle.itemStyle}
                    cursor={{ fill: "transparent" }}
                  />
                  <Bar dataKey="total" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-sm">Planos vendidos</CardTitle>
            </CardHeader>
            <CardContent className="h-60 sm:h-64 p-2 sm:p-6 sm:pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={planMix} dataKey="value" nameKey="name" outerRadius="65%">
                    {planMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle.contentStyle}
                    labelStyle={tooltipStyle.labelStyle}
                    itemStyle={tooltipStyle.itemStyle}
                  />
                  <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-sm">Pix vs Cartão / Status</CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-6 sm:pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="h-52 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={methodMix} dataKey="value" nameKey="name" outerRadius="60%">
                      {methodMix.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle.contentStyle}
                      labelStyle={tooltipStyle.labelStyle}
                      itemStyle={tooltipStyle.itemStyle}
                    />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="h-52 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusMix} dataKey="value" nameKey="name" outerRadius="60%">
                      {statusMix.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle.contentStyle}
                      labelStyle={tooltipStyle.labelStyle}
                      itemStyle={tooltipStyle.itemStyle}
                    />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="mt-4 sm:mt-6">
          <CardContent className="grid grid-cols-1 gap-2 sm:gap-3 p-3 sm:p-4 md:grid-cols-5">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 w-full"
                placeholder="Buscar nome ou e-mail"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterPlan} onValueChange={setFilterPlan}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Plano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {Object.entries(PLAN_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="ativo">Plano ativo</SelectItem>
                <SelectItem value="aguardando">Aguardando pagamento</SelectItem>
                <SelectItem value="cancelado_vencido">Cancelado/Vencido</SelectItem>
                <SelectItem value="conta_criada">Gratuito ativo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas formas</SelectItem>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPeriod} onValueChange={setFilterPeriod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">7 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="3m">Últimos 3 meses</SelectItem>
                <SelectItem value="6m">Últimos 6 meses</SelectItem>
                <SelectItem value="year">Ano</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Lista de usuários */}
        <Card className="mt-4">
          <CardHeader className="p-3 sm:p-6">
            <CardTitle className="text-sm">Usuários ({filteredUsers.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Mobile: cards */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {filteredUsers.map((u) => {
                const ds = getDisplayStatus(u);
                const protectedRow = isProtectedAdmin(u.email) || u.user_id === user?.id;
                return (
                  <div
                    key={u.user_id}
                    className="rounded-lg border border-border bg-card p-3 active:bg-muted/40"
                    onClick={() => setSelected(u)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{u.nome ?? "—"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${STATUS_COLORS[ds]}`}
                      >
                        {STATUS_LABEL[ds]}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Plano: </span>
                        <span className="font-medium">
                          {PLAN_LABEL[u.plano as keyof typeof PLAN_LABEL] ?? u.plano}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Ciclo: </span>
                        <span className="font-medium">{u.periodicidade ?? "—"}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Pgto: </span>
                        <span className="font-medium">
                          {u.last_payment_method === "pix"
                            ? "Pix"
                            : u.last_payment_method === "card"
                              ? "Cartão"
                              : "—"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Cadastro: </span>
                        <span className="font-medium" title={adminDateTimeTooltip(u.created_at)}>
                          {fmtDate(u.created_at)}
                          {formatAdminTime(u.created_at) ? (
                            <span className="block text-[11px] text-muted-foreground">
                              às {formatAdminTime(u.created_at)}
                            </span>
                          ) : null}
                        </span>


                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Total pago: </span>
                        <span className="font-medium">{fmtMoney(u.total_paid_cents)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">Próx.: </span>
                        <span className="font-medium">{fmtDate(u.next_payment_at)}</span>
                      </div>
                    </div>
                    <div
                      className="mt-2 flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 gap-1 text-xs"
                        onClick={() => setEditStatus(u)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        disabled={protectedRow}
                        onClick={() => setToDelete(u)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </Button>
                    </div>
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">
                  Nenhum usuário encontrado.
                </p>
              )}
            </div>

            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Ciclo</TableHead>
                    <TableHead>Pgto.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total pago</TableHead>
                    <TableHead>Próx.</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const ds = getDisplayStatus(u);
                    const protectedRow = isProtectedAdmin(u.email) || u.user_id === user?.id;
                    return (
                      <TableRow
                        key={u.user_id}
                        className="cursor-pointer"
                        onClick={() => setSelected(u)}
                      >
                        <TableCell className="font-medium">{u.nome ?? "—"}</TableCell>
                        <TableCell className="text-xs">{u.email}</TableCell>
                        <TableCell
                          className="text-xs whitespace-nowrap"
                          title={adminDateTimeTooltip(u.created_at)}
                        >
                          {fmtDateTime(u.created_at)}
                        </TableCell>

                        <TableCell className="text-xs">
                          {PLAN_LABEL[u.plano as keyof typeof PLAN_LABEL] ?? u.plano}
                        </TableCell>
                        <TableCell className="text-xs">{u.periodicidade ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {u.last_payment_method ? (
                            <Badge variant="outline" className="text-[10px]">
                              {u.last_payment_method === "pix" ? "Pix" : "Cartão"}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[ds]}`}>
                            {STATUS_LABEL[ds]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {fmtMoney(u.total_paid_cents)}
                        </TableCell>
                        <TableCell className="text-xs">{fmtDate(u.next_payment_at)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Editar status do plano"
                              onClick={() => setEditStatus(u)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                              disabled={protectedRow}
                              title={
                                protectedRow
                                  ? "Não é permitido excluir este usuário"
                                  : "Excluir usuário"
                              }
                              onClick={() => setToDelete(u)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center text-sm text-muted-foreground py-6"
                      >
                        Nenhum usuário encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Diagnóstico de Pagamento (Mercado Pago) */}
        <MpDiagnosticSection />

        {/* Detalhes */}

        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalhes do usuário</DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Nome</p>
                    <p className="font-medium">{selected.nome ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">E-mail</p>
                    <p className="font-medium break-all">{selected.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Telefone</p>
                    <p className="font-medium">{selected.telefone ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="font-medium">{selected.tipo_cadastro ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cadastro</p>
                    <p className="font-medium" title={adminDateTimeTooltip(selected.created_at)}>
                      {fmtDateTime(selected.created_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Plano</p>
                    <p className="font-medium">
                      {PLAN_LABEL[selected.plano as keyof typeof PLAN_LABEL] ?? selected.plano}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status do plano</p>
                    {(() => {
                      const ds = getDisplayStatus(selected);
                      return (
                        <Badge variant="outline" className={STATUS_COLORS[ds]}>
                          {STATUS_LABEL[ds]}
                        </Badge>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ciclo</p>
                    <p className="font-medium">{selected.periodicidade ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Início</p>
                    <p className="font-medium">{fmtDate(selected.current_period_start)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vencimento</p>
                    <p className="font-medium">{fmtDate(selected.current_period_end)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total pago</p>
                    <p className="font-medium">{fmtMoney(selected.total_paid_cents)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pagamentos</p>
                    <p className="font-medium">{selected.payments_count}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2">Histórico de pagamentos</p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Plano</TableHead>
                          <TableHead>Forma</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentsList
                          .filter((p) => p.user_id === selected.user_id)
                          .map((p) => (
                            <TableRow key={p.id}>
                              <TableCell className="text-xs">
                                {fmtDate(p.paid_at ?? p.created_at)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {PLAN_LABEL[p.plano as keyof typeof PLAN_LABEL] ?? p.plano}
                              </TableCell>
                              <TableCell className="text-xs">
                                {p.method === "pix"
                                  ? "Pix"
                                  : p.method === "card"
                                    ? "Cartão"
                                    : p.method}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${PAY_STATUS_COLORS[p.status] ?? ""}`}
                                >
                                  {p.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {fmtMoney(p.amount_cents)}
                              </TableCell>
                            </TableRow>
                          ))}
                        {paymentsList.filter((p) => p.user_id === selected.user_id).length ===
                          0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center text-xs text-muted-foreground py-3"
                            >
                              Sem pagamentos.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                {(user?.email ?? "").toLowerCase() === "felipe.out.silva@outlook.com" && (
                  <ManualGrantSection
                    target={selected}
                    onDone={() => {
                      setSelected(null);
                      setReloadKey((k) => k + 1);
                    }}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <EditStatusDialog
          target={editStatus}
          onClose={() => setEditStatus(null)}
          onDone={() => {
            setEditStatus(null);
            setReloadKey((k) => k + 1);
          }}
        />

        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>Você está prestes a excluir permanentemente:</p>
                  <div className="rounded-md border p-3 bg-muted/30">
                    <p className="font-medium text-foreground">{toDelete?.nome ?? "—"}</p>
                    <p className="text-xs text-muted-foreground break-all">{toDelete?.email}</p>
                  </div>
                  <p className="text-destructive font-medium">
                    Esta ação é irreversível e removerá todos os dados vinculados (perfil, planos,
                    pagamentos e histórico).
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void confirmDelete();
                }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Excluindo…" : "Excluir definitivamente"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MobileShell>
  );
}

function ManualGrantSection({ target, onDone }: { target: AdminUserRow; onDone: () => void }) {
  const [plano, setPlano] = useState<string>("pessoal_premium");
  const [periodicidade, setPeriodicidade] = useState<string>("mensal");
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [obs, setObs] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await grantPlanManually({
        data: {
          targetUserId: target.user_id,
          plano: plano as "pessoal_premium" | "mei_essencial" | "mei_inteligente" | "empresa",
          periodicidade: periodicidade as "mensal" | "trimestral" | "semestral" | "anual",
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          amountCents: amount ? Math.round(Number(amount.replace(",", ".")) * 100) : undefined,
          observacao: obs || undefined,
        },
      });
      toast.success("Plano concedido manualmente.");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao conceder plano");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border/60 p-3 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-2">
        <Crown className="h-3.5 w-3.5 text-amber-500" /> Conceder plano manualmente (Admin Master)
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Plano</p>
          <Select value={plano} onValueChange={setPlano}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pessoal_premium">Controle Completo Pessoal</SelectItem>
              <SelectItem value="mei_essencial">Essencial para MEI</SelectItem>
              <SelectItem value="mei_inteligente">MEI Completo</SelectItem>
              <SelectItem value="empresa">Empresa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Ciclo</p>
          <Select value={periodicidade} onValueChange={setPeriodicidade}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mensal">Mensal</SelectItem>
              <SelectItem value="trimestral">Trimestral</SelectItem>
              <SelectItem value="semestral">Semestral</SelectItem>
              <SelectItem value="anual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Início</p>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Vencimento (opcional)</p>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Valor R$ (opcional)</p>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="h-8 text-xs"
          />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Observação</p>
          <Input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Motivo da concessão"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Salvando..." : "Conceder plano"}
        </Button>
      </div>
    </div>
  );
}

const EDIT_STATUS_OPTIONS: {
  value: "ativo" | "aguardando_pagamento" | "cancelado" | "expirado" | "sem_assinatura";
  label: string;
}[] = [
  { value: "sem_assinatura", label: "Sem assinatura / Conta criada" },
  { value: "aguardando_pagamento", label: "Aguardando pagamento" },
  { value: "ativo", label: "Plano ativo" },
  { value: "cancelado", label: "Cancelado" },
  { value: "expirado", label: "Expirado / Vencido" },
];

function EditStatusDialog({
  target,
  onClose,
  onDone,
}: {
  target: AdminUserRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<string>("sem_assinatura");
  const [forceActivate, setForceActivate] = useState(false);
  const [clearPlan, setClearPlan] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      const s = target.status;
      const valid = EDIT_STATUS_OPTIONS.some((o) => o.value === s);
      setStatus(valid ? s : "sem_assinatura");
      setForceActivate(false);
      setClearPlan(false);
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    setSaving(true);
    try {
      await setUserStatusManually({
        data: {
          targetUserId: target.user_id,
          status: status as
            | "ativo"
            | "aguardando_pagamento"
            | "cancelado"
            | "expirado"
            | "sem_assinatura",
          forceActivate,
          clearPlan,
        },
      });
      toast.success("Status atualizado.");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar status do usuário</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 bg-muted/30">
              <p className="font-medium">{target.nome ?? "—"}</p>
              <p className="text-xs text-muted-foreground break-all">{target.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Novo status</p>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {status === "ativo" && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={forceActivate}
                  onChange={(e) => setForceActivate(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Confirmar pagamento manualmente (ativar mesmo sem pagamento aprovado registrado).
                </span>
              </label>
            )}
            {(status === "sem_assinatura" || status === "cancelado" || status === "expirado") && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={clearPlan}
                  onChange={(e) => setClearPlan(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Limpar plano vinculado e remover assinatura antiga.</span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? "Salvando..." : "Salvar status"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============ Diagnóstico de Pagamento (Mercado Pago) ============

type DiagnosisData = {
  mercado_pago_status: string;
  mp_raw_status: string | null;
  local_payment_status: string | null;
  local_subscription_status: string | null;
  user_id: string | null;
  user_email: string | null;
  plan: string | null;
  amount: number | null;
  external_payment_id: string;
  inconsistencies: string[];
  recommended_action: string;
};

type PaymentEventRow = {
  id: string;
  created_at: string;
  provider: string;
  external_payment_id: string;
  status: string;
  raw_status: string | null;
  event_type: string | null;
  user_id: string | null;
  user_email: string | null;
};

function MpStatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  let cls = "bg-muted text-muted-foreground border-border";
  if (s === "approved" || s === "paid" || s === "authorized")
    cls = "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  else if (
    s === "rejected" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "refunded" ||
    s === "charged_back"
  )
    cls = "bg-red-500/15 text-red-600 border-red-500/30";
  else if (s === "pending" || s === "in_process" || s === "in_mediation")
    cls = "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return (
    <Badge variant="outline" className={cls}>
      {status || "—"}
    </Badge>
  );
}

function MpDiagnosticSection() {
  const [paymentId, setPaymentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [confirmRec, setConfirmRec] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisData | null>(null);
  const [resultMsg, setResultMsg] = useState<{
    kind: "success" | "info" | "error";
    text: string;
  } | null>(null);
  const [events, setEvents] = useState<PaymentEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function loadEvents() {
    setEventsLoading(true);
    try {
      const r = await listRecentPaymentEvents({ data: { limit: 20 } });
      setEvents(r.events as PaymentEventRow[]);
    } catch (e: any) {
      // silencioso — não bloqueia diagnóstico
      console.error(e);
    } finally {
      setEventsLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  async function runDiagnose() {
    const id = paymentId.trim();
    if (!id) {
      toast.error("Informe o ID do pagamento");
      return;
    }
    setLoading(true);
    setResultMsg(null);
    setConfirmRec(false);
    try {
      const r = await diagnoseMpPayment({ data: { paymentId: id } });
      setDiagnosis(r.diagnosis as DiagnosisData);
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao diagnosticar";
      setDiagnosis(null);
      if (msg.toLowerCase().includes("admin") || msg.toLowerCase().includes("permission")) {
        toast.error("Sem permissão para esta ação");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function runReconcile() {
    const id = paymentId.trim();
    if (!id) return;
    setReconciling(true);
    setResultMsg(null);
    try {
      const r = await reconcileMpPaymentById({ data: { paymentId: id } });
      setDiagnosis(r.diagnosis as DiagnosisData);
      let kind: "success" | "info" | "error" = "info";
      let text = r.message;
      if (r.message === "reconciled" && r.applied) {
        kind = "success";
        text = "Pagamento reconciliado e assinatura ativada.";
      } else if (r.message === "already_consistent") {
        kind = "info";
        text = "Nada a fazer — pagamento e assinatura já estão consistentes.";
      } else if (r.message === "payment_not_found") {
        kind = "error";
        text = "Pagamento não encontrado no Mercado Pago.";
      } else if (r.message?.startsWith("mp_status_is_")) {
        kind = "info";
        text = `Pagamento não aprovado (status: ${r.message.replace("mp_status_is_", "")}).`;
      }
      setResultMsg({ kind, text });
      setConfirmRec(false);
      void loadEvents();
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao reconciliar";
      if (msg.toLowerCase().includes("admin") || msg.toLowerCase().includes("permission")) {
        setResultMsg({ kind: "error", text: "Sem permissão para esta ação." });
      } else {
        setResultMsg({ kind: "error", text: msg });
      }
    } finally {
      setReconciling(false);
    }
  }

  const recColor = diagnosis?.inconsistencies?.length
    ? "border-amber-500/40 bg-amber-500/5"
    : diagnosis?.mercado_pago_status === "approved"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : diagnosis?.mercado_pago_status &&
          ["rejected", "cancelled", "refunded", "charged_back"].includes(
            diagnosis.mercado_pago_status,
          )
        ? "border-red-500/40 bg-red-500/5"
        : "border-border";

  return (
    <Card className="mt-4 sm:mt-6">
      <CardHeader className="p-3 sm:p-6 sm:pb-2">
        <CardTitle className="text-sm">Diagnóstico de Pagamento (Mercado Pago)</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6 sm:pt-3 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Digite o ID do pagamento do Mercado Pago"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            className="flex-1"
            inputMode="numeric"
          />
          <div className="flex gap-2">
            <Button onClick={() => void runDiagnose()} disabled={loading || reconciling}>
              {loading ? "Diagnosticando…" : "Diagnosticar pagamento"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmRec(true)}
              disabled={loading || reconciling || !paymentId.trim()}
            >
              Reconciliar pagamento
            </Button>
          </div>
        </div>

        {confirmRec && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Tem certeza que deseja reconciliar este pagamento?</p>
            <p className="text-xs text-muted-foreground mt-1">
              Se o Mercado Pago indicar pagamento aprovado, a assinatura será ativada.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={() => void runReconcile()} disabled={reconciling}>
                {reconciling ? "Reconciliando…" : "Confirmar reconciliação"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRec(false)}
                disabled={reconciling}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {resultMsg && (
          <div
            className={`rounded-md border p-3 text-sm ${
              resultMsg.kind === "success"
                ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : resultMsg.kind === "error"
                  ? "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400"
                  : "border-border bg-muted/30"
            }`}
          >
            {resultMsg.text}
          </div>
        )}

        {diagnosis && (
          <div className={`rounded-md border p-3 sm:p-4 space-y-3 ${recColor}`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Status no Mercado Pago</p>
                <div className="mt-1">
                  <MpStatusBadge status={diagnosis.mercado_pago_status} />
                </div>
                {diagnosis.mp_raw_status &&
                  diagnosis.mp_raw_status !== diagnosis.mercado_pago_status && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      raw: {diagnosis.mp_raw_status}
                    </p>
                  )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status local (pagamento)</p>
                <div className="mt-1">
                  <MpStatusBadge status={diagnosis.local_payment_status ?? "—"} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status local (assinatura)</p>
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className={
                      diagnosis.local_subscription_status === "ativo"
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {diagnosis.local_subscription_status ?? "—"}
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">E-mail do usuário</p>
                <p className="font-medium text-xs break-all">{diagnosis.user_email ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Plano</p>
                <p className="font-medium text-xs">
                  {diagnosis.plan
                    ? (PLAN_LABEL[diagnosis.plan as keyof typeof PLAN_LABEL] ?? diagnosis.plan)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valor</p>
                <p className="font-medium text-xs">
                  {diagnosis.amount != null
                    ? `R$ ${diagnosis.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                    : "—"}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-muted-foreground">ID do pagamento</p>
                <p className="font-mono text-xs break-all">{diagnosis.external_payment_id}</p>
              </div>
            </div>

            {diagnosis.inconsistencies.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
                  Inconsistências encontradas:
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-700 dark:text-amber-400">
                  {diagnosis.inconsistencies.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs">
              <span className="text-muted-foreground">Ação recomendada: </span>
              <span className="font-semibold">{diagnosis.recommended_action}</span>
            </div>
          </div>
        )}

        {/* Últimos eventos de pagamento */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold">Últimos eventos de pagamento</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadEvents()}
              disabled={eventsLoading}
            >
              {eventsLoading ? "Atualizando…" : "Atualizar"}
            </Button>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Evento</TableHead>
                  <TableHead className="text-xs">Usuário</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(ev.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-xs font-mono break-all max-w-[120px] truncate">
                      {ev.external_payment_id}
                    </TableCell>
                    <TableCell>
                      <MpStatusBadge status={ev.status} />
                    </TableCell>
                    <TableCell className="text-xs">{ev.event_type ?? "—"}</TableCell>
                    <TableCell className="text-xs break-all">
                      {ev.user_email ?? ev.user_id ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && !eventsLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-xs text-muted-foreground py-3"
                    >
                      Nenhum evento registrado ainda.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
