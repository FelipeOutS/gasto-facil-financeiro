import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Contact,
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
import { useBootstrap, useStore, getReceitas } from "@/lib/store";
import { useClientes, type Cliente } from "@/lib/clientes";
import { nomeExibicaoCliente } from "@/components/ClienteSelect";
import { listarContasReceber, statusEfetivo, type ContaReceber } from "@/lib/contas-receber";
import { useAuth } from "@/lib/auth-context";
import type { Receita } from "@/lib/types";

export const Route = createFileRoute("/clientes_/relatorio")({
  head: () => ({
    meta: [
      { title: "Relatório por Cliente — Gasto Inteligente" },
      {
        name: "description",
        content: "Acompanhe quanto sua empresa recebe de cada cliente e o que está em aberto.",
      },
    ],
  }),
  component: RelatorioClientesPage,
});

type Periodo = "este_mes" | "mes_anterior" | "ultimos_3" | "ano";
type OrigemFiltro = "todos" | "receitas" | "contas";
type StatusFiltro = "todos" | "recebidos" | "pendentes";

function intervaloPeriodo(p: Periodo): { inicio: Date; fim: Date } {
  const hoje = new Date();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
  if (p === "este_mes") {
    return { inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim };
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
  return {
    inicio: new Date(hoje.getFullYear(), 0, 1),
    fim: new Date(hoje.getFullYear(), 11, 31, 23, 59, 59),
  };
}

function dentro(dataISO: string | null | undefined, inicio: Date, fim: Date): boolean {
  if (!dataISO) return false;
  try {
    const d = parseISO(dataISO);
    return d >= inicio && d <= fim;
  } catch {
    return false;
  }
}

interface AgregadoCliente {
  cliente: Cliente;
  totalRecebido: number;
  totalPendente: number;
  qtdLancamentos: number;
  ultimaMovimentacao: string | null;
  receitas: Receita[];
  contas: ContaReceber[];
}

function RelatorioClientesPage() {
  const ready = useBootstrap();
  const { user } = useAuth();
  const { clientes, porId, loading: loadingCli } = useClientes();
  const receitas = useStore(() => getReceitas());

  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [loadingContas, setLoadingContas] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setContas([]);
      setLoadingContas(false);
      return;
    }
    let cancelado = false;
    setLoadingContas(true);
    listarContasReceber(user.id)
      .then((rows) => {
        if (!cancelado) setContas(rows);
      })
      .catch(() => {
        if (!cancelado) setContas([]);
      })
      .finally(() => {
        if (!cancelado) setLoadingContas(false);
      });
    return () => {
      cancelado = true;
    };
  }, [user?.id]);

  const [periodo, setPeriodo] = useState<Periodo>("este_mes");
  const [clienteFiltro, setClienteFiltro] = useState<string>("todos");
  const [status, setStatus] = useState<StatusFiltro>("todos");
  const [origem, setOrigem] = useState<OrigemFiltro>("todos");
  const [detalhe, setDetalhe] = useState<AgregadoCliente | null>(null);

  const { inicio, fim } = useMemo(() => intervaloPeriodo(periodo), [periodo]);

  const agregados = useMemo<AgregadoCliente[]>(() => {
    const map = new Map<string, AgregadoCliente>();
    const getBucket = (id: string): AgregadoCliente | null => {
      const c = porId[id];
      if (!c) return null;
      let b = map.get(id);
      if (!b) {
        b = {
          cliente: c,
          totalRecebido: 0,
          totalPendente: 0,
          qtdLancamentos: 0,
          ultimaMovimentacao: null,
          receitas: [],
          contas: [],
        };
        map.set(id, b);
      }
      return b;
    };

    // Receitas: representam o efetivamente recebido (origem priorizada para "Total recebido").
    if (origem !== "contas") {
      for (const r of receitas) {
        if (!r.clienteId) continue;
        if (!dentro(r.data, inicio, fim)) continue;
        if (status === "pendentes") continue; // receitas são "recebidas"
        const b = getBucket(r.clienteId);
        if (!b) continue;
        b.totalRecebido += Number(r.valor) || 0;
        b.qtdLancamentos += 1;
        b.receitas.push(r);
        if (!b.ultimaMovimentacao || r.data > b.ultimaMovimentacao) {
          b.ultimaMovimentacao = r.data;
        }
      }
    }

    // Contas a receber:
    // - "todos": apenas pendentes/atrasadas (recebidas vêm via receitas para evitar duplicidade)
    // - "contas": inclui recebidas também (visão direta)
    if (origem !== "receitas") {
      for (const c of contas) {
        if (!c.cliente_id) continue;
        const ref = c.data_recebimento ?? c.data_prevista;
        if (!dentro(ref, inicio, fim)) continue;
        const eff = statusEfetivo(c);
        const recebido = eff === "recebido";
        const cancelado = eff === "cancelado";
        if (cancelado) continue;

        if (origem === "todos" && recebido) continue;

        if (status === "recebidos" && !recebido) continue;
        if (status === "pendentes" && recebido) continue;

        const b = getBucket(c.cliente_id);
        if (!b) continue;
        if (recebido) {
          b.totalRecebido += Number(c.valor_total) || 0;
        } else {
          b.totalPendente += Number(c.valor_restante) || 0;
        }
        b.qtdLancamentos += 1;
        b.contas.push(c);
        if (ref && (!b.ultimaMovimentacao || ref > b.ultimaMovimentacao)) {
          b.ultimaMovimentacao = ref;
        }
      }
    }

    let list = Array.from(map.values());
    if (clienteFiltro !== "todos") {
      list = list.filter((b) => b.cliente.id === clienteFiltro);
    }
    list.sort((a, b) => b.totalRecebido + b.totalPendente - (a.totalRecebido + a.totalPendente));
    return list;
  }, [receitas, contas, porId, inicio, fim, clienteFiltro, status, origem]);

  const totais = useMemo(() => {
    const totalRecebido = agregados.reduce((s, a) => s + a.totalRecebido, 0);
    const totalPendente = agregados.reduce((s, a) => s + a.totalPendente, 0);
    const qtdClientes = agregados.filter((a) => a.qtdLancamentos > 0).length;
    const contasPendentes = agregados.reduce(
      (s, a) =>
        s +
        a.contas.filter((c) => {
          const eff = statusEfetivo(c);
          return eff !== "recebido" && eff !== "cancelado";
        }).length,
      0,
    );
    const maior = agregados[0];
    return {
      totalRecebido,
      totalPendente,
      qtdClientes,
      contasPendentes,
      maior,
      totalGeral: totalRecebido + totalPendente,
    };
  }, [agregados]);

  const loading = !ready || loadingCli || loadingContas;

  return (
    <MobileShell>
      <header className="pt-4">
        <Link
          to="/clientes"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Clientes
        </Link>
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Relatório por cliente</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja de quais clientes sua empresa mais recebe e o que está em aberto.
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
            Cliente
          </label>
          <Select value={clienteFiltro} onValueChange={(v) => setClienteFiltro(v)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {nomeExibicaoCliente(c)}
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
              <SelectItem value="recebidos">Recebidos</SelectItem>
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
              <SelectItem value="receitas">Receitas</SelectItem>
              <SelectItem value="contas">Contas a receber</SelectItem>
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
          label="Total recebido"
          value={formatBRL(totais.totalRecebido)}
          accent="primary"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Maior cliente"
          value={totais.maior ? nomeExibicaoCliente(totais.maior.cliente) : "—"}
          hint={
            totais.maior
              ? formatBRL(totais.maior.totalRecebido + totais.maior.totalPendente)
              : undefined
          }
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Clientes movimentados"
          value={String(totais.qtdClientes)}
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
              const total = a.totalRecebido + a.totalPendente;
              const participacao = totais.totalGeral > 0 ? (total / totais.totalGeral) * 100 : 0;
              return (
                <li key={a.cliente.id}>
                  <button
                    type="button"
                    onClick={() => setDetalhe(a)}
                    className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Contact className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">
                          {nomeExibicaoCliente(a.cliente)}
                          {!a.cliente.ativo && (
                            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                              (inativo)
                            </span>
                          )}
                        </p>
                        <p className="text-sm font-semibold tabular-nums">{formatBRL(total)}</p>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>
                          Recebido{" "}
                          <strong className="text-foreground">{formatBRL(a.totalRecebido)}</strong>
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
                <DialogTitle>{nomeExibicaoCliente(detalhe.cliente)}</DialogTitle>
                <DialogDescription>Movimentações no período selecionado.</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="text-[11px] text-muted-foreground">Recebido</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">
                    {formatBRL(detalhe.totalRecebido)}
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
                {detalhe.receitas.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold">
                      Receitas ({detalhe.receitas.length})
                    </p>
                    <ul className="space-y-1.5">
                      {detalhe.receitas
                        .slice()
                        .sort((a, b) => b.data.localeCompare(a.data))
                        .map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{r.descricao}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {format(parseISO(r.data), "dd/MM/yyyy")} · {r.tipo}
                              </p>
                            </div>
                            <p className="shrink-0 font-semibold tabular-nums">
                              {formatBRL(Number(r.valor) || 0)}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {detalhe.contas.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold">
                      Contas a receber ({detalhe.contas.length})
                    </p>
                    <ul className="space-y-1.5">
                      {detalhe.contas
                        .slice()
                        .sort((a, b) =>
                          (b.data_recebimento ?? b.data_prevista).localeCompare(
                            a.data_recebimento ?? a.data_prevista,
                          ),
                        )
                        .map((c) => {
                          const eff = statusEfetivo(c);
                          return (
                            <li
                              key={c.id}
                              className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{c.titulo}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Previsto {format(parseISO(c.data_prevista), "dd/MM/yyyy")}
                                  {c.forma_recebimento ? ` · ${c.forma_recebimento}` : ""}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge
                                  variant={
                                    eff === "recebido"
                                      ? "secondary"
                                      : eff === "atrasado"
                                        ? "destructive"
                                        : "outline"
                                  }
                                  className="text-[10px]"
                                >
                                  {eff === "recebido"
                                    ? "Recebido"
                                    : eff === "atrasado"
                                      ? "Atrasado"
                                      : eff === "parcial"
                                        ? "Parcial"
                                        : eff === "cancelado"
                                          ? "Cancelado"
                                          : "Pendente"}
                                </Badge>
                                <p className="font-semibold tabular-nums">
                                  {formatBRL(
                                    Number(eff === "recebido" ? c.valor_total : c.valor_restante) ||
                                      0,
                                  )}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                )}

                {detalhe.receitas.length === 0 && detalhe.contas.length === 0 && (
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
      <p className="mt-2 text-sm font-medium">Sem movimentações no período</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Vincule clientes às suas receitas e contas a receber para ver o ranking aqui.
      </p>
    </div>
  );
}
