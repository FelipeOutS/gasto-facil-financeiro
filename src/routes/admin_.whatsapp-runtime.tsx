import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ArrowLeft,
  RefreshCcw,
  ShieldAlert,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  whatsappAdminReadRuntimeSnapshot,
  whatsappAdminListPlanQuotas,
  whatsappAdminGetUsageSnapshot,
} from "@/lib/whatsapp-runtime-admin.functions";
import {
  whatsappAdminListLocalTemplates,
  whatsappAdminSyncTemplates,
  whatsappAdminSubmitTemplate,
} from "@/lib/whatsapp-templates-admin.functions";

export const Route = createFileRoute("/admin_/whatsapp-runtime")({
  head: () => ({
    meta: [{ title: "Admin — Runtime WhatsApp" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: Page,
});

function Page() {
  return (
    <AdminMasterGate>
      <MobileShell>
        <PanelInner />
      </MobileShell>
    </AdminMasterGate>
  );
}

type Snapshot = Awaited<ReturnType<typeof whatsappAdminReadRuntimeSnapshot>>;
type QuotaList = Awaited<ReturnType<typeof whatsappAdminListPlanQuotas>>;
type Usage = Awaited<ReturnType<typeof whatsappAdminGetUsageSnapshot>>;

function BoolBadge({ v }: { v: boolean }) {
  return (
    <Badge variant={v ? "default" : "secondary"} className={v ? "" : "opacity-70"}>
      {v ? "ATIVO" : "DESATIVADO"}
    </Badge>
  );
}

function PanelInner() {
  const readSnap = useServerFn(whatsappAdminReadRuntimeSnapshot);
  const readQuotas = useServerFn(whatsappAdminListPlanQuotas);
  const readUsage = useServerFn(whatsappAdminGetUsageSnapshot);
  const readTemplates = useServerFn(whatsappAdminListLocalTemplates);
  const syncTemplatesFn = useServerFn(whatsappAdminSyncTemplates);
  const submitTemplateFn = useServerFn(whatsappAdminSubmitTemplate);

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [quotas, setQuotas] = useState<QuotaList | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [templates, setTemplates] = useState<Awaited<
    ReturnType<typeof whatsappAdminListLocalTemplates>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q, u, t] = await Promise.all([
        readSnap(),
        readQuotas(),
        readUsage(),
        readTemplates(),
      ]);
      setSnap(s);
      setQuotas(q);
      setUsage(u);
      setTemplates(t);
    } catch (err) {
      toast.error("Falha ao carregar painel");

      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [readSnap, readQuotas, readUsage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-16 pt-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Admin
        </Link>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" /> Runtime WhatsApp (leitura)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Env flags do servidor <b>prevalecem</b> sobre o runtime do banco. Mesmo com o runtime
            marcado como ativo, nenhuma mensagem é enviada enquanto as envs
            `WHATSAPP_DISPATCH_ENABLED` e `WHATSAPP_OUTBOUND_HTTP_ENABLED` estiverem OFF.
          </p>

          {loading || !snap ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Env</div>
                <div className="mt-2 space-y-1">
                  <Row
                    label="dispatch_enabled"
                    value={<BoolBadge v={snap.env.dispatch_enabled} />}
                  />
                  <Row
                    label="outbound_http_enabled"
                    value={<BoolBadge v={snap.env.outbound_http_enabled} />}
                  />
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Runtime</div>
                <div className="mt-2 space-y-1">
                  <Row
                    label="global_enabled"
                    value={<BoolBadge v={snap.runtime.global_enabled} />}
                  />
                  <Row
                    label="inbound_enabled"
                    value={<BoolBadge v={snap.runtime.inbound_enabled} />}
                  />
                  <Row
                    label="outbound_enabled"
                    value={<BoolBadge v={snap.runtime.outbound_enabled} />}
                  />
                  <Row
                    label="notification_creation"
                    value={<BoolBadge v={snap.runtime.notification_creation_enabled} />}
                  />
                  <Row
                    label="new_links_enabled"
                    value={<BoolBadge v={snap.runtime.new_links_enabled} />}
                  />
                  <Row
                    label="rollout_enabled"
                    value={<BoolBadge v={snap.runtime.rollout_enabled} />}
                  />
                  <Row
                    label="rollout_percentage"
                    value={<span>{snap.runtime.rollout_percentage}%</span>}
                  />
                  <Row
                    label="global_daily_outbound_limit"
                    value={<span>{snap.runtime.global_daily_outbound_limit}</span>}
                  />
                </div>
              </div>
              <div className="rounded border p-3 sm:col-span-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Estado efetivo (env AND runtime)
                </div>
                <div className="mt-2 space-y-1">
                  <Row label="inbound" value={<BoolBadge v={snap.effective.inbound_effective} />} />
                  <Row
                    label="outbound"
                    value={<BoolBadge v={snap.effective.outbound_effective} />}
                  />
                  <Row
                    label="dispatcher"
                    value={<BoolBadge v={snap.effective.dispatcher_effective} />}
                  />
                  <Row
                    label="notification_creation"
                    value={<BoolBadge v={snap.effective.notification_creation_effective} />}
                  />
                  <Row
                    label="new_links"
                    value={<BoolBadge v={snap.effective.new_links_effective} />}
                  />
                  <Row
                    label="rollout_effective_pct"
                    value={<span>{snap.effective.rollout_effective}%</span>}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quotas por plano</CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !quotas ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-right">In/mês</TableHead>
                    <TableHead className="text-right">Out/mês</TableHead>
                    <TableHead className="text-right">Fin/mês</TableHead>
                    <TableHead className="text-right">In/dia</TableHead>
                    <TableHead className="text-right">Out/dia</TableHead>
                    <TableHead className="text-right">/min</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotas.map((q) => (
                    <TableRow key={q.plan_code}>
                      <TableCell className="font-mono text-xs">{q.plan_code}</TableCell>
                      <TableCell className="text-right">{q.inbound_monthly_limit}</TableCell>
                      <TableCell className="text-right">{q.outbound_monthly_limit}</TableCell>
                      <TableCell className="text-right">
                        {q.financial_actions_monthly_limit}
                      </TableCell>
                      <TableCell className="text-right">{q.daily_inbound_limit}</TableCell>
                      <TableCell className="text-right">{q.daily_outbound_limit}</TableCell>
                      <TableCell className="text-right">{q.per_minute_limit}</TableCell>
                      <TableCell>
                        <BoolBadge v={q.enabled} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Uso agregado (ciclo atual)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {loading || !usage ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Usuários com uso" value={usage.users_with_usage} />
              <Metric label="Inbound consumido" value={usage.inbound_used_total} />
              <Metric label="Outbound reservado" value={usage.outbound_reserved_total} />
              <Metric label="Outbound committed" value={usage.outbound_committed_total} />
              <Metric label="Ações financeiras" value={usage.financial_actions_used_total} />
              <Metric label=">80% da quota" value={usage.users_over_80pct} />
              <Metric label="No limite" value={usage.users_at_limit} />
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Nenhuma PII é exibida (sem telefone, nome, email, conteúdo de mensagem). Snapshot gerado
            em {usage?.generated_at ?? "—"}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Templates Meta (Catálogo Local)
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setSyncing(true);
              try {
                const res = await syncTemplatesFn();
                if (res.ok) {
                  toast.success("Sincronização concluída");
                  void refresh();
                } else {
                  toast.error(`Falha: ${res.reason}`);
                }
              } catch (e) {
                toast.error("Erro na sincronização");
              } finally {
                setSyncing(false);
              }
            }}
            disabled={syncing || loading}
            className="h-7 gap-1 px-2 text-xs"
          >
            <RefreshCcw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            Sincronizar Meta
          </Button>
        </CardHeader>
        <CardContent>
          {loading || !templates ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template / Meta Name</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Idioma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Qualidade</TableHead>
                    <TableHead>Sincronizado</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground italic"
                      >
                        Nenhum template encontrado no catálogo local.
                      </TableCell>
                    </TableRow>
                  ) : (
                    templates.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <div className="font-semibold">{t.internal_key}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {t.meta_name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {t.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{t.language}</TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell>
                          {t.quality_score ? (
                            <Badge
                              variant={
                                t.quality_score === "GREEN"
                                  ? "default"
                                  : t.quality_score === "YELLOW"
                                    ? "secondary"
                                    : "destructive"
                              }
                              className="text-[10px]"
                            >
                              {t.quality_score}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {t.last_synced_at
                            ? new Date(t.last_synced_at).toLocaleString("pt-BR")
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-right">
                          {t.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px]"
                              disabled={submittingId === t.id || loading || syncing}
                              onClick={async () => {
                                setSubmittingId(t.id);
                                try {
                                  const res = await submitTemplateFn({
                                    data: { internalKey: t.internal_key, version: t.version },
                                  });
                                  if (res.ok) {
                                    toast.success("Submetido com sucesso");
                                    void refresh();
                                  } else {
                                    toast.error(
                                      `Falha: ${res.reason} ${"detail" in res ? res.detail : ""}`,
                                    );
                                  }
                                } catch (e) {
                                  toast.error("Erro na submissão");
                                } finally {
                                  setSubmittingId(null);
                                }
                              }}
                            >
                              {submittingId === t.id ? (
                                <RefreshCcw className="h-3 w-3 animate-spin" />
                              ) : (
                                "Submeter Meta"
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "approved")
    return (
      <Badge className="bg-green-600 hover:bg-green-700 flex items-center gap-1 w-fit">
        <CheckCircle2 className="h-3 w-3" /> APROVADO
      </Badge>
    );
  if (s === "rejected")
    return (
      <Badge variant="destructive" className="flex items-center gap-1 w-fit">
        <XCircle className="h-3 w-3" /> REJEITADO
      </Badge>
    );
  if (s === "draft")
    return (
      <Badge variant="secondary" className="flex items-center gap-1 w-fit">
        <FileText className="h-3 w-3" /> RASCUNHO
      </Badge>
    );
  if (s === "pending" || s === "submitted")
    return (
      <Badge
        variant="outline"
        className="bg-yellow-50 border-yellow-200 text-yellow-700 flex items-center gap-1 w-fit"
      >
        <RefreshCcw className="h-3 w-3 animate-pulse" /> PENDENTE
      </Badge>
    );
  if (s === "paused")
    return (
      <Badge variant="outline" className="flex items-center gap-1 w-fit">
        <AlertTriangle className="h-3 w-3" /> PAUSADO
      </Badge>
    );
  return <Badge variant="outline">{status.toUpperCase()}</Badge>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
