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
} from "lucide-react";
import { toast } from "sonner";
import {
  getSystemHealthDashboard,
  getLogRetentionPreview,
  type SystemHealthData,
  type LogRetentionPreview,
} from "@/server/system-health.functions";

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
  const [loading, setLoading] = useState(true);

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
              <MetricCard
                title="Aprovados"
                value={data.payments.approved_24h}
                tone="ok"
              />
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
                hint="Aprovados sem plano ativo"
              />
            </div>

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
                { label: "Usuário", render: (r) => r.user_id ? r.user_id.slice(0, 8) + "…" : "—" },
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
                { label: "Usuário", render: (r) => r.user_id ? r.user_id.slice(0, 8) + "…" : "—" },
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
