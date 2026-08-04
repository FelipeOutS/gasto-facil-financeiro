import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Printer,
  Copy,
  Download,
  Building2,
  AlertCircle,
  CheckCircle2,
  Wallet,
  TrendingDown,
  TrendingUp,
  Users,
  Truck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  useBootstrap,
  useStore,
  getReceitas,
  getGastos,
  getContasAPagar,
  getCartoes,
  getCategoriaById,
} from "@/lib/store";
import { useFornecedores } from "@/lib/fornecedores";
import { useClientes } from "@/lib/clientes";
import { listarContasReceber, type ContaReceber } from "@/lib/contas-receber";
import { getMinhaEmpresa, type MinhaEmpresa } from "@/lib/empresa";
import {
  montarPacoteContador,
  rotuloPeriodo,
  nomeMes,
  gerarResumoTexto,
  gerarCsvPacote,
  rotuloVariacao,
  type PacoteContador,
  type OpcoesPacote,
  type VariacaoIndicador,
} from "@/lib/contador";
import type { Cartao } from "@/lib/types";

export const Route = createFileRoute("/contador")({
  head: () => ({
    meta: [
      { title: "Pacote para Contador — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Gere um resumo mensal com receitas, despesas, clientes, fornecedores e pendências para enviar ao seu contador.",
      },
    ],
  }),
  component: PacoteContadorPage,
});

