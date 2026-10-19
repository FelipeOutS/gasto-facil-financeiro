import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Landmark, RefreshCw, Link2, Unplug, AlertTriangle, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/app_/integracoes/open-finance")({
  head: () => ({
    meta: [
      { title: "Open Finance — Gasto Inteligente" },
      { name: "description", content: "Conecte instituições financeiras ao Gasto Inteligente via Pluggy (ambiente de testes)." },
      { property: "og:title", content: "Open Finance — Gasto Inteligente" },
      { property: "og:description", content: "Conexão bancária via Pluggy em ambiente de testes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <OpenFinancePage />
    </AdminMasterGate>
  ),
});

type Status = {
  configured: boolean;
  webhookConfigured: boolean;
  mode: string;
  schemaReady: boolean;
  settings: { auto_import: boolean; auto_categorize: boolean; history_days: number; access_state: string } | null;
  items: Array<{ item_id: string; connector_name: string; is_sandbox: boolean; status: string; last_error: string | null; last_synced_at: string | null }>;
  accounts: Array<{ account_id: string; item_id: string; type: string; name: string; number_last4: string | null; balance: number; credit_limit: number | null; available_credit: number | null }>;
  transactions: Array<{ transaction_id: string; description: string | null; amount: number; date: string; type: string; classification: string; classification_reason: string; categoria_sugerida: string | null; categoria_manual: string | null; review_status: string | null }>;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function OpenFinancePage() {
  const [s, setS] = useState<Status | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/integrations/pluggy/status");
    if (r.status === 403) return setBlocked("Open Finance é restrito às contas autorizadas.");
    if (!r.ok) return setBlocked("Não foi possível carregar o Open Finance agora.");
    setS(await r.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: string, body: unknown) {
    const r = await apiFetch(`/api/integrations/pluggy/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error ?? `http_${r.status}`);
    return j;
  }

  async function connect(updateItem?: string) {
    setBusy(true);
    try {
      const t = await post("connect-token", updateItem ? { itemId: updateItem } : {});
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const widget = new PluggyConnect({
        connectToken: t.accessToken,
        includeSandbox: true,
        connectorIds: t.connectorIds,
        updateItem,
        language: "pt",
        onSuccess: async ({ item }) => {
          try {
            await post("register-item", { itemId: item.id });
            toast.success("Banco de teste conectado e sincronizado.");
          } catch (e) {
            toast.error(`Falha ao registrar: ${(e as Error).message}`);
          }
          void load();
        },
        onError: () => {
          toast.error("A conexão não foi concluída.");
        },
      });
      await widget.init();
    } catch (e) {
      toast.error(`Não foi possível abrir a conexão: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      await post(action, body);
      toast.success(ok);
    } catch (e) {
      const m = (e as Error).message;
      toast.error(
        m.startsWith("sync_parcial:")
          ? "Contas e saldos atualizados, mas as transações falharam. Tente sincronizar novamente."
          : m,
      );
    } finally {
      setBusy(false);
      void load();
    }
  }

  if (blocked) {
    return (
      <MobileShell>
        <p className="py-16 text-center text-sm text-muted-foreground">{blocked}</p>
      </MobileShell>
    );
  }
  if (!s) {
    return (
      <MobileShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      </MobileShell>
    );
  }

  const paused = s.settings?.access_state === "pausado_acesso";
  const settings = s.settings ?? { auto_import: false, auto_categorize: true, history_days: 90, access_state: "ok" };
  const gastos = s.transactions.filter((t) => t.classification === "gasto");
  const receitas = s.transactions.filter((t) => t.classification === "receita");
  const revisao = s.transactions.filter((t) => t.classification === "revisao" && !t.review_status);

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <button type="button" onClick={() => window.history.back()} aria-label="Voltar" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Integrações</p>
          <h1 className="text-2xl font-bold tracking-tight">Open Finance</h1>
        </div>
      </header>

      <section className="mt-5 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-foreground">
          Ambiente de testes: somente bancos fictícios da Pluggy. Nada é lançado em Gastos ou Receitas nesta etapa.
        </p>
      </section>

      {(!s.configured || !s.webhookConfigured || !s.schemaReady || paused) && (
        <section className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="text-xs leading-relaxed text-foreground">
            {!s.configured && <p>Credenciais da Pluggy ainda não cadastradas.</p>}
            {!s.webhookConfigured && <p>Aviso automático da Pluggy ainda não configurado.</p>}
            {!s.schemaReady && <p>Estrutura de dados do Open Finance ainda não criada (aguarda sua aprovação).</p>}
            {paused && (
              <>
                <p>Sincronização pausada: a Pluggy recusou o acesso (por exemplo, fim do período de teste). Seus dados importados continuam aqui.</p>
                <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => act("resume", {}, "Vamos tentar de novo na próxima sincronização.")}>
                  Tentar retomar
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      <Button className="mt-5 w-full" disabled={busy || !s.configured || !s.schemaReady || paused} onClick={() => connect()}>
        <Link2 className="mr-2 h-4 w-4" /> Conectar banco de teste
      </Button>

      <Section title="Instituições conectadas">
        {s.items.length === 0 && <Empty>Nenhuma instituição conectada.</Empty>}
        {s.items.map((it) => (
          <div key={it.item_id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{it.connector_name}{it.is_sandbox ? " · teste" : ""}</p>
                <p className="text-[11px] text-muted-foreground">
                  {it.status}{it.last_error ? ` · ${it.last_error}` : ""} · última sincronização {it.last_synced_at ? new Date(it.last_synced_at).toLocaleString("pt-BR") : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy || paused} onClick={() => act("sync", { itemId: it.item_id }, "Sincronizado.")}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sincronizar
              </Button>
              {it.status !== "UPDATED" && (
                <Button size="sm" variant="outline" disabled={busy || paused} onClick={() => connect(it.item_id)}>Reconectar</Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm("Desconectar esta instituição? Os dados já importados ficam guardados.") && act("disconnect", { itemId: it.item_id }, "Instituição desconectada.")}>
                <Unplug className="mr-1 h-3.5 w-3.5" /> Desconectar
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Contas e cartões">
        {s.accounts.length === 0 && <Empty>Nenhuma conta ainda.</Empty>}
        {s.accounts.map((a) => (
          <div key={a.account_id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{a.name}{a.number_last4 ? ` ••${a.number_last4}` : ""}</p>
              <p className="text-[11px] text-muted-foreground">{a.type === "CREDIT" ? "Cartão de crédito" : "Conta"}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{brl(Number(a.balance))}</p>
              {a.type === "CREDIT" && a.available_credit != null && (
                <p className="text-[11px] text-muted-foreground">disponível {brl(Number(a.available_credit))}</p>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Configurações">
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <Row label="Importar automaticamente para Gastos e Receitas" hint="Travado nesta etapa de testes.">
            <Switch checked={false} disabled />
          </Row>
          <Row label="Categorização automática">
            <Switch checked={settings.auto_categorize} disabled={busy || !s.schemaReady} onCheckedChange={(v) => act("settings", { autoImport: false, autoCategorize: v, historyDays: settings.history_days }, "Salvo.")} />
          </Row>
          <Row label="Histórico inicial">
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-sm" value={settings.history_days} disabled={busy || !s.schemaReady} onChange={(e) => act("settings", { autoImport: false, autoCategorize: settings.auto_categorize, historyDays: Number(e.target.value) }, "Salvo.")}>
              {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
          </Row>
        </div>
      </Section>

      <Section title={`Para revisar (${revisao.length})`}>
        {revisao.length === 0 && <Empty>Nada para revisar.</Empty>}
        {revisao.map((t) => (
          <div key={t.transaction_id} className="rounded-2xl border border-border bg-card p-4">
            <TxLine t={t} />
            <p className="mt-1 text-[11px] text-muted-foreground">Motivo: {t.classification_reason.replace(/_/g, " ")}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act("review", { transactionId: t.transaction_id, decisao: "aprovado" }, "Marcada como válida.")}>É válida</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("review", { transactionId: t.transaction_id, decisao: "rejeitado" }, "Marcada como duplicada.")}>É duplicada</Button>
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Gastos de teste (${gastos.length})`}>
        {gastos.slice(0, 50).map((t) => <TxCard key={t.transaction_id} t={t} onCat={(c) => act("categoria", { transactionId: t.transaction_id, categoria: c }, "Categoria corrigida.")} />)}
        {gastos.length === 0 && <Empty>Nenhum gasto de teste.</Empty>}
      </Section>
      <Section title={`Receitas de teste (${receitas.length})`}>
        {receitas.slice(0, 50).map((t) => <TxCard key={t.transaction_id} t={t} onCat={(c) => act("categoria", { transactionId: t.transaction_id, categoria: c }, "Categoria corrigida.")} />)}
        {receitas.length === 0 && <Empty>Nenhuma receita de teste.</Empty>}
      </Section>
    </MobileShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{children}</p>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p>{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
function TxLine({ t }: { t: Status["transactions"][number] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.description ?? "Sem descrição"}</p>
        <p className="text-[11px] text-muted-foreground">{new Date(t.date + "T12:00:00").toLocaleDateString("pt-BR")}</p>
      </div>
      <p className={`text-sm font-semibold ${t.classification === "receita" ? "text-success" : "text-foreground"}`}>{brl(Number(t.amount))}</p>
    </div>
  );
}
const CATS = ["Alimentação", "Supermercado", "Transporte", "Moradia", "Compras", "Saúde", "Lazer", "Assinaturas", "Salário", "Outros recebimentos", "Outras despesas"];
function TxCard({ t, onCat }: { t: Status["transactions"][number]; onCat: (c: string) => void }) {
  const cat = t.categoria_manual ?? t.categoria_sugerida ?? "";
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <TxLine t={t} />
      <select aria-label="Categoria" className="mt-2 w-full rounded-lg border border-border bg-background px-2 py-1 text-xs" value={cat} onChange={(e) => onCat(e.target.value)}>
        <option value="" disabled>Sem categoria</option>
        {CATS.map((c) => <option key={c} value={c}>{c}{t.categoria_manual === c ? " (manual)" : ""}</option>)}
      </select>
    </div>
  );
}
