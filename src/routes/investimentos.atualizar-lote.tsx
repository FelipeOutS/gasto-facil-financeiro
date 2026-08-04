import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, Clock } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import {
  listarAtivos,
  atualizarValorAtivo,
  descreverUltimaAtualizacao,
  tipoLabel,
  getTipoInvestimentoLabel,
  type Ativo,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/investimentos/atualizar-lote")({
  head: () => ({ meta: [{ title: "Atualizar valores — Gasto Inteligente" }] }),
  component: AtualizarLotePage,
});

function AtualizarLotePage() {
  const navigate = useNavigate();
  const { t: tr } = useTranslation("investimentos");
  const { user } = useAuth();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [valores, setValores] = useState<
    Record<string, { valor: string; preco: string; obs: string }>
  >({});
  const [data, setData] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/investimentos" });
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    (async () => {
      try {
        const list = await listarAtivos(user.id);
        if (cancel) return;
        setAtivos(list);
        const map: Record<string, { valor: string; preco: string; obs: string }> = {};
        for (const a of list) {
          map[a.id] = {
            valor: a.valor_atual != null ? String(a.valor_atual).replace(".", ",") : "",
            preco: a.preco_atual != null ? String(a.preco_atual).replace(".", ",") : "",
            obs: "",
          };
        }
        setValores(map);
      } catch (e) {
        console.error(e);
        toast.error(i18n.t("common:errors.load"));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [user?.id]);

  function setCampo(id: string, campo: "valor" | "preco" | "obs", v: string) {
    setValores((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { valor: "", preco: "", obs: "" }), [campo]: v },
    }));
  }

  async function salvarTodos() {
    if (!user?.id) return;
    setSalvando(true);
    let ok = 0;
    let erros = 0;
    const dataIso = new Date(data + "T" + new Date().toTimeString().slice(0, 8)).toISOString();
    for (const a of ativos) {
      const entry = valores[a.id];
      if (!entry) continue;
      const isVariavel = ["acoes", "fii", "etf", "bdr", "cripto"].includes(a.tipo);
      let valorNovo = parseBRLInput(entry.valor);
      const precoNovo = entry.preco ? parseBRLInput(entry.preco) : null;
      if (isVariavel && precoNovo != null && a.quantidade && a.quantidade > 0) {
        valorNovo = precoNovo * Number(a.quantidade);
      }
      const valorAnterior = Number(a.valor_atual ?? 0);
      const precoAnterior = a.preco_atual != null ? Number(a.preco_atual) : null;
      if (valorNovo === valorAnterior && (precoNovo ?? null) === precoAnterior && !entry.obs) {
        continue;
      }
      if (!Number.isFinite(valorNovo)) {
        erros++;
        continue;
      }
      try {
        await atualizarValorAtivo(user.id, a, {
          valor_novo: valorNovo,
          preco_novo: precoNovo,
          observacao: entry.obs || null,
          data_atualizacao: dataIso,
          origem: "manual",
        });
        ok++;
      } catch (e) {
        console.error(e);
        erros++;
      }
    }
    setSalvando(false);
    if (ok > 0) toast.success(`${ok} investimento(s) atualizado(s).`);
    if (erros > 0) toast.error(`${erros} falha(s) ao atualizar.`);
    if (ok === 0 && erros === 0) toast.info("Nenhuma alteração para salvar.");
    if (ok > 0) back();
  }

  return (
    <MobileShell wide>
      <header className="pt-2 pb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ml-2">
          <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app" })}>
          <Home className="h-4 w-4" />
        </Button>
      </header>
      <h1 className="text-2xl font-bold tracking-tight mb-1">Atualizar valores</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Atualize os valores atuais dos seus investimentos. Valor informado por você.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-muted-foreground">Data da atualização</label>
        <Input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="max-w-[180px] min-h-11"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : ativos.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Nenhum investimento cadastrado.</p>
          <Button className="mt-4 min-h-11" onClick={() => navigate({ to: "/investimentos/novo" })}>
            Cadastrar investimento
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {ativos.map((a) => {
              const isVariavel = ["acoes", "fii", "etf", "bdr", "cripto"].includes(a.tipo);
              const ult = descreverUltimaAtualizacao(a.ultima_atualizacao);
              const entry = valores[a.id] ?? { valor: "", preco: "", obs: "" };
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-border/60 bg-card/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{a.nome}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {getTipoInvestimentoLabel(a.tipo, tr)} · Aplicado{" "}
                        {formatBRL(Number(a.valor_aplicado || 0))}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] gap-1 ${ult.desatualizado ? "border-amber-500/40 text-amber-500" : "text-muted-foreground"}`}
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {ult.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {isVariavel && (
                      <div>
                        <label className="text-[11px] text-muted-foreground">Preço atual</label>
                        <Input
                          value={entry.preco}
                          onChange={(e) => setCampo(a.id, "preco", e.target.value)}
                          placeholder="0,00"
                          className="min-h-11"
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-[11px] text-muted-foreground">Valor atual</label>
                      <Input
                        value={entry.valor}
                        onChange={(e) => setCampo(a.id, "valor", e.target.value)}
                        placeholder="0,00"
                        className="min-h-11"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Observação</label>
                      <Input
                        value={entry.obs}
                        onChange={(e) => setCampo(a.id, "obs", e.target.value)}
                        placeholder="opcional"
                        className="min-h-11"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-4 pb-2">
            <Button variant="outline" onClick={back} disabled={salvando} className="min-h-11">
              Cancelar
            </Button>
            <Button onClick={salvarTodos} disabled={salvando} className="min-h-11">
              {salvando ? "Salvando…" : "Salvar atualizações"}
            </Button>
          </div>
        </>
      )}
    </MobileShell>
  );
}
