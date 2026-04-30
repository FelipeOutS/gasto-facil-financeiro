import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Check,
  MessageCircle,
  Plus,
  Trash2,
  Send,
  Shield,
  AlertTriangle,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase as _supabase } from "@/integrations/supabase/client";
// As tabelas whatsapp_* foram criadas após a regeneração de tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = _supabase as any;

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "Gastos via WhatsApp — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Configure a integração real do WhatsApp para registrar gastos por mensagem.",
      },
    ],
  }),
  component: WhatsAppPage,
});

type Link = {
  id: string;
  telefone: string;
  ativo: boolean;
  ultimo_uso: string | null;
  created_at: string;
};

type Message = {
  id: string;
  telefone: string;
  texto: string;
  status: string;
  gasto_id: string | null;
  confianca: number | null;
  recebida_em: string;
  resposta_sugerida: string | null;
  erro: string | null;
};

function maskTel(t: string) {
  const d = t.replace(/\D/g, "");
  if (d.length <= 4) return "***";
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ****-${d.slice(-4)}`;
}

const STATUS_STYLES: Record<string, string> = {
  salva: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  pendente: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  duplicada: "border-sky-500/40 text-sky-400 bg-sky-500/10",
  sem_vinculo: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  erro: "border-rose-500/40 text-rose-400 bg-rose-500/10",
  valor_invalido: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  recebida: "border-border text-muted-foreground bg-card",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? STATUS_STYLES.recebida}>
      {status}
    </Badge>
  );
}

function WhatsAppPage() {
  const list = useServerFn(listWhatsAppLinks);
  const upsert = useServerFn(upsertWhatsAppLink);
  const remove = useServerFn(deleteWhatsAppLink);
  const listMsgs = useServerFn(listWhatsAppMessages);
  const testar = useServerFn(testarWebhookWhatsApp);

  const [links, setLinks] = useState<Link[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoTel, setNovoTel] = useState("");
  const [adding, setAdding] = useState(false);
  const [testTexto, setTestTexto] = useState(
    "Spotify 19,90 assinatura Nubank",
  );
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/api/public/whatsapp/expense`;
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([list(), listMsgs()]);
      setLinks(a.links as Link[]);
      setMsgs(b.messages as Message[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function adicionar() {
    if (!novoTel.trim()) return;
    setAdding(true);
    try {
      await upsert({ data: { telefone: novoTel, ativo: true } });
      toast.success("Número vinculado");
      setNovoTel("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function excluir(id: string) {
    try {
      await remove({ data: { id } });
      toast.success("Vínculo removido");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function testarWebhook() {
    if (links.length === 0) {
      toast.error("Vincule pelo menos um número primeiro");
      return;
    }
    setTestando(true);
    try {
      const out = await testar({
        data: { telefone: links[0].telefone, texto: testTexto },
      });
      toast.success(out.resposta);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTestando(false);
    }
  }

  function copiarUrl() {
    navigator.clipboard.writeText(webhookUrl);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  // Status global da integração
  const ultimaMsg = msgs[0];
  const integracaoStatus = links.length === 0
    ? { label: "Não configurado", cls: "border-border text-muted-foreground" }
    : ultimaMsg
      ? { label: "Ativo", cls: "border-emerald-500/40 text-emerald-400" }
      : { label: "Webhook criado", cls: "border-sky-500/40 text-sky-400" };

  return (
    <MobileShell>
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex items-center gap-3">
          <Link
            to="/adicionar"
            className="grid h-9 w-9 place-items-center rounded-full bg-card border border-border hover:bg-card-elevated"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <MessageCircle className="h-4 w-4" />
              </span>
              Gastos via WhatsApp
            </h1>
            <p className="text-xs text-muted-foreground">
              Registre gastos enviando mensagens. Funciona com simulador local e webhook real.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </header>

        {/* Status */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              Status da integração
            </h2>
            <Badge variant="outline" className={integracaoStatus.cls}>
              {integracaoStatus.label}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-card-elevated p-2.5">
              <p className="text-muted-foreground">Verify token</p>
              <p className="mt-0.5 font-medium">Configurado no servidor ✓</p>
            </div>
            <div className="rounded-lg bg-card-elevated p-2.5">
              <p className="text-muted-foreground">Última mensagem</p>
              <p className="mt-0.5 font-medium num">
                {ultimaMsg
                  ? new Date(ultimaMsg.recebida_em).toLocaleString("pt-BR")
                  : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Webhook URL */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">URL do webhook</h2>
          <div className="flex items-center gap-2 rounded-lg bg-card-elevated px-3 py-2 text-xs font-mono break-all">
            <span className="flex-1">{webhookUrl}</span>
            <button
              type="button"
              onClick={copiarUrl}
              className="shrink-0 rounded-md p-1.5 hover:bg-border"
              aria-label="Copiar URL"
            >
              {copiado ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            No painel da Meta (WhatsApp Business), configure essa URL como Callback URL e use o seu Verify Token. O endpoint aceita GET (verificação) e POST (mensagens).
          </p>
        </section>

        {/* Vincular números */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Números vinculados</h2>
          <div className="flex gap-2">
            <Input
              value={novoTel}
              onChange={(e) => setNovoTel(e.target.value)}
              placeholder="Ex.: 5511999998888"
              inputMode="tel"
            />
            <Button onClick={adicionar} disabled={adding || !novoTel.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Vincular
            </Button>
          </div>

          {links.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">
              Nenhum número vinculado. Mensagens recebidas de números não vinculados são rejeitadas.
            </p>
          )}
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-lg bg-card-elevated px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-medium num">{maskTel(l.telefone)}</p>
                  <p className="text-muted-foreground">
                    {l.ultimo_uso
                      ? `Último uso ${new Date(l.ultimo_uso).toLocaleString("pt-BR")}`
                      : "Sem uso ainda"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => excluir(l.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                  aria-label="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Testar webhook */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-400" />
            Testar webhook
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Roda a mesma lógica do webhook usando o primeiro número vinculado.
          </p>
          <Textarea
            value={testTexto}
            onChange={(e) => setTestTexto(e.target.value)}
            className="min-h-[72px] bg-card-elevated text-sm"
          />
          <Button
            onClick={testarWebhook}
            disabled={testando || links.length === 0}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {testando ? "Testando..." : "Disparar teste"}
          </Button>
        </section>

        {/* Histórico */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Mensagens recebidas</h2>
          {msgs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma mensagem recebida ainda.
            </p>
          )}
          <ul className="space-y-2">
            {msgs.map((m) => (
              <li key={m.id} className="rounded-lg bg-card-elevated p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground num">
                    {maskTel(m.telefone)} ·{" "}
                    {new Date(m.recebida_em).toLocaleString("pt-BR")}
                  </span>
                  <StatusBadge status={m.status} />
                </div>
                <p className="text-xs">{m.texto}</p>
                {m.resposta_sugerida && (
                  <p className="text-[11px] text-muted-foreground border-l-2 border-emerald-500/40 pl-2">
                    {m.resposta_sugerida}
                  </p>
                )}
                {m.erro && (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {m.erro}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Aviso de segurança */}
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
          <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
          <p>
            Nunca envie número completo do cartão, CVV, senha ou dados bancários sensíveis. Use apenas nome do gasto, valor, categoria, cartão e data.
          </p>
        </div>
      </div>
    </MobileShell>
  );
}
