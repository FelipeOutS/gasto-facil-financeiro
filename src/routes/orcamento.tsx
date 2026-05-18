import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PieChart as PieChartIcon,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Pencil,
  Plus,
  Copy,
  Trash2,
  Sparkles,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import {
  getCategorias,
  getGastos,
  getLimite,
  getLimites,
  mesEfetivoGasto,
  setLimite,
  useBootstrap,
  useStore,
} from "@/lib/store";
import {
  buildLinhasOrcamento,
  resumirOrcamento,
  type StatusOrcamento,
} from "@/lib/orcamento";
import { formatBRL, formatMonthYear, parseBRLInput } from "@/lib/format";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/orcamento")({
  head: () => ({
    meta: [
      { title: "Orçamento — Gasto Inteligente" },
      {
        name: "description",
        content: "Acompanhe seu orçamento mensal por categoria.",
      },
    ],
  }),
  component: OrcamentoPage,
});

function OrcamentoPage() {
  const ready = useBootstrap();
  const { profile } = useAuth();
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const today = new Date();
  const [ym, setYm] = useState({ ano: today.getFullYear(), mes: today.getMonth() + 1 });

  const categorias = useStore(() => getCategorias());
  const gastos = useStore(() => getGastos());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));
  // Re-render quando limites mudam (qualquer setLimite)
  useStore(() => getLimites().length);

  const linhas = useMemo(
    () =>
      buildLinhasOrcamento(categorias, gastos, ym.mes, ym.ano, (catId) =>
        getLimite(catId, ym.mes, ym.ano),
        mesEfetivoGasto,
      ),
    [categorias, gastos, ym],
  );

  const resumo = useMemo(() => resumirOrcamento(linhas), [linhas]);
  const {
    comLimite,
    semLimiteComGasto,
    totalPlanejado,
    totalRealizado,
    diff,
    pctGeral,
    qtdAtencao,
    qtdEstouro,
    qtdOk,
    temOrcamento,
  } = resumo;

  // Edit limit dialog
  const [editing, setEditing] = useState<{ id: string; nome: string; valor: string } | null>(
    null,
  );

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  function openEdit(catId: string, nome: string) {
    const atual = getLimite(catId, ym.mes, ym.ano) ?? 0;
    setEditing({
      id: catId,
      nome,
      valor: atual > 0 ? String(atual).replace(".", ",") : "",
    });
  }

  function saveEdit() {
    if (!editing) return;
    const v = parseBRLInput(editing.valor);
    setLimite(editing.id, v, ym.mes, ym.ano);
    toast.success(v > 0 ? `Limite de ${formatBRL(v)} salvo. ✅` : "Limite removido.");
    setEditing(null);
  }

  function removerLimite(catId: string, nome: string) {
    setLimite(catId, 0, ym.mes, ym.ano);
    toast.success(`Orçamento de ${nome} removido.`);
  }

  function copiarMesAnterior() {
    const anterior = new Date(ym.ano, ym.mes - 2, 1);
    const ma = anterior.getMonth() + 1;
    const aa = anterior.getFullYear();
    const limitesAnteriores = getLimites().filter((l) => l.mes === ma && l.ano === aa);
    if (limitesAnteriores.length === 0) {
      toast.error("O mês anterior não tem orçamento para copiar.");
      return;
    }
    let copiados = 0;
    for (const l of limitesAnteriores) {
      // Só copia se o mês atual ainda não tem aquele tipo configurado
      const atual = getLimite(l.tipo, ym.mes, ym.ano);
      if (!atual || atual <= 0) {
        setLimite(l.tipo, l.valor, ym.mes, ym.ano);
        copiados += 1;
      }
    }
    toast.success(
      copiados > 0
        ? `${copiados} limite(s) copiado(s) do mês anterior.`
        : "Os limites do mês anterior já estavam aplicados.",
    );
  }

  if (!ready) return <PageSkeleton wide />;

  return (
    <MobileShell wide>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {vocab.orcamentoTitle}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold capitalize tracking-tight lg:text-[26px]">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
          <p className="mt-1 hidden text-xs text-muted-foreground lg:block">
            {vocab.orcamentoSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Estado vazio: nenhum limite configurado neste mês */}
      {!temOrcamento && (limiteTotal ?? 0) <= 0 && (
        <section className="mt-6 rounded-3xl border border-dashed border-border bg-card p-8 text-center animate-rise">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand">
            <PieChartIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold">Crie seu primeiro orçamento</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Defina limites por categoria e acompanhe para onde seu dinheiro está indo.
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button
              onClick={() => openEdit("total", "Limite total")}
              className="h-11 rounded-full px-5"
            >
              <Plus className="mr-1 h-4 w-4" />
              Criar orçamento
            </Button>
            <Button
              variant="outline"
              onClick={copiarMesAnterior}
              className="h-11 rounded-full px-5"
            >
              <Copy className="mr-1 h-4 w-4" />
              Copiar do mês anterior
            </Button>
          </div>
        </section>
      )}

      {/* Resumo superior — só quando já existe algum orçamento ou limite total */}
      {(temOrcamento || (limiteTotal ?? 0) > 0) && (
        <section className="mt-5 grid grid-cols-2 gap-2.5 stagger lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-3.5 hover-lift card-press animate-rise">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Planejado
            </p>
            <Money
              value={totalPlanejado}
              className="num mt-1.5 block text-lg font-bold lg:text-xl"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {comLimite.length} categoria(s)
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3.5 hover-lift card-press animate-rise">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Gasto
            </p>
            <Money
              value={totalRealizado}
              className="num mt-1.5 block text-lg font-bold lg:text-xl"
            />
            {totalPlanejado > 0 && (
              <p className="num mt-0.5 text-[10px] text-muted-foreground">
                {Math.round(pctGeral)}% do plano
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-card p-3.5 hover-lift card-press animate-rise">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {diff >= 0 ? "Restante" : "Excesso"}
            </p>
            <Money
              value={Math.abs(diff)}
              className={cn(
                "num mt-1.5 block text-lg font-bold lg:text-xl",
                diff < 0 && "text-destructive",
              )}
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {diff >= 0 ? "abaixo do plano" : "acima do plano"}
            </p>
          </div>
          <div
            className={cn(
              "rounded-2xl border p-3.5 hover-lift animate-rise",
              qtdEstouro > 0
                ? "border-destructive/40 bg-destructive/10"
                : qtdAtencao > 0
                  ? "border-warning/40 bg-warning/10"
                  : "border-success/30 bg-success/10",
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              {qtdEstouro > 0 ? (
                <AlertTriangle className="h-4 w-4 text-destructive animate-pulse-soft" />
              ) : qtdAtencao > 0 ? (
                <AlertTriangle className="h-4 w-4 text-warning" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
              <p className="text-sm font-semibold">
                {qtdEstouro > 0
                  ? "Fora do plano"
                  : qtdAtencao > 0
                    ? "Atenção"
                    : "Tudo certo"}
              </p>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {qtdOk} ok · {qtdAtencao} atenção · {qtdEstouro} estourada(s)
            </p>
          </div>
        </section>
      )}

      {/* Limite total + ações rápidas (só se já há algo configurado) */}
      {(temOrcamento || (limiteTotal ?? 0) > 0) && (
        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Limite mensal total</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copiarMesAnterior}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                Copiar mês anterior
              </button>
              <button
                type="button"
                onClick={() => openEdit("total", "Limite total")}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
                Editar
              </button>
            </div>
          </div>
          {limiteTotal && limiteTotal > 0 ? (
            <>
              <div className="mt-3 flex items-baseline justify-between">
                <p className="num text-xl font-bold">{formatBRL(totalRealizado)}</p>
                <p className="num text-xs text-muted-foreground">
                  de {formatBRL(limiteTotal)}
                </p>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
                <div
                  className={cn(
                    "h-full rounded-full transition-all animate-fill",
                    totalRealizado >= limiteTotal
                      ? "bg-destructive"
                      : totalRealizado >= limiteTotal * 0.7
                        ? "bg-warning"
                        : "bg-brand",
                  )}
                  style={{
                    width: `${Math.min(100, (totalRealizado / limiteTotal) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Sem limite total este mês. Você pode definir só por categoria, se preferir.
            </p>
          )}
        </section>
      )}

      {/* Lista por categoria com limite */}
      {comLimite.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Por categoria
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {comLimite.length}{" "}
              {comLimite.length === 1 ? "categoria" : "categorias"}
            </span>
          </div>

          <ul className="space-y-2 stagger">
            {comLimite.map((l) => {
              const pct = Math.min(150, l.pct);
              const corBarra =
                l.status === "estouro"
                  ? "bg-destructive"
                  : l.status === "atencao"
                    ? "bg-warning"
                    : "bg-brand";
              return (
                <li
                  key={l.cat.id}
                  className="hover-lift rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-brand/40 hover:bg-card-elevated"
                >
                  <div className="flex items-center gap-3">
                    <CategoryIcon categoria={l.cat} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{l.cat.nome}</p>
                        <p className="num shrink-0 text-sm font-semibold">
                          {formatBRL(l.realizado)}
                          <span className="ml-1 font-normal text-muted-foreground">
                            / {formatBRL(l.planejado)}
                          </span>
                        </p>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-elevated">
                          <div
                            className={cn(
                              "h-full transition-all animate-fill",
                              corBarra,
                            )}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "shrink-0 text-[10px] font-medium num",
                            l.status === "estouro" && "text-destructive",
                            l.status === "atencao" && "text-warning",
                            l.status === "ok" && "text-brand",
                          )}
                        >
                          {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-[10px]",
                            l.status === "estouro" && "text-destructive",
                            l.status === "atencao" && "text-warning",
                            l.status === "ok" && "text-brand",
                          )}
                        >
                          {l.status === "estouro"
                            ? `Estourou em ${formatBRL(Math.abs(l.restante))}`
                            : l.status === "atencao"
                              ? `Restam ${formatBRL(l.restante)}`
                              : `Restam ${formatBRL(l.restante)}`}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(l.cat.id, l.cat.nome)}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-brand transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => removerLimite(l.cat.id, l.cat.nome)}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={`Remover orçamento de ${l.cat.nome}`}
                          >
                            <Trash2 className="h-3 w-3" />
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Categorias sem limite definido (mas com gasto no mês) */}
      {semLimiteComGasto.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Categorias sem limite definido
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {semLimiteComGasto.length}
            </span>
          </div>
          <ul className="space-y-2 stagger">
            {semLimiteComGasto.map((l) => (
              <li
                key={l.cat.id}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-3 transition-colors hover:bg-card-elevated"
              >
                <CategoryIcon categoria={l.cat} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{l.cat.nome}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {formatBRL(l.realizado)} gastos · sem limite definido
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 rounded-full text-xs"
                  onClick={() => openEdit(l.cat.id, l.cat.nome)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Definir limite
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Adicionar categoria ao orçamento — sempre visível quando há orçamento */}
      {temOrcamento && (
        <section className="mt-5 rounded-2xl border border-dashed border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Adicionar mais uma categoria</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Defina limites para outras categorias para acompanhar tudo.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {linhas
                  .filter((l) => l.planejado === 0 && l.realizado === 0)
                  .slice(0, 6)
                  .map((l) => (
                    <button
                      key={l.cat.id}
                      type="button"
                      onClick={() => openEdit(l.cat.id, l.cat.nome)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-brand/40"
                    >
                      <Plus className="h-3 w-3" />
                      {l.cat.nome}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <TrendingUp className="h-3 w-3" />
        Defina um limite e acompanhe sem dor de cabeça — você pode planejar diferente a cada mês.
      </p>

      {/* Dialog editar limite */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id === "total" ? "Limite mensal total" : `Limite — ${editing?.nome}`}
            </DialogTitle>
            <DialogDescription>
              Defina quanto pretende gastar com{" "}
              {editing?.id === "total" ? "tudo" : "esta categoria"} em{" "}
              {formatMonthYear(ym.ano, ym.mes)}. Deixe em branco para remover.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs text-muted-foreground">Valor</Label>
            <div className="mt-1 flex items-baseline gap-2 rounded-xl bg-card-elevated px-3">
              <span className="text-sm font-semibold text-muted-foreground">R$</span>
              <Input
                inputMode="decimal"
                value={editing?.valor ?? ""}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, valor: e.target.value } : cur))
                }
                placeholder="0,00"
                className="num h-11 border-0 bg-transparent p-0 text-lg font-semibold !ring-0 focus-visible:!ring-0"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* hint visual reuso categoryColor para evitar warning */}
      <span className="hidden">{categoryColor(undefined)}</span>
    </MobileShell>
  );
}
