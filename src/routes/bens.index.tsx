import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Home, Car, Plus, Archive, RotateCcw, Loader2, Landmark, TrendingUp, Wallet, PieChart } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, formatBRLInput, todayISO } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import {
  TIPOS_BEM,
  arquivarBem,
  criarBem,
  listarBens,
  reativarBem,
  listarFinanciamentos,
  listarPagamentos,
  listarAmortizacoes,
  listarCustosAquisicao,
  listarGastosDoBem,
  listarHistoricoValor,
  listarHistoricoSaldo,
  calcularResumoBem,
  type Bem,
  type TipoBem,
  type ResumoBem,
} from "@/lib/bens";


export const Route = createFileRoute("/bens/")({
  head: () => ({
    meta: [
      { title: "Meus Bens e Financiamentos — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Acompanhe imóveis e veículos financiados: entrada, parcelas pagas, amortizações e saldo devedor, sem contar o mesmo gasto duas vezes.",
      },
      { property: "og:title", content: "Meus Bens e Financiamentos" },
      {
        property: "og:description",
        content: "Entrada, parcelas, amortizações e saldo devedor de imóveis e veículos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BensPage,
});

const EMPTY = {
  tipo: "imovel" as TipoBem,
  nome: "",
  data_aquisicao: "",
  valor_aquisicao: "",
  entrada_total: "",
  entrada_recursos_proprios: "",
  entrada_fgts: "",
  entrada_outros: "",
};

function BensPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bens, setBens] = useState<Bem[]>([]);
  const [resumos, setResumos] = useState<Record<string, ResumoBem>>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [mostrarArquivados, setMostrarArquivados] = useState(false);


  async function carregar(uid: string) {
    try {
      const lista = await listarBens(uid);
      setBens(lista);
      
      // Carregar resumos para o dashboard
      const map: Record<string, ResumoBem> = {};
      const ativos = lista.filter(b => b.status === "ativo");
      
      await Promise.all(ativos.map(async (b) => {
        const [f, p, a, c, g, hv] = await Promise.all([
          listarFinanciamentos(b.id),
          listarPagamentos(b.id),
          listarAmortizacoes(b.id),
          listarCustosAquisicao(b.id),
          listarGastosDoBem(b.id),
          listarHistoricoValor(b.id),
        ]);
        
        const ativo = f.find(x => x.status === "ativo");
        let hs: any[] = [];
        if (ativo) {
          hs = await listarHistoricoSaldo(ativo.id);
        }
        
        map[b.id] = calcularResumoBem({
          bem: b,
          financiamento: ativo,
          pagamentos: p,
          amortizacoes: a,
          custos: c,
          valoresGastos: {}, // não precisamos para o dashboard de topo
          gastos: g,
          mesReferencia: todayISO().slice(0, 7),
          historicoValor: hv,
          historicoSaldo: hs,
        });
      }));
      
      setResumos(map);
    } catch (e) {
      toastFromError(e);
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    if (!user?.id) return;
    void carregar(user.id);
  }, [user?.id]);

  const visiveis = useMemo(
    () => bens.filter((b) => (mostrarArquivados ? true : b.status !== "arquivado")),
    [bens, mostrarArquivados],
  );

  const composicao =
    parseBRLInput(form.entrada_recursos_proprios || "0") +
    parseBRLInput(form.entrada_fgts || "0") +
    parseBRLInput(form.entrada_outros || "0");
  const entradaTotal = parseBRLInput(form.entrada_total || "0");
  const composicaoDivergente = composicao > 0 && Math.abs(composicao - entradaTotal) > 0.005;

  async function salvar() {
    if (!user?.id) return;
    if (!form.nome.trim()) {
      toast.error("Informe o nome do bem.");
      return;
    }
    setSaving(true);
    try {
      const novo = await criarBem(user.id, {
        tipo: form.tipo,
        nome: form.nome.trim(),
        data_aquisicao: form.data_aquisicao || null,
        valor_aquisicao: form.valor_aquisicao ? parseBRLInput(form.valor_aquisicao) : null,
        entrada_total: entradaTotal,
        entrada_recursos_proprios: parseBRLInput(form.entrada_recursos_proprios || "0"),
        entrada_fgts: parseBRLInput(form.entrada_fgts || "0"),
        entrada_outros: parseBRLInput(form.entrada_outros || "0"),
      });
      setBens((prev) => [novo, ...prev]);
      setForm(EMPTY);
      setOpen(false);
      toast.success("Bem cadastrado.");
    } catch (e) {
      toastFromError(e);
    } finally {
      setSaving(false);
    }
  }

  async function arquivar(b: Bem) {
    try {
      await arquivarBem(b.id);
      setBens((prev) =>
        prev.map((x) =>
          x.id === b.id
            ? { ...x, status: "arquivado", arquivado_em: new Date().toISOString() }
            : x,
        ),
      );
      toast.success("Bem arquivado. Todo o histórico foi preservado.");
    } catch (e) {
      toastFromError(e);
    }
  }

  async function reativar(b: Bem) {
    try {
      await reativarBem(b.id);
      setBens((prev) =>
        prev.map((x) => (x.id === b.id ? { ...x, status: "ativo", arquivado_em: null } : x)),
      );
    } catch (e) {
      toastFromError(e);
    }
  }

  const totais = useMemo(() => {
    const ativos = bens.filter(b => b.status === "ativo");
    let totalValor = 0;
    let totalDivida = 0;
    let totalCustoMes = 0;
    let bensSemValor = 0;

    ativos.forEach(b => {
      const r = resumos[b.id];
      if (r) {
        if (r.valorAtualEstimado !== null) {
          totalValor += r.valorAtualEstimado;
        } else {
          bensSemValor++;
        }
        totalDivida += r.saldoDevedorEstimado || 0;
        totalCustoMes += r.custoMensalGastos || 0;
      }
    });

    return {
      totalValor,
      totalDivida,
      totalPatrimonio: totalValor - totalDivida,
      totalCustoMes,
      bensSemValor,
      ativosCount: ativos.length,
    };
  }, [bens, resumos]);

  return (
    <MobileShell>
      <header className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">Meus Bens</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Seu patrimônio em imóveis e veículos.
              </p>
            </div>
          </div>
          <Button className="shrink-0 gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo bem</span>
          </Button>
        </div>
      </header>

      {totais.ativosCount > 0 && (
        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
              <TrendingUp className="h-3 w-3" />
              Patrimônio Líquido
            </div>
            <div className="mt-1 text-lg font-bold text-primary">
              {formatBRL(totais.totalPatrimonio)}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
              <PieChart className="h-3 w-3" />
              Valor Estimado
            </div>
            <div className="mt-1 text-lg font-bold">
              {formatBRL(totais.totalValor)}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Wallet className="h-3 w-3 text-rose-500" />
              Dívida Total
            </div>
            <div className="mt-1 text-lg font-bold text-rose-600">
              {formatBRL(totais.totalDivida)}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Landmark className="h-3 w-3" />
              Custo do Mês
            </div>
            <div className="mt-1 text-lg font-bold">
              {formatBRL(totais.totalCustoMes)}
            </div>
          </div>
        </section>
      )}

      {totais.bensSemValor > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-2 text-center text-[10px] text-amber-700 border border-amber-200">
          {totais.bensSemValor} {totais.bensSemValor === 1 ? "bem não possui" : "bens não possuem"} valor atualizado.
        </div>
      )}


      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {visiveis.length} {visiveis.length === 1 ? "bem" : "bens"}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setMostrarArquivados((v) => !v)}>
          {mostrarArquivados ? "Ocultar arquivados" : "Mostrar arquivados"}
        </Button>
      </div>

      <div className="mt-3 space-y-3 pb-10">
        {loading ? (
          <>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </>
        ) : visiveis.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum bem cadastrado ainda.
          </div>
        ) : (
          visiveis.map((b) => (
            <div key={b.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <Link to="/bens/$id" params={{ id: b.id }} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {b.tipo === "imovel" ? (
                      <Home className="h-4 w-4 text-primary" />
                    ) : (
                      <Car className="h-4 w-4 text-primary" />
                    )}
                    <span className="truncate font-medium">{b.nome}</span>
                    {b.status !== "ativo" && (
                      <Badge variant="secondary" className="capitalize">
                        {b.status}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {resumos[b.id]?.patrimonioLiquidoEstimado !== undefined ? (
                      <>
                        Patrimônio: {formatBRL(resumos[b.id].patrimonioLiquidoEstimado!)}
                        {resumos[b.id].saldoDevedorEstimado! > 0 && ` · Dívida: ${formatBRL(resumos[b.id].saldoDevedorEstimado!)}`}
                      </>
                    ) : (
                      <>
                        Entrada: {b.entrada_total ? formatBRL(Number(b.entrada_total)) : "—"}
                        {" · "}
                        Compra: {b.valor_aquisicao ? formatBRL(Number(b.valor_aquisicao)) : "—"}
                      </>
                    )}
                  </p>

                </Link>
                {b.status === "arquivado" ? (
                  <Button variant="ghost" size="icon" onClick={() => void reativar(b)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={() => void arquivar(b)}>
                    <Archive className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo bem</DialogTitle>
            <DialogDescription>
              A entrada fica registrada aqui. Custos como ITBI, registro e escritura entram depois
              como custos adicionais — nunca somamos a entrada duas vezes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoBem }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_BEM.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Apartamento, Carro…"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data de aquisição</Label>
                <Input
                  type="date"
                  value={form.data_aquisicao}
                  onChange={(e) => setForm((f) => ({ ...f, data_aquisicao: e.target.value }))}
                />
              </div>
              <div>
                <Label>Valor de aquisição</Label>
                <Input
                  inputMode="decimal"
                  value={form.valor_aquisicao}
                  onChange={(e) => setForm((f) => ({ ...f, valor_aquisicao: formatBRLInput(e.target.value) }))}

                />
              </div>
            </div>
            <div>
              <Label>Entrada total</Label>
              <Input
                inputMode="decimal"
                value={form.entrada_total}
                onChange={(e) => setForm((f) => ({ ...f, entrada_total: formatBRLInput(e.target.value) }))}

              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Recursos próprios</Label>
                <Input
                  inputMode="decimal"
                  value={form.entrada_recursos_proprios}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entrada_recursos_proprios: formatBRLInput(e.target.value) }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">FGTS</Label>
                <Input
                  inputMode="decimal"
                  value={form.entrada_fgts}
                  onChange={(e) => setForm((f) => ({ ...f, entrada_fgts: formatBRLInput(e.target.value) }))}
                />
              </div>
              <div>
                <Label className="text-xs">Outros</Label>
                <Input
                  inputMode="decimal"
                  value={form.entrada_outros}
                  onChange={(e) => setForm((f) => ({ ...f, entrada_outros: formatBRLInput(e.target.value) }))}
                />

              </div>
            </div>
            {composicaoDivergente && (
              <p className="text-xs text-amber-600">
                A composição ({formatBRL(composicao)}) difere da entrada total (
                {formatBRL(entradaTotal)}).
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MobileShell>
  );
}
