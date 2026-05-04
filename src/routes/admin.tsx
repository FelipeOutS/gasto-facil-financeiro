import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { isAdminMasterEmail, PLAN_LABEL } from "@/lib/plans";
import { getAdminDashboard, deleteUserById, type AdminDashboardData, type AdminUserRow } from "@/server/admin.functions";
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
import { Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  component: AdminPage,
});

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

type DisplayStatus = "ativo" | "aguardando" | "cancelado_vencido" | "conta_criada";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  ativo: "Plano ativo",
  aguardando: "Aguardando pagamento",
  cancelado_vencido: "Cancelado/Vencido",
  conta_criada: "Conta criada",
};

const STATUS_COLORS: Record<DisplayStatus, string> = {
  ativo: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  aguardando: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  cancelado_vencido: "bg-red-500/15 text-red-500 border-red-500/30",
  conta_criada: "bg-muted text-muted-foreground border-border",
};

function getDisplayStatus(u: AdminUserRow): DisplayStatus {
  const paid = u.last_payment_status === "approved" || u.last_payment_status === "paid";
  const hasPlan = u.plano && u.plano !== "free";
  if (u.status === "cancelado" || u.status === "vencido" || u.last_payment_status === "rejected" || u.last_payment_status === "expired") {
    return "cancelado_vencido";
  }
  if (u.status === "ativo" && paid && hasPlan) return "ativo";
  if (hasPlan && !paid) return "aguardando";
  if (u.last_payment_status === "pending") return "aguardando";
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
  const [reloadKey, setReloadKey] = useState(0);

  // Guard de acesso
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      void navigate({ to: "/login" });
      return;
    }
    if (!isAdminMasterEmail(user.email)) {
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

  const ADMIN_LOCK_EMAILS = ["felipe.out.silva@outlook.com", "michael@medeiroscenografia.com.br"];
  const isProtectedAdmin = (email: string) => ADMIN_LOCK_EMAILS.includes((email ?? "").toLowerCase());

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
    return usersList.filter((u) => {
      if (q && !(u.email.toLowerCase().includes(q) || (u.nome ?? "").toLowerCase().includes(q))) return false;
      if (filterPlan !== "all" && u.plano !== filterPlan) return false;
      if (filterStatus !== "all" && getDisplayStatus(u) !== filterStatus) return false;
      if (filterMethod !== "all" && u.last_payment_method !== filterMethod) return false;
      if (sd && new Date(u.created_at) < sd) return false;
      return true;
    });
  }, [usersList, search, filterPlan, filterStatus, filterMethod, filterPeriod]);
      if (filterMethod !== "all" && u.last_payment_method !== filterMethod) return false;
      if (sd && new Date(u.created_at) < sd) return false;
      return true;
    });
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
    return [...map.entries()].sort().slice(-12).map(([k, v]) => ({ mes: k, valor: v / 100 }));
  }, [paymentsList]);

  const usersByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usersList) {
      const dt = new Date(u.created_at);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort().slice(-12).map(([k, v]) => ({ mes: k, total: v }));
  }, [usersList]);

  const planMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paymentsList) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      map.set(p.plano, (map.get(p.plano) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, v]) => ({ name: PLAN_LABEL[k as keyof typeof PLAN_LABEL] ?? k, value: v }));
  }, [paymentsList]);

  const methodMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paymentsList) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      map.set(p.method, (map.get(p.method) ?? 0) + 1);
    }
    return [...map.entries()].map(([k, v]) => ({ name: k === "pix" ? "Pix" : k === "card" ? "Cartão" : k, value: v }));
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
      cadastro: fmtDate(u.created_at),
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
      ...rows.map((r) => headers.map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(";")),
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
          <Button className="mt-4" onClick={() => navigate({ to: "/" })}>
            Voltar ao Dashboard
          </Button>
        </div>
      </MobileShell>
    );
  }

  if (authorized !== true || loading) {
    return (
      <MobileShell wide>
        <div className="py-10 text-center text-sm text-muted-foreground">Carregando dados administrativos…</div>
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
  const cards = [
    { label: "Total cadastrados", value: t.totalUsers, icon: Users, color: "text-blue-500" },
    { label: "Plano ativo", value: t.activeUsers, icon: CheckCircle2, color: "text-emerald-500" },
    { label: "Sem plano", value: t.noPlanUsers, icon: XCircle, color: "text-muted-foreground" },
    { label: "Cancelados/vencidos", value: t.cancelledOrExpiredUsers, icon: Ban, color: "text-orange-500" },
    { label: "Receita total", value: fmtMoney(t.revenueAllCents), icon: DollarSign, color: "text-emerald-500" },
    { label: "Receita do mês", value: fmtMoney(t.revenueMonthCents), icon: TrendingUp, color: "text-emerald-500" },
    { label: "Recorrente (MRR)", value: fmtMoney(t.mrrCents), icon: Repeat, color: "text-violet-500" },
    { label: "Plano mais vendido", value: t.topPlan ? (PLAN_LABEL[t.topPlan as keyof typeof PLAN_LABEL] ?? t.topPlan) : "—", icon: Crown, color: "text-amber-500" },
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
      <div className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Painel Admin</h1>
            <p className="text-sm text-muted-foreground">Visão geral de usuários, planos e arrecadação.</p>
          </div>
          <Button variant="outline" onClick={exportCsv} className="gap-2">
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>

        {err && (
          <Card className="mt-4 border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">
              Não foi possível carregar todos os dados administrativos: {err}
            </CardContent>
          </Card>
        )}

        {/* Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`grid h-10 w-10 place-items-center rounded-xl bg-muted ${c.color}`}>
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold leading-tight truncate">{c.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Receita por mês</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip
                    formatter={(v: any) => `R$ ${Number(v).toLocaleString("pt-BR")}`}
                    contentStyle={tooltipStyle.contentStyle}
                    labelStyle={tooltipStyle.labelStyle}
                    itemStyle={tooltipStyle.itemStyle}
                    cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                  />
                  <Line type="monotone" dataKey="valor" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, stroke: "hsl(var(--background))", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Novos usuários por mês</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usersByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" fontSize={11} />
                  <YAxis fontSize={11} />
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
            <CardHeader><CardTitle className="text-sm">Planos vendidos</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={planMix} dataKey="value" nameKey="name" outerRadius={80} label>
                    {planMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle.contentStyle} labelStyle={tooltipStyle.labelStyle} itemStyle={tooltipStyle.itemStyle} /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Pix vs Cartão / Status</CardTitle></CardHeader>
            <CardContent className="h-64 grid grid-cols-2 gap-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={methodMix} dataKey="value" nameKey="name" outerRadius={60} label>
                    {methodMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle.contentStyle} labelStyle={tooltipStyle.labelStyle} itemStyle={tooltipStyle.itemStyle} /><Legend />
                </PieChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusMix} dataKey="value" nameKey="name" outerRadius={60} label>
                    {statusMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle.contentStyle} labelStyle={tooltipStyle.labelStyle} itemStyle={tooltipStyle.itemStyle} /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="mt-6">
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filterPlan} onValueChange={setFilterPlan}>
              <SelectTrigger><SelectValue placeholder="Plano" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {Object.entries(PLAN_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="ativo">Plano ativo</SelectItem>
                <SelectItem value="aguardando">Aguardando pagamento</SelectItem>
                <SelectItem value="cancelado_vencido">Cancelado/Vencido</SelectItem>
                <SelectItem value="conta_criada">Conta criada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger><SelectValue placeholder="Pagamento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas formas</SelectItem>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPeriod} onValueChange={setFilterPeriod}>
              <SelectTrigger><SelectValue placeholder="Período" /></SelectTrigger>
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

        {/* Tabela */}
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Usuários ({filteredUsers.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => (
                  <TableRow key={u.user_id} className="cursor-pointer" onClick={() => setSelected(u)}>
                    <TableCell className="font-medium">{u.nome ?? "—"}</TableCell>
                    <TableCell className="text-xs">{u.email}</TableCell>
                    <TableCell className="text-xs">{fmtDate(u.created_at)}</TableCell>
                    <TableCell className="text-xs">{PLAN_LABEL[u.plano as keyof typeof PLAN_LABEL] ?? u.plano}</TableCell>
                    <TableCell className="text-xs">{u.periodicidade ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {u.last_payment_method ? (
                        <Badge variant="outline" className="text-[10px]">{u.last_payment_method === "pix" ? "Pix" : "Cartão"}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[u.status] ?? ""}`}>{u.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{fmtMoney(u.total_paid_cents)}</TableCell>
                    <TableCell className="text-xs">{fmtDate(u.next_payment_at)}</TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">Nenhum usuário encontrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Detalhes */}
        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Detalhes do usuário</DialogTitle></DialogHeader>
            {selected && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">Nome</p><p className="font-medium">{selected.nome ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">E-mail</p><p className="font-medium break-all">{selected.email}</p></div>
                  <div><p className="text-xs text-muted-foreground">Telefone</p><p className="font-medium">{selected.telefone ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Tipo</p><p className="font-medium">{selected.tipo_cadastro ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Cadastro</p><p className="font-medium">{fmtDate(selected.created_at)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Plano</p><p className="font-medium">{PLAN_LABEL[selected.plano as keyof typeof PLAN_LABEL] ?? selected.plano}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status do plano</p>
                    <Badge variant="outline" className={STATUS_COLORS[selected.status] ?? ""}>{selected.status}</Badge>
                  </div>
                  <div><p className="text-xs text-muted-foreground">Ciclo</p><p className="font-medium">{selected.periodicidade ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Início</p><p className="font-medium">{fmtDate(selected.current_period_start)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Vencimento</p><p className="font-medium">{fmtDate(selected.current_period_end)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Total pago</p><p className="font-medium">{fmtMoney(selected.total_paid_cents)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Pagamentos</p><p className="font-medium">{selected.payments_count}</p></div>
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
                        {paymentsList.filter((p) => p.user_id === selected.user_id).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs">{fmtDate(p.paid_at ?? p.created_at)}</TableCell>
                            <TableCell className="text-xs">{PLAN_LABEL[p.plano as keyof typeof PLAN_LABEL] ?? p.plano}</TableCell>
                            <TableCell className="text-xs">{p.method === "pix" ? "Pix" : p.method === "card" ? "Cartão" : p.method}</TableCell>
                            <TableCell><Badge variant="outline" className={`text-[10px] ${PAY_STATUS_COLORS[p.status] ?? ""}`}>{p.status}</Badge></TableCell>
                            <TableCell className="text-right text-xs">{fmtMoney(p.amount_cents)}</TableCell>
                          </TableRow>
                        ))}
                        {paymentsList.filter((p) => p.user_id === selected.user_id).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-3">Sem pagamentos.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MobileShell>
  );
}
