import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Calendar as CalendarIcon,
  TrendingUp,
  Users,
  Wallet,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getContasAPagar,
  getGastos,
  statusContaEfetivo,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { useFornecedores, type Fornecedor } from "@/lib/fornecedores";
import type { ContaAPagar, Gasto } from "@/lib/types";

export const Route = createFileRoute("/fornecedores_/relatorio")({
  head: () => ({
    meta: [
      { title: "Relatório por Fornecedor — Gasto Inteligente" },
      {
        name: "description",
        content: "Acompanhe quanto sua empresa gasta com cada fornecedor.",
      },
    ],
  }),
  component: RelatorioFornecedoresPage,
});

type Periodo = "este_mes" | "mes_anterior" | "ultimos_3" | "ano";
type OrigemFiltro = "todos" | "gastos" | "contas";
type StatusFiltro = "todos" | "pagos" | "pendentes";

const CONTA_GASTO_ORIGEM = "contas_a_pagar";

function nomeExibicao(f: Fornecedor): string {
  return f.apelido?.trim() || f.nome_fantasia?.trim() || f.razao_social?.trim() || f.nome;
}

function intervaloPeriodo(p: Periodo): { inicio: Date; fim: Date } {
  const hoje = new Date();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
  if (p === "este_mes") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
      fim,
    };
  }
  if (p === "mes_anterior") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1),
      fim: new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59),
    };
  }
  if (p === "ultimos_3") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1),
      fim,
    };
  }
  // ano
  return {
    inicio: new Date(hoje.getFullYear(), 0, 1),
    fim: new Date(hoje.getFullYear(), 11, 31, 23, 59, 59),
  };
}

function dentro(dataISO: string, inicio: Date, fim: Date): boolean {
  try {
    const d = parseISO(dataISO);
    return d >= inicio && d <= fim;
  } catch {
    return false;
  }
}

interface AgregadoFornecedor {
  fornecedor: Fornecedor;
  totalPago: number;
  totalPendente: number;
  qtdLancamentos: number;
  ultimaMovimentacao: string | null;
  gastos: Gasto[];
  contas: ContaAPagar[];
}

