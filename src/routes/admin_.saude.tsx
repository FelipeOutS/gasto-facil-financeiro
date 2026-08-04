import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCcw,
  Shield,
  Webhook,
  CreditCard,
  ArrowLeft,
  Copy,
  Database,
  Clock,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  getSystemHealthDashboard,
  getLogRetentionPreview,
  runLogRetentionCleanup,
  type SystemHealthData,
  type LogRetentionPreview,
  type LogRetentionCleanupResult,
} from "@/lib/system-health.functions";
import { PaymentDiagnoseDialog } from "@/components/admin/PaymentDiagnoseDialog";
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
import { Trash2, Loader2 } from "lucide-react";

function fmtMoneyCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function copyText(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copiado"))
    .catch(() => toast.error("Não foi possível copiar"));
}

export const Route = createFileRoute("/admin_/saude")({
  head: () => ({
    meta: [
      { title: "Saúde do sistema — Gasto Inteligente" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <SystemHealthPage />
    </AdminMasterGate>
  ),
});

function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

function StatusBadge({ level }: { level: "ok" | "warn" | "error" }) {
  if (level === "ok") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 border">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Tudo certo
      </Badge>
    );
  }
  if (level === "warn") {
    return (
      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 border">
        <AlertTriangle className="mr-1 h-3 w-3" /> Atenção
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-500/15 text-red-600 border-red-500/30 border">
      <AlertTriangle className="mr-1 h-3 w-3" /> Falhas recentes
    </Badge>
  );
}

function MetricCard({
  title,
  value,
  hint,
  tone = "default",
  icon,
}: {
  title: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "error";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "ok"
      ? "border-emerald-500/30"
      : tone === "warn"
        ? "border-amber-500/30"
        : tone === "error"
          ? "border-red-500/30"
          : "";
  return (
    <Card className={toneCls}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
          <span>{title}</span>
          {icon}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [retention, setRetention] = useState<LogRetentionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [diagPaymentId, setDiagPaymentId] = useState<string | null>(null);
  const [diagPeriodEnd, setDiagPeriodEnd] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupLast, setCleanupLast] = useState<LogRetentionCleanupResult | null>(null);
  const runCleanupFn = useServerFn(runLogRetentionCleanup);

  const openDiagnose = useCallback((paymentId: string, periodEnd?: string | null) => {
    setDiagPaymentId(paymentId);
    setDiagPeriodEnd(periodEnd ?? null);
    setDiagOpen(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await getSystemHealthDashboard()) as SystemHealthData;
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error("Não foi possível carregar a saúde do sistema", { description: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRetention = useCallback(async () => {
    setRetentionLoading(true);
    try {
      const res = (await getLogRetentionPreview()) as LogRetentionPreview;
      setRetention(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error("Não foi possível calcular retenção de logs", { description: msg });
    } finally {
      setRetentionLoading(false);
    }
  }, []);

  const runCleanup = useCallback(async () => {
    setCleanupRunning(true);
    try {
      const res = (await runCleanupFn()) as LogRetentionCleanupResult;
      setCleanupLast(res);
      const totalDeleted = res.results.reduce((a, r) => a + r.deleted, 0);
      const anyFail = res.results.some((r) => !r.success);
      if (anyFail) {
        toast.warning(`Limpeza parcial: ${totalDeleted} registro(s) apagado(s)`, {
          description: "Alguma(s) tabela(s) falharam — veja o resumo.",
        });
      } else {
        toast.success(`Limpeza concluída: ${totalDeleted} registro(s) apagado(s)`);
      }
      // Atualiza prévia e dashboard
      void loadRetention();
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error("Falha ao executar limpeza de logs", { description: msg });
    } finally {
      setCleanupRunning(false);
      setCleanupOpen(false);
    }
  }, [runCleanupFn, loadRetention, load]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MobileShell>
      <div className="space-y-4 pb-12">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              to="/admin"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-muted"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold">Saúde do Sistema</h1>
              <p className="text-xs text-muted-foreground">
                {data ? `Atualizado em ${fmtDateTime(data.generated_at)}` : "Carregando…"}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {/* Status geral */}
        {data ? (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Status geral</div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {data.alerts.messages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <StatusBadge level={data.alerts.level} />
            </CardContent>
          </Card>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}

        {/* Cards de métricas */}
        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : data ? (
          <>
            <h2 className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <Webhook className="h-4 w-4" /> Webhooks (últimas 24h)
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                title="MP recebidos"
                value={data.webhooks_mp_24h.total}
                hint={`${data.webhooks_mp_24h.processed} processados`}
              />
              <MetricCard
                title="MP falhados"
                value={data.webhooks_mp_24h.failed}
                tone={data.webhooks_mp_24h.failed > 0 ? "error" : "ok"}
              />
              <MetricCard
                title="WA recebidos"
                value={data.webhooks_whatsapp_24h.total}
                hint={`${data.webhooks_whatsapp_24h.processed} processados`}
              />
              <MetricCard
                title="WA falhados"
                value={data.webhooks_whatsapp_24h.failed}
                tone={data.webhooks_whatsapp_24h.failed > 0 ? "error" : "ok"}
              />
            </div>

            <h2 className="mt-4 flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4" /> Rate limits (últimas 24h)
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard title="Eventos totais" value={data.rate_limits_24h.total} />
              <MetricCard
                title="Bloqueados"
                value={data.rate_limits_24h.blocked}
                tone={data.rate_limits_24h.blocked > 10 ? "warn" : "ok"}
              />
              <Card className="col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Rotas mais bloqueadas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.rate_limits_24h.top_routes.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nenhum bloqueio.</div>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {data.rate_limits_24h.top_routes.map((r) => (
                        <li key={r.route} className="flex justify-between">
                          <span className="truncate">{r.route}</span>
                          <span className="font-medium">{r.blocked}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <h2 className="mt-4 flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4" /> Pagamentos (últimas 24h)
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard title="Aprovados" value={data.payments.approved_24h} tone="ok" />
              <MetricCard
                title="Pendentes"
                value={data.payments.pending_24h}
                tone={data.payments.pending_24h > 0 ? "warn" : "default"}
              />
              <MetricCard
                title="Rejeitados/Refund"
                value={data.payments.rejected_24h}
                tone={data.payments.rejected_24h > 0 ? "warn" : "default"}
              />
              <MetricCard
                title="Inconsistências"
                value={data.payments.inconsistencies_count}
                tone={data.payments.inconsistencies_count > 0 ? "error" : "ok"}
                hint="Pagamento ↔ plano"
              />
            </div>

            {/* Alerta: pendentes > 30 min */}
            <Card
              className={`mt-4 ${
                data.payments.pending_older_than_30min > 0
                  ? "border-amber-500/40 bg-amber-500/5"
                  : ""
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Pagamentos pendentes há mais de 30 min
                  </span>
                  <Badge variant="outline">{data.payments.pending_older_than_30min}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.pending_payments_to_check.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    Nenhum pagamento pendente antigo
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Criado</TableHead>
                          <TableHead className="text-xs">Em aberto</TableHead>
                          <TableHead className="text-xs">Usuário</TableHead>
                          <TableHead className="text-xs">E-mail</TableHead>
                          <TableHead className="text-xs">MP ID</TableHead>
                          <TableHead className="text-xs">Valor</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Ação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.pending_payments_to_check.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {fmtDateTime(r.created_at)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              <span
                                className={
                                  r.age_minutes > 120
                                    ? "text-red-600 font-medium"
                                    : "text-amber-600"
                                }
                              >
                                {r.age_minutes} min
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">{r.user_id_short ?? "—"}</TableCell>
                            <TableCell className="text-xs">{r.user_email ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {r.provider_payment_id ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {fmtMoneyCents(r.amount_cents)}
                            </TableCell>
                            <TableCell className="text-xs">{r.status}</TableCell>
                            <TableCell className="text-right">
                              {r.provider_payment_id ? (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={() => openDiagnose(r.provider_payment_id!)}
                                  >
                                    <Stethoscope className="mr-1 h-3 w-3" />
                                    Diagnosticar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2"
                                    onClick={() => copyText(r.provider_payment_id!)}
                                    title="Copiar ID"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Inconsistências pagamento ↔ plano */}
            <Card
              className={`mt-4 ${
                data.payment_plan_inconsistencies.length > 0 ? "border-red-500/40 bg-red-500/5" : ""
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Inconsistências pagamento ↔ plano
                  </span>
                  <Badge variant="outline">{data.payment_plan_inconsistencies.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.payment_plan_inconsistencies.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    Nenhuma inconsistência detectada
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Tipo</TableHead>
                          <TableHead className="text-xs">Usuário</TableHead>
                          <TableHead className="text-xs">E-mail</TableHead>
                          <TableHead className="text-xs">MP ID</TableHead>
                          <TableHead className="text-xs">Pgto</TableHead>
                          <TableHead className="text-xs">Plano</TableHead>
                          <TableHead className="text-xs">Fim ciclo</TableHead>
                          <TableHead className="text-xs">Ação</TableHead>
                          <TableHead className="text-xs text-right">Copiar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.payment_plan_inconsistencies.map((r, i) => (
                          <TableRow key={`${r.payment_id}-${i}`}>
                            <TableCell className="text-xs">
                              <Badge
                                variant="outline"
                                className={
                                  r.type === "active_plan_failed_payment"
                                    ? "border-red-500/30 text-red-600"
                                    : r.type === "approved_period_expired"
                                      ? "border-amber-500/30 text-amber-600"
                                      : "border-orange-500/30 text-orange-600"
                                }
                              >
                                {r.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{r.user_id_short ?? "—"}</TableCell>
                            <TableCell className="text-xs">{r.user_email ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {r.provider_payment_id ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">{r.payment_status ?? "—"}</TableCell>
                            <TableCell className="text-xs">{r.plan_status ?? "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {fmtDateTime(r.current_period_end)}
                            </TableCell>
                            <TableCell className="text-xs">{r.recommended_action}</TableCell>
                            <TableCell className="text-right">
                              {r.provider_payment_id ? (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={() =>
                                      openDiagnose(r.provider_payment_id!, r.current_period_end)
                                    }
                                  >
                                    <Stethoscope className="mr-1 h-3 w-3" />
                                    Diagnosticar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2"
                                    onClick={() => copyText(r.provider_payment_id!)}
                                    title="Copiar ID"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Retenção de logs */}
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Retenção de logs
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void loadRetention()}
                      disabled={retentionLoading || cleanupRunning}
                    >
                      {retention ? "Recalcular prévia" : "Calcular prévia"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setCleanupOpen(true)}
                      disabled={cleanupRunning}
                    >
                      {cleanupRunning ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1 h-3 w-3" />
                      )}
                      Executar limpeza
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">
                  Política fixa: webhook_logs 90d, audit_logs 180d, rate_limit_events 30d,
                  payment_events 180d. Usuários, pagamentos, planos, gastos e receitas
                  <strong> nunca</strong> são afetados.
                </p>
                {!retention ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    Clique em "Calcular" para visualizar a prévia.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Tabela</TableHead>
                          <TableHead className="text-xs">Retenção</TableHead>
                          <TableHead className="text-xs">Corte</TableHead>
                          <TableHead className="text-xs text-right">Elegíveis</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {retention.policies.map((p) => (
                          <TableRow key={p.table}>
                            <TableCell className="text-xs font-mono">{p.table}</TableCell>
                            <TableCell className="text-xs">{p.retention_days}d</TableCell>
                            <TableCell className="text-xs">{fmtDateTime(p.cutoff_at)}</TableCell>
                            <TableCell className="text-xs text-right font-medium">
                              {p.eligible_to_delete}
                            </TableCell>
                            <TableCell className="text-xs text-right">{p.total}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {cleanupLast ? (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-2 text-xs">
                    <div className="mb-1 font-semibold">
                      Última limpeza · {fmtDateTime(cleanupLast.executed_at)}
                    </div>
                    <ul className="space-y-0.5">
                      {cleanupLast.results.map((r) => (
                        <li key={r.table} className="flex justify-between">
                          <span className="font-mono">{r.table}</span>
                          <span className={r.success ? "text-emerald-600" : "text-red-600"}>
                            {r.success ? `${r.deleted} apagado(s)` : `falhou: ${r.error ?? "erro"}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-600" />
                    Confirmar limpeza de logs antigos
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação apagará logs antigos conforme a política de retenção (webhook_logs
                    90d, audit_logs 180d, rate_limit_events 30d, payment_events 180d). Ela{" "}
                    <strong>não</strong> apagará usuários, pagamentos, planos, gastos ou receitas.
                    Deseja continuar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={cleanupRunning}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void runCleanup();
                    }}
                    disabled={cleanupRunning}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {cleanupRunning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Confirmar limpeza
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Listas */}
            <SectionTable
              title="Últimos webhooks com falha"
              empty="Nenhum webhook com falha."
              rows={data.recent_failed_webhooks}
              columns={[
                { label: "Data", render: (r) => fmtDateTime(r.created_at) },
                { label: "Provider", render: (r) => r.provider },
                { label: "Evento", render: (r) => r.event_type ?? "—" },
                { label: "External", render: (r) => r.external_id ?? "—" },
                { label: "HTTP", render: (r) => r.http_status ?? "—" },
                { label: "Erro", render: (r) => r.error_message ?? "—" },
                { label: "ms", render: (r) => r.processing_time_ms ?? "—" },
              ]}
            />

            <SectionTable
              title="Últimos bloqueios por rate limit"
              empty="Nenhum bloqueio registrado."
              rows={data.recent_rate_limit_blocks}
              columns={[
                { label: "Data", render: (r) => fmtDateTime(r.created_at) },
                { label: "Rota", render: (r) => r.route },
                { label: "Chave", render: (r) => r.key_masked ?? "—" },
                {
                  label: "Usuário",
                  render: (r) => (r.user_id ? r.user_id.slice(0, 8) + "…" : "—"),
                },
                { label: "IP", render: (r) => r.ip_masked ?? "—" },
                { label: "Método", render: (r) => r.method ?? "—" },
              ]}
            />

            <SectionTable
              title="Últimos eventos de pagamento"
              empty="Nenhum evento recente."
              rows={data.recent_payment_events}
              columns={[
                { label: "Data", render: (r) => fmtDateTime(r.created_at) },
                { label: "External ID", render: (r) => r.external_payment_id },
                { label: "Tipo", render: (r) => r.event_type ?? "—" },
                { label: "Status", render: (r) => r.status },
                { label: "Raw", render: (r) => r.raw_status ?? "—" },
                {
                  label: "Usuário",
                  render: (r) => (r.user_id ? r.user_id.slice(0, 8) + "…" : "—"),
                },
                {
                  label: "Ação",
                  render: (r) =>
                    r.external_payment_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => openDiagnose(r.external_payment_id)}
                      >
                        <Stethoscope className="mr-1 h-3 w-3" />
                        Diagnosticar
                      </Button>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />

            <SectionTable
              title="Últimas ações administrativas"
              empty="Sem registros de auditoria."
              rows={data.recent_audit_logs}
              columns={[
                { label: "Data", render: (r) => fmtDateTime(r.created_at) },
                { label: "Ator", render: (r) => r.actor_email ?? "—" },
                { label: "Ação", render: (r) => r.action },
                { label: "Alvo", render: (r) => r.target_email ?? "—" },
                { label: "Entidade", render: (r) => r.entity_type ?? "—" },
                { label: "ID", render: (r) => r.entity_id ?? "—" },
                {
                  label: "Meta",
                  render: (r) =>
                    r.metadata ? (
                      <span className="text-xs text-muted-foreground">
                        {Object.entries(r.metadata)
                          .map(([k, v]) => `${k}:${String(v).slice(0, 20)}`)
                          .join(", ")}
                      </span>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </>
        ) : null}
      </div>
      <PaymentDiagnoseDialog
        paymentId={diagPaymentId}
        open={diagOpen}
        onOpenChange={(o) => {
          setDiagOpen(o);
          if (!o) {
            setDiagPaymentId(null);
            setDiagPeriodEnd(null);
          }
        }}
        currentPeriodEnd={diagPeriodEnd}
        onReconciled={() => {
          void load();
        }}
      />
    </MobileShell>
  );
}

function SectionTable<T extends { id: string }>({
  title,
  empty,
  rows,
  columns,
}: {
  title: string;
  empty: string;
  rows: T[];
  columns: { label: string; render: (r: T) => React.ReactNode }[];
}) {
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">{empty}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.label} className="whitespace-nowrap text-xs">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {columns.map((c) => (
                      <TableCell key={c.label} className="whitespace-nowrap text-xs">
                        {c.render(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