function PacoteContadorPage() {
  const ready = useBootstrap();
  const { user } = useAuth();

  const receitas = useStore(() => getReceitas());
  const gastos = useStore(() => getGastos());
  const contasAPagar = useStore(() => getContasAPagar());
  const cartoes = useStore(() => getCartoes());
  const { porId: fornecedoresPorId, loading: loadingForn } = useFornecedores();
  const { porId: clientesPorId, loading: loadingCli } = useClientes();

  const [empresa, setEmpresa] = useState<MinhaEmpresa | null>(null);
  const [loadingEmpresa, setLoadingEmpresa] = useState(true);
  const [contasAReceber, setContasAReceber] = useState<ContaReceber[]>([]);
  const [loadingCR, setLoadingCR] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setEmpresa(null);
      setLoadingEmpresa(false);
      setContasAReceber([]);
      setLoadingCR(false);
      return;
    }
    let cancelado = false;
    setLoadingEmpresa(true);
    getMinhaEmpresa(user.id)
      .then((e) => {
        if (!cancelado) setEmpresa(e);
      })
      .catch(() => {
        if (!cancelado) setEmpresa(null);
      })
      .finally(() => {
        if (!cancelado) setLoadingEmpresa(false);
      });
    setLoadingCR(true);
    listarContasReceber(user.id)
      .then((rows) => {
        if (!cancelado) setContasAReceber(rows);
      })
      .catch(() => {
        if (!cancelado) setContasAReceber([]);
      })
      .finally(() => {
        if (!cancelado) setLoadingCR(false);
      });
    return () => {
      cancelado = true;
    };
  }, [user?.id]);

  const hoje = new Date();
  const [mes, setMes] = useState<number>(hoje.getMonth() + 1);
  const [ano, setAno] = useState<number>(hoje.getFullYear());
  const [opcoes, setOpcoes] = useState<OpcoesPacote>({
    incluirEmAberto: true,
    incluirClientes: true,
    incluirFornecedores: true,
    incluirPendencias: true,
    incluirComparativo: true,
  });

  const cartoesPorId = useMemo<Record<string, Cartao>>(() => {
    const map: Record<string, Cartao> = {};
    for (const c of cartoes) map[c.id] = c;
    return map;
  }, [cartoes]);

  const pacote = useMemo<PacoteContador>(
    () =>
      montarPacoteContador({
        periodo: { mes, ano },
        opcoes,
        empresa,
        receitas,
        gastos,
        contasAPagar,
        contasAReceber,
        clientesPorId,
        fornecedoresPorId,
        getCategoria: (id) => (id ? getCategoriaById(id) : undefined),
        cartoesPorId,
      }),
    [
      mes,
      ano,
      opcoes,
      empresa,
      receitas,
      gastos,
      contasAPagar,
      contasAReceber,
      clientesPorId,
      fornecedoresPorId,
      cartoesPorId,
    ],
  );

  const loading = !ready || loadingForn || loadingCli || loadingEmpresa || loadingCR;

  async function copiarResumo() {
    const texto = gerarResumoTexto(pacote);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        toast.success("Resumo copiado para a área de transferência");
        return;
      }
      throw new Error("clipboard indisponível");
    } catch {
      // Fallback: textarea + execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = texto;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          toast.success("Resumo copiado");
          return;
        }
        throw new Error("execCommand falhou");
      } catch {
        toast.error("Não foi possível copiar automaticamente. Selecione o texto manualmente.");
      }
    }
  }

  function baixarCSV() {
    try {
      const csv = gerarCsvPacote(pacote);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pacote-contador-${ano}-${String(mes).padStart(2, "0")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV gerado");
    } catch {
      toast.error("Não foi possível gerar o CSV");
    }
  }

  function imprimir() {
    window.print();
  }

  const anos: number[] = [];
  for (let y = hoje.getFullYear() + 1; y >= hoje.getFullYear() - 4; y--) {
    anos.push(y);
  }

  return (
    <MobileShell>
      <style>{PRINT_CSS}</style>

      <header className="pt-4 no-print">
        <Link
          to="/empresa"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Empresa Inteligente
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">Pacote para Contador</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Gere um resumo mensal com receitas, despesas, clientes, fornecedores e pendências
                para enviar ao seu contador.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={copiarResumo}>
              <Copy className="h-4 w-4" />
              <span>Copiar resumo</span>
            </Button>
            <Button variant="outline" className="gap-2" onClick={baixarCSV}>
              <Download className="h-4 w-4" />
              <span>Baixar CSV</span>
            </Button>
            <Button className="gap-2" onClick={imprimir}>
              <Printer className="h-4 w-4" />
              <span>Imprimir / Salvar em PDF</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className="no-print mt-6 rounded-2xl border bg-card p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Mês</label>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {nomeMes(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Ano</label>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anos.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ToggleRow
            label="Incluir contas em aberto"
            value={opcoes.incluirEmAberto}
            onChange={(v) => setOpcoes((o) => ({ ...o, incluirEmAberto: v }))}
          />
          <ToggleRow
            label="Incluir resumo por clientes"
            value={opcoes.incluirClientes}
            onChange={(v) => setOpcoes((o) => ({ ...o, incluirClientes: v }))}
          />
          <ToggleRow
            label="Incluir resumo por fornecedores"
            value={opcoes.incluirFornecedores}
            onChange={(v) => setOpcoes((o) => ({ ...o, incluirFornecedores: v }))}
          />
          <ToggleRow
            label="Incluir pendências do mês"
            value={opcoes.incluirPendencias}
            onChange={(v) => setOpcoes((o) => ({ ...o, incluirPendencias: v }))}
          />
          <ToggleRow
            label="Incluir comparativo com mês anterior"
            value={opcoes.incluirComparativo}
            onChange={(v) => setOpcoes((o) => ({ ...o, incluirComparativo: v }))}
          />
        </div>
      </section>

      {/* Cabeçalho do pacote (sempre visível, inclusive impressão) */}
      <section className="mt-6 print-block">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Pacote para Contador
          </p>
          <h2 className="mt-1 text-xl font-semibold">Pacote de {rotuloPeriodo(pacote.periodo)}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gerado em{" "}
            {format(parseISO(pacote.geradoEm), "dd 'de' MMMM 'de' yyyy, HH:mm", {
              locale: ptBR,
            })}
          </p>

          {loading ? (
            <Skeleton className="mt-3 h-16 w-full rounded-xl" />
          ) : empresa ? (
            <div className="mt-3 grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-2">
              <Linha label="Razão social" value={empresa.razao_social} />
              <Linha label="Nome fantasia" value={empresa.nome_fantasia} />
              <Linha label="CNPJ" value={empresa.cnpj} />
              <Linha label="Atividade principal" value={empresa.cnae_principal_descricao} />
              <Linha
                label="Cidade/UF"
                value={
                  empresa.municipio && empresa.uf
                    ? `${empresa.municipio}/${empresa.uf}`
                    : empresa.municipio || empresa.uf
                }
              />
              <Linha label="Situação cadastral" value={empresa.situacao_cadastral} />
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-xs">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                Cadastre sua empresa para deixar o pacote mais completo.{" "}
                <Link to="/empresa" className="underline">
                  Cadastrar agora
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      </section>

      {loading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Resumo financeiro */}
          <section className="mt-6 print-block">
            <h3 className="mb-2 text-sm font-semibold">Resumo financeiro</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Receitas recebidas"
                value={formatBRL(pacote.resumo.totalReceitasRecebidas)}
                accent="primary"
                variacao={variacaoPor(pacote, "receitas")}
              />
              <KpiCard
                icon={<TrendingDown className="h-4 w-4" />}
                label="Despesas pagas"
                value={formatBRL(pacote.resumo.totalDespesasPagas)}
                variacao={variacaoPor(pacote, "despesas")}
              />
              <KpiCard
                icon={<Wallet className="h-4 w-4" />}
                label="Saldo do período"
                value={formatBRL(pacote.resumo.saldoPeriodo)}
                accent={pacote.resumo.saldoPeriodo < 0 ? "warning" : "primary"}
                variacao={variacaoPor(pacote, "saldo")}
              />
              <KpiCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="A receber em aberto"
                value={formatBRL(pacote.resumo.contasReceberEmAberto)}
                variacao={variacaoPor(pacote, "contasReceberEmAberto")}
              />
              <KpiCard
                icon={<TrendingDown className="h-4 w-4" />}
                label="A pagar em aberto"
                value={formatBRL(pacote.resumo.contasPagarEmAberto)}
                accent="warning"
                variacao={variacaoPor(pacote, "contasPagarEmAberto")}
              />
              <KpiCard
                icon={<Users className="h-4 w-4" />}
                label="Clientes movimentados"
                value={String(pacote.resumo.qtdClientesMovimentados)}
                variacao={variacaoPor(pacote, "clientesMovimentados")}
              />
              <KpiCard
                icon={<Truck className="h-4 w-4" />}
                label="Fornecedores movimentados"
                value={String(pacote.resumo.qtdFornecedoresMovimentados)}
                variacao={variacaoPor(pacote, "fornecedoresMovimentados")}
              />
            </div>
          </section>

          {/* Comparativo com mês anterior */}
          {opcoes.incluirComparativo && pacote.comparativo && (
            <section className="mt-6 print-block">
              <h3 className="mb-2 text-sm font-semibold">
                Comparativo com {rotuloPeriodo(pacote.comparativo.periodoAnterior)}
              </h3>
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Indicador</th>
                      <th className="px-2 py-1.5 text-right font-medium">Mês atual</th>
                      <th className="px-2 py-1.5 text-right font-medium">Mês anterior</th>
                      <th className="px-2 py-1.5 text-right font-medium">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacote.comparativo.variacoes.map((v) => (
                      <tr key={v.chave} className="border-t">
                        <td className="px-2 py-1.5">{v.rotulo}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {v.formato === "valor" ? formatBRL(v.atual) : v.atual}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {v.formato === "valor" ? formatBRL(v.anterior) : v.anterior}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <VariacaoBadge v={v} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Receitas */}
          <Secao titulo="Receitas" vazio="Sem receitas no período.">
            {pacote.receitas.length > 0 && (
              <ul className="divide-y rounded-xl border bg-card text-xs">
                {pacote.receitas.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.descricao}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(parseISO(r.data), "dd/MM/yyyy")} · {r.tipoLabel}
                        {r.clienteNome ? ` · ${r.clienteNome}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{formatBRL(r.valor)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          {/* Despesas */}
          <Secao titulo="Despesas / Gastos" vazio="Sem despesas no período.">
            {pacote.gastos.length > 0 && (
              <ul className="divide-y rounded-xl border bg-card text-xs">
                {pacote.gastos.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{g.descricao}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(parseISO(g.data), "dd/MM/yyyy")}
                        {g.categoriaNome ? ` · ${g.categoriaNome}` : ""}
                        {` · ${g.formaPagamento}`}
                        {g.cartaoNome ? ` · ${g.cartaoNome}` : ""}
                        {g.fornecedorNome ? ` · ${g.fornecedorNome}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{formatBRL(g.valor)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          {/* Contas a pagar */}
          <Secao titulo="Contas a pagar" vazio="Sem contas a pagar no período.">
            <ListaContasPagar pacote={pacote} />
          </Secao>

          {/* Contas a receber */}
          <Secao titulo="Contas a receber" vazio="Sem contas a receber no período.">
            <ListaContasReceber pacote={pacote} />
          </Secao>

          {/* Por cliente */}
          {opcoes.incluirClientes && (
            <Secao titulo="Resumo por cliente" vazio="Sem clientes movimentados no período.">
              {pacote.porCliente.length > 0 && (
                <ul className="divide-y rounded-xl border bg-card text-xs">
                  {pacote.porCliente.map((c) => (
                    <li key={c.clienteId} className="flex items-center justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {c.qtdLancamentos} lançamento(s)
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">{formatBRL(c.totalRecebido)}</p>
                        {c.totalEmAberto > 0 && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            Em aberto {formatBRL(c.totalEmAberto)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          )}

          {/* Por fornecedor */}
          {opcoes.incluirFornecedores && (
            <Secao titulo="Resumo por fornecedor" vazio="Sem fornecedores movimentados no período.">
              {pacote.porFornecedor.length > 0 && (
                <ul className="divide-y rounded-xl border bg-card text-xs">
                  {pacote.porFornecedor.map((f) => (
                    <li
                      key={f.fornecedorId}
                      className="flex items-center justify-between gap-2 p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{f.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {f.qtdLancamentos} lançamento(s)
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">{formatBRL(f.totalPago)}</p>
                        {f.totalEmAberto > 0 && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            Em aberto {formatBRL(f.totalEmAberto)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          )}

          {/* Pendências */}
          {opcoes.incluirPendencias && (
            <Secao titulo="Pendências do mês" vazio="Sem pendências no período.">
              <Pendencias pacote={pacote} />
            </Secao>
          )}

          <p className="my-8 text-center text-[11px] text-muted-foreground no-print">
            Fim do pacote — {rotuloPeriodo(pacote.periodo)}
          </p>
        </>
      )}
    </MobileShell>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function Linha({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate font-medium">{value || "—"}</span>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs">
      <span>{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </label>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
  variacao,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "primary" | "warning";
  variacao?: VariacaoIndicador | null;
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
      {variacao && (
        <p className={cn("mt-0.5 truncate text-[10px]", variacaoTextoCor(variacao))}>
          {rotuloVariacao(variacao)}
        </p>
      )}
    </div>
  );
}

function variacaoPor(
  pacote: PacoteContador,
  chave: VariacaoIndicador["chave"],
): VariacaoIndicador | null {
  if (!pacote.comparativo) return null;
  return pacote.comparativo.variacoes.find((v) => v.chave === chave) ?? null;
}

/** Cor textual para badge/legenda de variação.
 *  Receitas: subir é bom (verde). Despesas e contas a pagar: subir é ruim (âmbar).
 *  Demais: neutro. */
function variacaoTextoCor(v: VariacaoIndicador): string {
  if (v.tipo !== "comparavel") return "text-muted-foreground";
  const dif = v.diferenca;
  if (dif === 0) return "text-muted-foreground";
  const subirEhRuim = v.chave === "despesas" || v.chave === "contasPagarEmAberto";
  const subindo = dif > 0;
  const positivo = subirEhRuim ? !subindo : subindo;
  return positivo ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
}

function VariacaoBadge({ v }: { v: VariacaoIndicador }) {
  return (
    <span className={cn("text-[11px] font-medium", variacaoTextoCor(v))}>{rotuloVariacao(v)}</span>
  );
}

function Secao({
  titulo,
  vazio,
  children,
}: {
  titulo: string;
  vazio: string;
  children: React.ReactNode;
}) {
  const hasContent = children !== null && children !== undefined && children !== false;
  return (
    <section className="mt-6 print-block">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      {hasContent ? children : <p className="text-xs text-muted-foreground">{vazio}</p>}
    </section>
  );
}

function StatusBadgePagar({ status }: { status: "pago" | "pendente" | "atrasado" }) {
  if (status === "pago")
    return (
      <Badge variant="secondary" className="text-[10px]">
        Pago
      </Badge>
    );
  if (status === "atrasado")
    return (
      <Badge variant="destructive" className="text-[10px]">
        Atrasado
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px]">
      Pendente
    </Badge>
  );
}

function StatusBadgeReceber({
  status,
}: {
  status: "recebido" | "pendente" | "atrasado" | "parcial" | "cancelado";
}) {
  if (status === "recebido")
    return (
      <Badge variant="secondary" className="text-[10px]">
        Recebido
      </Badge>
    );
  if (status === "parcial")
    return (
      <Badge variant="outline" className="text-[10px]">
        Parcial
      </Badge>
    );
  if (status === "atrasado")
    return (
      <Badge variant="destructive" className="text-[10px]">
        Atrasado
      </Badge>
    );
  if (status === "cancelado")
    return (
      <Badge variant="outline" className="text-[10px]">
        Cancelado
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px]">
      Pendente
    </Badge>
  );
}

function ListaContasPagar({ pacote }: { pacote: PacoteContador }) {
  const { pagas, pendentes, atrasadas } = pacote.contasAPagar;
  const todas = [...atrasadas, ...pendentes, ...pagas];
  if (todas.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem contas a pagar no período.</p>;
  }
  return (
    <ul className="divide-y rounded-xl border bg-card text-xs">
      {todas.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 p-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{c.descricao}</p>
            <p className="text-[11px] text-muted-foreground">
              Venc. {format(parseISO(c.vencimento), "dd/MM/yyyy")}
              {c.fornecedorNome ? ` · ${c.fornecedorNome}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadgePagar status={c.status} />
            <p className="font-semibold tabular-nums">{formatBRL(c.valor)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ListaContasReceber({ pacote }: { pacote: PacoteContador }) {
  const { recebidas, pendentes, atrasadas, parciais } = pacote.contasAReceber;
  const todas = [...atrasadas, ...parciais, ...pendentes, ...recebidas];
  if (todas.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem contas a receber no período.</p>;
  }
  return (
    <ul className="divide-y rounded-xl border bg-card text-xs">
      {todas.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 p-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{c.descricao}</p>
            <p className="text-[11px] text-muted-foreground">
              Previsto {format(parseISO(c.dataPrevista), "dd/MM/yyyy")}
              {c.clienteNome ? ` · ${c.clienteNome}` : ""}
              {c.status === "parcial" ? ` · Restante ${formatBRL(c.valorRestante)}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadgeReceber status={c.status} />
            <p className="font-semibold tabular-nums">{formatBRL(c.valor)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Pendencias({ pacote }: { pacote: PacoteContador }) {
  const p = pacote.pendencias;
  const items: Array<{ key: string; texto: string; tipo: "alerta" | "ok" }> = [];
  if (p.empresaNaoCadastrada) {
    items.push({
      key: "empresa",
      texto: "Empresa ainda não cadastrada em Minha Empresa.",
      tipo: "alerta",
    });
  }
  if (p.contasPagarAtrasadas.length > 0) {
    items.push({
      key: "cp",
      texto: `${p.contasPagarAtrasadas.length} conta(s) a pagar atrasada(s).`,
      tipo: "alerta",
    });
  }
  if (p.contasReceberAtrasadas.length > 0) {
    items.push({
      key: "cr",
      texto: `${p.contasReceberAtrasadas.length} conta(s) a receber atrasada(s).`,
      tipo: "alerta",
    });
  }
  if (p.qtdReceitasSemCliente > 0) {
    items.push({
      key: "rsc",
      texto: `${p.qtdReceitasSemCliente} receita(s) sem cliente vinculado.`,
      tipo: "alerta",
    });
  }
  if (p.qtdGastosSemFornecedor > 0) {
    items.push({
      key: "gsf",
      texto: `${p.qtdGastosSemFornecedor} gasto(s) sem fornecedor vinculado.`,
      tipo: "alerta",
    });
  }
  if (p.qtdLancamentosSemCategoria > 0) {
    items.push({
      key: "sc",
      texto: `${p.qtdLancamentosSemCategoria} lançamento(s) sem categoria.`,
      tipo: "alerta",
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-3 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span>Tudo certo neste mês. Sem pendências encontradas.</span>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((it) => (
        <li key={it.key} className="flex items-start gap-2 rounded-lg border bg-card p-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{it.texto}</span>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// CSS de impressão
// ============================================================

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: #fff !important; }
  .no-print, nav, aside, [data-mobile-shell-header], [role="banner"], button { display: none !important; }
  .lg\\:pl-64 { padding-left: 0 !important; }
  [data-mobile-shell] { padding: 0 !important; max-width: 100% !important; }
  main, section, div { max-width: 100% !important; }
  .print-block { break-inside: avoid; page-break-inside: avoid; }
  .rounded-2xl, .rounded-xl, .rounded-lg { border-radius: 4px !important; }
  .border { border-color: #d4d4d8 !important; }
  .bg-card, .bg-muted\\/30, .bg-primary\\/10, .bg-amber-500\\/10 { background: #fff !important; }
  .shadow-sm, .shadow { box-shadow: none !important; }
  * { color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .text-muted-foreground, .text-amber-600, .text-emerald-600, .text-amber-400 { color: #555 !important; }
  ul, li, h1, h2, h3 { page-break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  /* Conteúdo fluído na largura total */
  body * { font-size: 11pt; }
  h1 { font-size: 16pt !important; }
  h2 { font-size: 14pt !important; }
  h3 { font-size: 12pt !important; }
}
`;
