import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Wallet,
  RefreshCw,
  Plug,
  PlugZap,
  Unplug,
  AlertTriangle,
  CheckCircle2,
  Info,
  ListChecks,
  ShieldCheck,
  Loader2,
  Zap,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

type IntegrationSafe = {
  id: string;
  provider: string;
  provider_user_id: string | null;
  status: "connected" | "disconnected" | "error" | "pending";
  last_sync_at: string | null;
  last_error: string | null;
  expires_at: string | null;
};

type StatusResponse = {
  configured: boolean;
  integration: IntegrationSafe | null;
  importedCount: number;
};

type SyncResponse =
  | {
      ok: true;
      summary: {
        imported: number;
        updated: number;
        ignored: number;
        errors: number;
        fetched: number;
        failedMonths?: Array<{ month: string; message: string }>;
      };
    }
  | { ok: false; error: string; message?: string };

type Search = { connected?: string; error?: string };

export const Route = createFileRoute("/app_/integracoes/mercado-pago/")({
  head: () => ({
    meta: [
      { title: "Mercado Pago — Integrações — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Conecte e sincronize sua conta Mercado Pago com o Gasto Inteligente para importar pagamentos, Pix e taxas.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    connected: typeof s.connected === "string" ? s.connected : undefined,
    error: typeof s.error === "string" ? s.error : undefined,
  }),
  component: () => (
    <AdminMasterGate>
      <MercadoPagoIntegrationPage />
    </AdminMasterGate>
  ),
});

const BENEFITS: { icon: React.ReactNode; label: string }[] = [
  { icon: <Zap className="h-3.5 w-3.5" />, label: "Pix" },
  { icon: <ArrowDownLeft className="h-3.5 w-3.5" />, label: "Pagamentos" },
  { icon: <ArrowUpRight className="h-3.5 w-3.5" />, label: "Recebimentos" },
  { icon: <Wallet className="h-3.5 w-3.5" />, label: "Saldo em conta" },
  { icon: <CreditCard className="h-3.5 w-3.5" />, label: "Cartão" },
  { icon: <Receipt className="h-3.5 w-3.5" />, label: "Taxas" },
  { icon: <Coins className="h-3.5 w-3.5" />, label: "Cashback" },
];

type MonthOption = { key: string; monthName: string; year: number; label: string };

/** Gera os últimos 12 meses, do mais recente para o mais antigo. */
const LAST_12_MONTHS: MonthOption[] = (() => {
  const out: MonthOption[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthName = d.toLocaleDateString("pt-BR", { month: "long" });
    out.push({
      key,
      monthName,
      year: d.getFullYear(),
      label: `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${d.getFullYear()}`,
    });
  }
  return out;
})();

function monthKeyLabel(key: string): string {
  const found = LAST_12_MONTHS.find((m) => m.key === key);
  if (found) return found.label;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const name = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatMonthsList(keys: string[]): string {
  // mantém ordem do LAST_12_MONTHS (mais recente primeiro)
  const ordered = LAST_12_MONTHS.filter((m) => keys.includes(m.key)).map((m) => m.label);
  if (ordered.length <= 1) return ordered.join("");
  if (ordered.length === 2) return `${ordered[0]} e ${ordered[1]}`;
  return `${ordered.slice(0, -1).join(", ")} e ${ordered[ordered.length - 1]}`;
}

function MercadoPagoIntegrationPage() {
  const search = useSearch({ from: "/app_/integracoes/mercado-pago/" });
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [lastSyncMsg, setLastSyncMsg] = useState<string | null>(null);
  const [lastFailedMonths, setLastFailedMonths] = useState<
    Array<{ month: string; message: string }>
  >([]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/integrations/mercadopago/status");
      if (res.ok) {
        const json = (await res.json()) as StatusResponse;
        setStatus(json);
      } else if (res.status === 401) {
        toast.error("Você precisa estar logado para conectar o Mercado Pago.");
        void navigate({ to: "/login" });
      } else {
        setStatus({ configured: false, integration: null, importedCount: 0 });
      }
    } catch {
      setStatus({ configured: false, integration: null, importedCount: 0 });
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (search.connected === "1") {
      toast.success("Conta Mercado Pago conectada!");
    } else if (search.error) {
      const errMap: Record<string, string> = {
        not_configured: "Integração preparada, aguardando configuração das credenciais.",
        invalid_state: "Sessão de autorização expirada. Tente novamente.",
        oauth_exchange_failed: "Não foi possível concluir a autorização.",
        missing_params: "Resposta do Mercado Pago incompleta.",
      };
      toast.error(errMap[search.error] ?? `Erro: ${search.error}`);
    }
  }, [search.connected, search.error]);

  async function handleConnect() {
    if (connecting) return;
    if (!status?.configured) {
      toast.info("Integração preparada, aguardando configuração das credenciais.");
      return;
    }
    setConnecting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("Você precisa estar logado para conectar o Mercado Pago.");
        void navigate({ to: "/login" });
        return;
      }

      const res = await fetch("/api/integrations/mercadopago/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; message?: string };

      if (res.status === 401) {
        toast.error(json.message ?? "Você precisa estar logado para conectar o Mercado Pago.");
        void navigate({ to: "/login" });
        return;
      }
      if (!res.ok) {
        toast.error(json.message ?? "Não foi possível iniciar a conexão com o Mercado Pago.");
        return;
      }
      if (!json.url) {
        toast.error("Não foi possível obter a URL de autorização do Mercado Pago.");
        return;
      }
      window.location.href = json.url;
    } catch {
      toast.error("Erro inesperado ao conectar o Mercado Pago.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    if (syncing) return;
    if (selectedMonths.length === 0) {
      toast.error("Selecione pelo menos um mês para sincronizar.");
      return;
    }
    setSyncing(true);
    setLastSyncMsg(null);
    setLastFailedMonths([]);
    try {
      const res = await apiFetch("/api/integrations/mercadopago/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: selectedMonths }),
      });
      const json = (await res.json()) as SyncResponse;
      if (json.ok) {
        const { imported, updated, ignored, failedMonths } = json.summary;
        const base = `${imported} novas, ${updated} atualizadas e ${ignored} já existentes.`;
        setLastSyncMsg(base);
        const failed = failedMonths ?? [];
        setLastFailedMonths(failed);
        if (failed.length > 0) {
          toast.warning(
            "Sincronização concluída com alertas. Alguns meses não puderam ser importados.",
          );
        } else {
          toast.success(`Sincronização concluída: ${base}`);
        }
      } else {
        toast.error(json.message ?? `Falha na sincronização: ${json.error}`);
      }
      await loadStatus();
    } catch {
      toast.error("Erro inesperado na sincronização.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      await apiFetch("/api/integrations/mercadopago/disconnect", { method: "POST" });
      toast.success("Conta Mercado Pago desconectada.");
      await loadStatus();
    } catch {
      toast.error("Não foi possível desconectar agora.");
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = status?.integration?.status === "connected";
  const isError = status?.integration?.status === "error";
  const isConfigured = !!status?.configured;
  const lastSync = status?.integration?.last_sync_at
    ? new Date(status.integration.last_sync_at).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <MobileShell>
      {/* Header */}
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app/integracoes"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Integração
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">Mercado Pago</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Conecte sua conta Mercado Pago para importar movimentações automaticamente e acompanhar
            seus dados com mais praticidade.
          </p>
        </div>
      </header>

      {/* Card principal */}
      <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        {/* Banda superior com identidade visual */}
        <div className="relative bg-gradient-to-br from-[hsl(45_100%_50%/0.18)] via-[hsl(45_100%_50%/0.08)] to-transparent p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[hsl(45_100%_50%/0.18)] blur-2xl" />
          <div className="relative flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(45_100%_50%/0.2)] text-[hsl(45_100%_45%)] ring-1 ring-[hsl(45_100%_50%/0.3)] shadow-sm">
              <Wallet className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-tight">Mercado Pago</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pagamentos, recebimentos, Pix, cartão e taxas — tudo sincronizado automaticamente.
              </p>
              <div className="mt-3">
                <StatusBadge
                  loading={loading}
                  configured={isConfigured}
                  connected={isConnected}
                  error={isError}
                  syncing={syncing}
                  connecting={connecting}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Corpo */}
        <div className="space-y-5 p-5">
          {/* Métricas (apenas se conectado) */}
          {isConnected && (
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label="Última sincronização"
                value={lastSync ?? "Nunca"}
                hint={lastSync ? undefined : "Sincronize para começar"}
              />
              <Metric
                label="Movimentações importadas"
                value={String(status?.importedCount ?? 0)}
                hint="registros"
                highlight
              />
            </div>
          )}

          {/* Estado desconectado: benefícios */}
          {!isConnected && !loading && (
            <div className="rounded-2xl border border-border/60 bg-card-elevated/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                O que será importado
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {BENEFITS.map((b) => (
                  <span
                    key={b.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground/80"
                  >
                    <span className="text-[hsl(45_100%_45%)]">{b.icon}</span>
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex flex-col gap-2.5">
            {!isConnected && (
              <Button
                onClick={handleConnect}
                disabled={loading || connecting}
                size="lg"
                className="h-12 rounded-2xl text-base font-semibold"
              >
                {connecting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Plug className="mr-2 h-5 w-5" />
                )}
                {connecting ? "Conectando..." : "Conectar conta"}
              </Button>
            )}
            {isConnected && (
              <>
                {/* Painel de Sincronização */}
                <div className="rounded-2xl border border-border/70 bg-card-elevated/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Escolha os meses para importar
                    </p>
                    {lastSyncMsg && !syncing && lastFailedMonths.length === 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> concluída
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Selecione um ou mais meses. A sincronização será feita mês a mês para evitar
                    falhas e duplicidades.
                  </p>

                  {/* Atalhos rápidos */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(
                      [
                        ["current", "Mês atual"],
                        ["3", "Últimos 3 meses"],
                        ["6", "Últimos 6 meses"],
                        ["12", "Últimos 12 meses"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        disabled={syncing}
                        onClick={() => {
                          const count = key === "current" ? 1 : Number(key);
                          setSelectedMonths(LAST_12_MONTHS.slice(0, count).map((m) => m.key));
                        }}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={syncing || selectedMonths.length === 0}
                      onClick={() => setSelectedMonths([])}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-40"
                    >
                      Limpar seleção
                    </button>
                  </div>

                  {/* Grid de meses */}
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {LAST_12_MONTHS.map((m) => {
                      const selected = selectedMonths.includes(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          disabled={syncing}
                          onClick={() =>
                            setSelectedMonths((prev) =>
                              prev.includes(m.key)
                                ? prev.filter((k) => k !== m.key)
                                : [...prev, m.key],
                            )
                          }
                          className={cn(
                            "group relative flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all disabled:opacity-60",
                            selected
                              ? "border-primary bg-primary/10 ring-1 ring-primary/40 shadow-sm"
                              : "border-border bg-card hover:border-primary/30 hover:bg-card-elevated/50",
                          )}
                          aria-pressed={selected}
                        >
                          <span
                            className={cn(
                              "text-sm font-semibold capitalize",
                              selected ? "text-primary" : "text-foreground",
                            )}
                          >
                            {m.monthName}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{m.year}</span>
                          {selected && (
                            <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Resumo dos selecionados */}
                  {selectedMonths.length > 0 && (
                    <div className="mt-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Meses selecionados
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                        {selectedMonths.length > 5
                          ? `${selectedMonths.length} meses selecionados`
                          : formatMonthsList(selectedMonths)}
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleSync}
                    disabled={syncing || selectedMonths.length === 0}
                    size="lg"
                    className="mt-3 h-12 w-full rounded-2xl text-base font-semibold"
                  >
                    <RefreshCw className={cn("mr-2 h-5 w-5", syncing && "animate-spin")} />
                    {syncing
                      ? "Importando movimentações..."
                      : selectedMonths.length === 0
                        ? "Sincronizar meses selecionados"
                        : `Sincronizar ${selectedMonths.length} ${selectedMonths.length === 1 ? "mês" : "meses"}`}
                  </Button>

                  {selectedMonths.length === 0 && !syncing && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Selecione pelo menos um mês para sincronizar.
                    </p>
                  )}
                  {syncing && (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      Estamos buscando os dados mês a mês. Isso pode levar alguns segundos.
                    </p>
                  )}
                  {lastSyncMsg && !syncing && (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      Sincronização concluída: {lastSyncMsg}
                    </p>
                  )}
                  {lastFailedMonths.length > 0 && !syncing && (
                    <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                      <p className="font-semibold">Alguns meses não puderam ser importados:</p>
                      <ul className="mt-1 list-disc pl-4">
                        {lastFailedMonths.map((f) => (
                          <li key={f.month} className="capitalize">
                            {monthKeyLabel(f.month)} — tente novamente depois.
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <Button asChild variant="outline" size="lg" className="h-12 rounded-2xl text-base">
                  <Link to="/app/integracoes/mercado-pago/movimentacoes">
                    <ListChecks className="mr-2 h-5 w-5" />
                    Ver movimentações importadas
                  </Link>
                </Button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="mt-1 inline-flex h-10 items-center justify-center gap-1.5 self-center rounded-full px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  {disconnecting ? "Desconectando..." : "Desconectar conta"}
                </button>
              </>
            )}
          </div>

          {isError && status?.integration?.last_error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">Último erro: {status.integration.last_error}</span>
            </div>
          )}
        </div>
      </section>

      {/* Aviso quando não configurado */}
      {!loading && !isConfigured && (
        <section className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-warning/20 text-warning">
            <Info className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Integração preparada</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Aguardando configuração das credenciais no servidor. Assim que estiverem disponíveis,
              você poderá conectar normalmente.
            </p>
          </div>
        </section>
      )}

      {/* Bloco informativo */}
      <section className="mt-4 flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
          <Info className="h-4 w-4" />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Esta integração importa apenas dados disponíveis na sua conta{" "}
          <span className="font-medium text-foreground">Mercado Pago</span>. Para outros bancos como
          Nubank, Itaú ou Bradesco, será necessário Open Finance — em breve.
        </p>
      </section>

      {/* Bloco de segurança */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Segurança e transparência</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A autorização é feita por OAuth oficial do Mercado Pago. Nunca pedimos sua senha. Seus
              tokens ficam armazenados de forma segura no servidor e nunca são exibidos no
              aplicativo.
            </p>
          </div>
        </div>
      </section>
    </MobileShell>
  );
}

function StatusBadge({
  loading,
  configured,
  connected,
  error,
  syncing,
  connecting,
}: {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  error: boolean;
  syncing?: boolean;
  connecting?: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
      </span>
    );
  }
  if (connecting) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Conectando
      </span>
    );
  }
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary">
        <RefreshCw className="h-3 w-3 animate-spin" /> Sincronizando
      </span>
    );
  }
  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-[11px] font-semibold text-warning">
        <Info className="h-3 w-3" /> Não configurado
      </span>
    );
  }
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-[11px] font-semibold text-destructive">
        <AlertTriangle className="h-3 w-3" /> Erro na conexão
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Conectado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card-elevated px-3 py-1 text-[11px] font-semibold text-muted-foreground">
      <PlugZap className="h-3 w-3" /> Não conectado
    </span>
  );
}

function Metric({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 transition-colors",
        highlight ? "border-primary/20 bg-primary/5" : "border-border/60 bg-card-elevated/40",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate text-base font-bold tracking-tight",
          highlight && "text-primary",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
