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
import { ArrowLeft, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  whatsappAdminReadRuntimeSnapshot,
  whatsappAdminListPlanQuotas,
  whatsappAdminGetUsageSnapshot,
} from "@/lib/whatsapp-runtime-admin.functions";

export const Route = createFileRoute("/admin_/whatsapp-runtime")({
  head: () => ({
    meta: [
      { title: "Admin — Runtime WhatsApp" },
      { name: "robots", content: "noindex,nofollow" },
    ],
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

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [quotas, setQuotas] = useState<QuotaList | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q, u] = await Promise.all([readSnap(), readQuotas(), readUsage()]);
      setSnap(s);
      setQuotas(q);
      setUsage(u);
    } catch (err) {
      toast.error("Falha ao carregar painel");
      // eslint-disable-next-line no-console
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
        <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
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
            Env flags do servidor <b>prevalecem</b> sobre o runtime do banco. Mesmo com
            o runtime marcado como ativo, nenhuma mensagem é enviada enquanto as
            envs `WHATSAPP_DISPATCH_ENABLED` e `WHATSAPP_OUTBOUND_HTTP_ENABLED` estiverem OFF.
          </p>

          {loading || !snap ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Env</div>
                <div className="mt-2 space-y-1">
                  <Row label="dispatch_enabled" value={<BoolBadge v={snap.env.dispatch_enabled} />} />
                  <Row label="outbound_http_enabled" value={<BoolBadge v={snap.env.outbound_http_enabled} />} />
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Runtime</div>
                <div className="mt-2 space-y-1">
                  <Row label="global_enabled" value={<BoolBadge v={snap.runtime.global_enabled} />} />
                  <Row label="inbound_enabled" value={<BoolBadge v={snap.runtime.inbound_enabled} />} />
                  <Row label="outbound_enabled" value={<BoolBadge v={snap.runtime.outbound_enabled} />} />
                  <Row label="notification_creation" value={<BoolBadge v={snap.runtime.notification_creation_enabled} />} />
                  <Row label="new_links_enabled" value={<BoolBadge v={snap.runtime.new_links_enabled} />} />
                  <Row label="rollout_enabled" value={<BoolBadge v={snap.runtime.rollout_enabled} />} />
                  <Row label="rollout_percentage" value={<span>{snap.runtime.rollout_percentage}%</span>} />
                  <Row label="global_daily_outbound_limit" value={<span>{snap.runtime.global_daily_outbound_limit}</span>} />
                </div>
              </div>
              <div className="rounded border p-3 sm:col-span-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Estado efetivo (env AND runtime)</div>
                <div className="mt-2 space-y-1">
                  <Row label="inbound" value={<BoolBadge v={snap.effective.inbound_effective} />} />
                  <Row label="outbound" value={<BoolBadge v={snap.effective.outbound_effective} />} />
                  <Row label="dispatcher" value={<BoolBadge v={snap.effective.dispatcher_effective} />} />
                  <Row label="notification_creation" value={<BoolBadge v={snap.effective.notification_creation_effective} />} />
                  <Row label="new_links" value={<BoolBadge v={snap.effective.new_links_effective} />} />
                  <Row label="rollout_effective_pct" value={<span>{snap.effective.rollout_effective}%</span>} />
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
                      <TableCell className="text-right">{q.financial_actions_monthly_limit}</TableCell>
                      <TableCell className="text-right">{q.daily_inbound_limit}</TableCell>
                      <TableCell className="text-right">{q.daily_outbound_limit}</TableCell>
                      <TableCell className="text-right">{q.per_minute_limit}</TableCell>
                      <TableCell><BoolBadge v={q.enabled} /></TableCell>
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
            Nenhuma PII é exibida (sem telefone, nome, email, conteúdo de mensagem).
            Snapshot gerado em {usage?.generated_at ?? "—"}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
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
