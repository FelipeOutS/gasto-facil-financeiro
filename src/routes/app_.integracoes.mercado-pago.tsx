import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
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
} from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
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
      };
    }
  | { ok: false; error: string };

type Search = { connected?: string; error?: string };

export const Route = createFileRoute("/app_/integracoes/mercado-pago")({
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
  component: MercadoPagoIntegrationPage,
});

function MercadoPagoIntegrationPage() {
  const search = useSearch({ from: "/app_/integracoes/mercado-pago" });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/integrations/mercadopago/status");
      if (res.ok) {
        const json = (await res.json()) as StatusResponse;
        setStatus(json);
      } else {
        setStatus({ configured: false, integration: null, importedCount: 0 });
      }
    } catch {
      setStatus({ configured: false, integration: null, importedCount: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Feedback do retorno do OAuth (callback)
  useEffect(() => {
    if (search.connected === "1") {
      toast.success("Conta Mercado Pago conectada!");
    } else if (search.error) {
      const errMap: Record<string, string> = {
        not_configured: "Integração ainda não configurada pelo administrador.",
        invalid_state: "Sessão de autorização expirada. Tente novamente.",
        oauth_exchange_failed: "Não foi possível concluir a autorização.",
        missing_params: "Resposta do Mercado Pago incompleta.",
      };
      toast.error(errMap[search.error] ?? `Erro: ${search.error}`);
    }
  }, [search.connected, search.error]);

  async function handleConnect() {
    if (!status?.configured) {
      toast.error("A integração ainda não está configurada. Avise o administrador.");
      return;
    }
    // Página inteira — sem modal. Vai pelo backend para gerar a URL assinada.
    // Usamos apiFetch para anexar o token e seguir o redirect na mão.
    const res = await apiFetch("/api/integrations/mercadopago/connect", { redirect: "manual" });
    // O servidor responde 302; com fetch+manual o "type" vira "opaqueredirect".
    if (res.type === "opaqueredirect" || res.status === 0 || res.status === 302) {
      // Não temos a URL final — fazemos a navegação direta via GET sem header.
      // Solução: backend gera URL e seguimos. Como o fetch já fez a 302, abrimos
      // a URL direta:
      window.location.href = "/api/integrations/mercadopago/connect";
      return;
    }
    // Fallback
    window.location.href = "/api/integrations/mercadopago/connect";
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await apiFetch("/api/integrations/mercadopago/sync", { method: "POST" });
      const json = (await res.json()) as SyncResponse;
      if (json.ok) {
        toast.success(
          `Sincronizado: ${json.summary.imported} novas, ${json.summary.updated} atualizadas, ${json.summary.ignored} já existentes.`,
        );
      } else {
        toast.error(`Falha na sincronização: ${json.error}`);
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
    ? new Date(status.integration.last_sync_at).toLocaleString("pt-BR")
    : null;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app/integracoes"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Integração</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">Mercado Pago</h1>
        </div>
      </header>

      {/* Hero */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(45_100%_50%/0.15)] text-[hsl(45_100%_45%)]">
            <Wallet className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Mercado Pago</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Importa pagamentos, recebimentos, Pix, cartão e taxas disponíveis na sua conta
              Mercado Pago.
            </p>
            <div className="mt-3">
              <StatusBadge
                loading={loading}
                configured={isConfigured}
                connected={isConnected}
                error={isError}
              />
            </div>
          </div>
        </div>

        {/* Métricas */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric
            label="Última sincronização"
            value={lastSync ?? "—"}
          />
          <Metric
            label="Movimentações importadas"
            value={String(status?.importedCount ?? 0)}
          />
        </div>

        {/* Ações */}
        <div className="mt-5 flex flex-col gap-2.5">
          {!isConnected && (
            <Button
              onClick={handleConnect}
              disabled={loading || !isConfigured}
              size="lg"
              className="h-12 rounded-2xl text-base"
            >
              <Plug className="mr-2 h-5 w-5" />
              Conectar Mercado Pago
            </Button>
          )}
          {isConnected && (
            <>
              <Button
                onClick={handleSync}
                disabled={syncing}
                size="lg"
                className="h-12 rounded-2xl text-base"
              >
                <RefreshCw className={cn("mr-2 h-5 w-5", syncing && "animate-spin")} />
                {syncing ? "Sincronizando..." : "Sincronizar agora"}
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 rounded-2xl text-base"
              >
                <Link to="/app/integracoes/mercado-pago/movimentacoes">
                  <ListChecks className="mr-2 h-5 w-5" />
                  Ver movimentações importadas
                </Link>
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={disconnecting}
                variant="ghost"
                size="lg"
                className="h-12 rounded-2xl text-base text-destructive hover:text-destructive"
              >
                <Unplug className="mr-2 h-5 w-5" />
                {disconnecting ? "Desconectando..." : "Desconectar"}
              </Button>
            </>
          )}
        </div>

        {isError && status?.integration?.last_error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">Último erro: {status.integration.last_error}</span>
          </div>
        )}
      </section>

      {/* Aviso quando não configurado */}
      {!loading && !isConfigured && (
        <section className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-xs text-warning-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-foreground">Integração preparada</p>
            <p className="mt-1 text-muted-foreground">
              Configure as credenciais do Mercado Pago (Client ID, Client Secret e Redirect URI)
              para ativar a conexão real.
            </p>
          </div>
        </section>
      )}

      {/* Explicação */}
      <section className="mt-4 flex items-start gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta integração importa apenas dados disponíveis na sua conta Mercado Pago. Não traz
          dados de outros bancos. Para Nubank, Itaú, Bradesco e outros, será necessário Open
          Finance no futuro.
        </p>
      </section>

      <p className="mt-6 px-1 text-[11px] leading-relaxed text-muted-foreground">
        A autorização é feita por OAuth oficial do Mercado Pago. Nunca pedimos sua senha. Seus
        tokens ficam armazenados de forma segura no servidor e nunca aparecem aqui.
      </p>
    </MobileShell>
  );
}

function StatusBadge({
  loading,
  configured,
  connected,
  error,
}: {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground">
        Carregando status…
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated/40 p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