function RelatorioFornecedoresPage() {
  const ready = useBootstrap();
  const { fornecedores, porId, loading: loadingForn } = useFornecedores();
  const gastos = useStore(() => getGastos());
  const contas = useStore(() => getContasAPagar());

  const [periodo, setPeriodo] = useState<Periodo>("este_mes");
  const [fornecedorFiltro, setFornecedorFiltro] = useState<string>("todos");
  const [status, setStatus] = useState<StatusFiltro>("todos");
  const [origem, setOrigem] = useState<OrigemFiltro>("todos");
  const [detalhe, setDetalhe] = useState<AgregadoFornecedor | null>(null);

  const { inicio, fim } = useMemo(() => intervaloPeriodo(periodo), [periodo]);

  const agregados = useMemo<AgregadoFornecedor[]>(() => {
    const porFornId = new Map<string, AgregadoFornecedor>();
    const getBucket = (id: string): AgregadoFornecedor | null => {
      const f = porId[id];
      if (!f) return null;
      let b = porFornId.get(id);
      if (!b) {
        b = {
          fornecedor: f,
          totalPago: 0,
          totalPendente: 0,
          qtdLancamentos: 0,
          ultimaMovimentacao: null,
          gastos: [],
          contas: [],
        };
        porFornId.set(id, b);
      }
      return b;
    };

    // Gastos (representam o que efetivamente saiu — inclui os gerados por conta paga)
    if (origem !== "contas") {
      for (const g of gastos) {
        if (!g.fornecedorId) continue;
        if (!dentro(g.data, inicio, fim)) continue;
        if (status === "pendentes") continue; // gastos são "pagos"
        const b = getBucket(g.fornecedorId);
        if (!b) continue;
        b.totalPago += Number(g.valor) || 0;
        b.qtdLancamentos += 1;
        b.gastos.push(g);
        if (!b.ultimaMovimentacao || g.data > b.ultimaMovimentacao) {
          b.ultimaMovimentacao = g.data;
        }
      }
    }

    // Contas a pagar — somar apenas as pendentes/atrasadas para "em aberto".
    // Contas pagas já estão refletidas em gastos (evita duplicidade).
    if (origem !== "gastos") {
      for (const c of contas) {
        if (!c.fornecedorId) continue;
        if (!dentro(c.dataVencimento, inicio, fim)) continue;
        const eff = statusContaEfetivo(c);
        const pendente = eff !== "pago";

        // Quando origem === "contas", incluímos contas pagas também (visão direta).
        // Quando origem === "todos", somamos só as pendentes (pagas vêm via gastos).
        if (origem === "todos" && !pendente) continue;

        if (status === "pagos" && pendente) continue;
        if (status === "pendentes" && !pendente) continue;

        const b = getBucket(c.fornecedorId);
        if (!b) continue;
        const valor = Number(c.valor) || 0;
        if (pendente) {
          b.totalPendente += valor;
        } else {
          b.totalPago += valor;
        }
        b.qtdLancamentos += 1;
        b.contas.push(c);
        const ref = c.dataPagamento ?? c.dataVencimento;
        if (ref && (!b.ultimaMovimentacao || ref > b.ultimaMovimentacao)) {
          b.ultimaMovimentacao = ref;
        }
      }
    }

    let list = Array.from(porFornId.values());
    if (fornecedorFiltro !== "todos") {
      list = list.filter((b) => b.fornecedor.id === fornecedorFiltro);
    }
    list.sort((a, b) => b.totalPago + b.totalPendente - (a.totalPago + a.totalPendente));
    return list;
  }, [gastos, contas, porId, inicio, fim, fornecedorFiltro, status, origem]);

  const totais = useMemo(() => {
    const totalPago = agregados.reduce((s, a) => s + a.totalPago, 0);
    const totalPendente = agregados.reduce((s, a) => s + a.totalPendente, 0);
    const qtdFornecedores = agregados.filter((a) => a.qtdLancamentos > 0).length;
    const contasPendentes = agregados.reduce(
      (s, a) => s + a.contas.filter((c) => statusContaEfetivo(c) !== "pago").length,
      0,
    );
    const maior = agregados[0];
    return {
      totalPago,
      totalPendente,
      qtdFornecedores,
      contasPendentes,
      maior,
      totalGeral: totalPago + totalPendente,
    };
  }, [agregados]);

  const loading = !ready || loadingForn;

  return (
    <MobileShell>
      <header className="pt-4">
        <Link
          to="/fornecedores"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Fornecedores
        </Link>
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Relatório por fornecedor</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja quanto sua empresa movimenta com cada fornecedor.
            </p>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Período
          </label>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="este_mes">Este mês</SelectItem>
              <SelectItem value="mes_anterior">Mês anterior</SelectItem>
              <SelectItem value="ultimos_3">Últimos 3 meses</SelectItem>
              <SelectItem value="ano">Este ano</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Fornecedor
          </label>
          <Select value={fornecedorFiltro} onValueChange={(v) => setFornecedorFiltro(v)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {fornecedores.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {nomeExibicao(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFiltro)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pagos">Pagos</SelectItem>
              <SelectItem value="pendentes">Pendentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Origem</label>
          <Select value={origem} onValueChange={(v) => setOrigem(v as OrigemFiltro)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="gastos">Gastos</SelectItem>
              <SelectItem value="contas">Contas a pagar</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {format(inicio, "dd 'de' MMM", { locale: ptBR })} —{" "}
        {format(fim, "dd 'de' MMM yyyy", { locale: ptBR })}
      </p>

      {/* Cards principais */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total com fornecedores"
          value={formatBRL(totais.totalGeral)}
          accent="primary"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Maior fornecedor"
          value={totais.maior ? nomeExibicao(totais.maior.fornecedor) : "—"}
          hint={
            totais.maior
              ? formatBRL(totais.maior.totalPago + totais.maior.totalPendente)
              : undefined
          }
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Fornecedores movimentados"
          value={String(totais.qtdFornecedores)}
        />
        <KpiCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Em aberto"
          value={formatBRL(totais.totalPendente)}
          hint={`${totais.contasPendentes} conta(s) pendente(s)`}
          accent="warning"
        />
      </section>

      {/* Ranking */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Ranking</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : agregados.length === 0 ? (
          <EmptyRanking />
        ) : (
          <ul className="space-y-2">
            {agregados.map((a) => {
              const total = a.totalPago + a.totalPendente;
              const participacao = totais.totalGeral > 0 ? (total / totais.totalGeral) * 100 : 0;
              return (
                <li key={a.fornecedor.id}>
                  <button
                    type="button"
                    onClick={() => setDetalhe(a)}
                    className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">
                          {nomeExibicao(a.fornecedor)}
                        </p>
                        <p className="text-sm font-semibold tabular-nums">{formatBRL(total)}</p>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>
                          Pago <strong className="text-foreground">{formatBRL(a.totalPago)}</strong>
                        </span>
                        {a.totalPendente > 0 && (
                          <span>
                            Em aberto{" "}
                            <strong className="text-amber-600 dark:text-amber-400">
                              {formatBRL(a.totalPendente)}
                            </strong>
                          </span>
                        )}
                        <span>{a.qtdLancamentos} lançamento(s)</span>
                        <span>{participacao.toFixed(1)}% do total</span>
                        {a.ultimaMovimentacao && (
                          <span>
                            Última: {format(parseISO(a.ultimaMovimentacao), "dd/MM/yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Diálogo de detalhe */}
      <Dialog
        open={!!detalhe}
        onOpenChange={(v) => {
          if (!v) setDetalhe(null);
        }}
      >
        <DialogContent className="max-w-lg">
          {detalhe && (
            <>
              <DialogHeader>
                <DialogTitle>{nomeExibicao(detalhe.fornecedor)}</DialogTitle>
                <DialogDescription>Movimentações no período selecionado.</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="text-[11px] text-muted-foreground">Pago</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">
                    {formatBRL(detalhe.totalPago)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="text-[11px] text-muted-foreground">Em aberto</p>
                  <p
                    className={cn(
                      "mt-0.5 text-base font-semibold tabular-nums",
                      detalhe.totalPendente > 0 && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {formatBRL(detalhe.totalPendente)}
                  </p>
                </div>
              </div>

              <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                {detalhe.gastos.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold">Gastos ({detalhe.gastos.length})</p>
                    <ul className="space-y-1.5">
                      {detalhe.gastos
                        .slice()
                        .sort((a, b) => b.data.localeCompare(a.data))
                        .map((g) => (
                          <li
                            key={g.id}
                            className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{g.descricao}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {format(parseISO(g.data), "dd/MM/yyyy")} · {g.formaPagamento}
                                {g.origem === CONTA_GASTO_ORIGEM ? " · via conta paga" : ""}
                              </p>
                            </div>
                            <p className="shrink-0 font-semibold tabular-nums">
                              {formatBRL(Number(g.valor) || 0)}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {detalhe.contas.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold">
                      Contas a pagar ({detalhe.contas.length})
                    </p>
                    <ul className="space-y-1.5">
                      {detalhe.contas
                        .slice()
                        .sort((a, b) => b.dataVencimento.localeCompare(a.dataVencimento))
                        .map((c) => {
                          const eff = statusContaEfetivo(c);
                          return (
                            <li
                              key={c.id}
                              className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{c.nome}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Venc. {format(parseISO(c.dataVencimento), "dd/MM/yyyy")}
                                  {c.formaPagamento ? ` · ${c.formaPagamento}` : ""}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge
                                  variant={
                                    eff === "pago"
                                      ? "secondary"
                                      : eff === "atrasado"
                                        ? "destructive"
                                        : "outline"
                                  }
                                  className="text-[10px]"
                                >
                                  {eff === "pago"
                                    ? "Pago"
                                    : eff === "atrasado"
                                      ? "Atrasado"
                                      : "Pendente"}
                                </Badge>
                                <p className="font-semibold tabular-nums">
                                  {formatBRL(Number(c.valor) || 0)}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                )}

                {detalhe.gastos.length === 0 && detalhe.contas.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground">
                    Sem movimentações neste período.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MobileShell>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3 shadow-sm",
        accent === "primary" && "border-primary/30",
        accent === "warning" && "border-amber-500/30",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground/70",
            accent === "primary" && "bg-primary/10 text-primary",
            accent === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-base font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EmptyRanking() {
  return (
    <div className="rounded-2xl border border-dashed bg-card/40 p-6 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
        <CalendarIcon className="h-5 w-5" />
      </div>
      <p className="mt-2 text-sm font-medium">Nenhuma movimentação no período</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Vincule fornecedores aos seus gastos e contas para ver o ranking aqui.
      </p>
    </div>
  );
}
