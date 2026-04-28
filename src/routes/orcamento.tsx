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
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";
import {
  getCategorias,
  getGastos,
  getLimite,
  setLimite,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatMonthYear, parseBRLInput } from "@/lib/format";
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

export const Route = createFileRoute("/orcamento")({
  head: () => ({
    meta: [
      { title: "Orçamento — Gasto Fácil" },
      {
        name: "description",
        content: "Acompanhe seu orçamento mensal por categoria.",
      },
    ],
  }),
  component: OrcamentoPage,
});

type Status = "ok" | "alerta" | "estouro" | "sem_limite";

function statusFor(realizado: number, planejado: number): Status {
  if (planejado <= 0) return "sem_limite";
  const pct = realizado / planejado;
  if (pct >= 1) return "estouro";
  if (pct >= 0.8) return "alerta";
  return "ok";
}

function statusLabel(s: Status): string {
  return s === "ok"
    ? "Tudo certo"
    : s === "alerta"
      ? "Quase no limite"
      : s === "estouro"
        ? "Passou do limite"
        : "Sem limite";
}

function OrcamentoPage() {
  const ready = useBootstrap();
  const today = new Date();
  const [ym, setYm] = useState({ ano: today.getFullYear(), mes: today.getMonth() + 1 });

  const categorias = useStore(() => getCategorias());
  const gastos = useStore(() => getGastos());
  const limiteTotal = useStore(() => getLimite("total", ym.mes, ym.ano));
  // Re-render quando limites mudam (qualquer setLimite)
  useStore(() => gastos.length + categorias.length);

  const doMes = useMemo(
    () => gastos.filter((g) => g.mes === ym.mes && g.ano === ym.ano),
    [gastos, ym],
  );

  const realizadoPorCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of doMes) {
      map.set(g.categoriaId, (map.get(g.categoriaId) ?? 0) + g.valor);
    }
    return map;
  }, [doMes]);

  const linhas = useMemo(() => {
    return categorias
      .map((c) => {
        const realizado = realizadoPorCat.get(c.id) ?? 0;
        const planejado = getLimite(c.id, ym.mes, ym.ano) ?? 0;
        return {
          cat: c,
          realizado,
          planejado,
          status: statusFor(realizado, planejado),
        };
      })
      .sort((a, b) => {
        // Categorias com limite primeiro, depois com gasto, depois resto
        const sa = a.planejado > 0 ? 0 : a.realizado > 0 ? 1 : 2;
        const sb = b.planejado > 0 ? 0 : b.realizado > 0 ? 1 : 2;
        if (sa !== sb) return sa - sb;
        return b.realizado - a.realizado;
      });
  }, [categorias, realizadoPorCat, ym]);

  const totalPlanejado = linhas.reduce((s, l) => s + l.planejado, 0);
  const totalRealizado = linhas.reduce((s, l) => s + l.realizado, 0);
  const diff = totalPlanejado - totalRealizado;

  const comLimite = linhas.filter((l) => l.planejado > 0);
  const estourados = comLimite.filter((l) => l.status === "estouro").length;
  const alertas = comLimite.filter((l) => l.status === "alerta").length;

  // Edit limit dialog
  const [editing, setEditing] = useState<{ id: string; nome: string; valor: string } | null>(null);

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
    toast.success(v > 0 ? `Limite de ${formatBRL(v)} salvo` : "Limite removido");
    setEditing(null);
  }

  if (!ready) return <MobileShell wide><div /></MobileShell>;

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
            Orçamento
          </p>
          <h1 className="mt-0.5 text-2xl font-bold capitalize tracking-tight lg:text-[26px]">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
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

      {/* Resumo superior */}
      <section className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Planejado
          </p>
          <p className="num mt-1.5 text-lg font-bold lg:text-xl">
            {formatBRL(totalPlanejado)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {comLimite.length} categoria(s)
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Realizado
          </p>
          <p className="num mt-1.5 text-lg font-bold lg:text-xl">
            {formatBRL(totalRealizado)}
          </p>
          {totalPlanejado > 0 && (
            <p className="num mt-0.5 text-[10px] text-muted-foreground">
              {Math.round((totalRealizado / totalPlanejado) * 100)}% do plano
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {diff >= 0 ? "Economia" : "Excesso"}
          </p>
          <p
            className={cn(
              "num mt-1.5 text-lg font-bold lg:text-xl",
              diff < 0 && "text-destructive",
            )}
          >
            {formatBRL(Math.abs(diff))}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {diff >= 0 ? "abaixo do plano" : "acima do plano"}
          </p>
        </div>
        <div
          className={cn(
            "rounded-2xl border p-3.5",
            estourados > 0
              ? "border-destructive/40 bg-destructive/10"
              : alertas > 0
                ? "border-warning/40 bg-warning/10"
                : "border-success/30 bg-success/10",
          )}
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            {estourados > 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : alertas > 0 ? (
              <AlertTriangle className="h-4 w-4 text-warning" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
            <p className="text-sm font-semibold">
              {estourados > 0
                ? "Fora do plano"
                : alertas > 0
                  ? "Atenção"
                  : "Tudo certo"}
            </p>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {estourados} estourada(s) · {alertas} próxima(s)
          </p>
        </div>
      </section>

      {/* Limite total */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Limite mensal total</h2>
          </div>
          <button
            type="button"
            onClick={() => openEdit("total", "Limite total")}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Editar
          </button>
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
                  "h-full rounded-full transition-all",
                  totalRealizado > limiteTotal
                    ? "bg-destructive"
                    : totalRealizado >= limiteTotal * 0.8
                      ? "bg-warning"
                      : "bg-success",
                )}
                style={{
                  width: `${Math.min(100, (totalRealizado / limiteTotal) * 100)}%`,
                }}
              />
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Defina um limite total para este mês para acompanhar seu progresso geral.
          </p>
        )}
      </section>

      {/* Lista por categoria */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Por categoria
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {linhas.length} {linhas.length === 1 ? "categoria" : "categorias"}
          </span>
        </div>

        <ul className="space-y-2">
          {linhas.map((l) => {
            const pct =
              l.planejado > 0 ? Math.min(150, (l.realizado / l.planejado) * 100) : 0;
            const corBarra =
              l.status === "estouro"
                ? "bg-destructive"
                : l.status === "alerta"
                  ? "bg-warning"
                  : l.status === "ok"
                    ? "bg-success"
                    : "bg-muted-foreground/30";
            return (
              <li
                key={l.cat.id}
                className="rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-card-elevated"
              >
                <div className="flex items-center gap-3">
                  <CategoryIcon categoria={l.cat} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{l.cat.nome}</p>
                      <p className="num shrink-0 text-sm font-semibold">
                        {formatBRL(l.realizado)}
                        {l.planejado > 0 && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            / {formatBRL(l.planejado)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-elevated">
                        <div
                          className={cn("h-full transition-all", corBarra)}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-medium",
                          l.status === "estouro" && "text-destructive",
                          l.status === "alerta" && "text-warning",
                          l.status === "ok" && "text-success",
                          l.status === "sem_limite" && "text-muted-foreground",
                        )}
                      >
                        {l.planejado > 0 ? `${Math.round(pct)}%` : "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[10px]",
                          l.status === "estouro" && "text-destructive",
                          l.status === "alerta" && "text-warning",
                          l.status === "ok" && "text-success",
                          l.status === "sem_limite" && "text-muted-foreground",
                        )}
                      >
                        {statusLabel(l.status)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEdit(l.cat.id, l.cat.nome)}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                        Definir limite
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <TrendingUp className="h-3 w-3" />
        Os limites são salvos por mês — você pode planejar diferente a cada período.
      </p>

      {/* Dialog editar limite */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id === "total" ? "Limite mensal total" : `Limite — ${editing?.nome}`}
            </DialogTitle>
            <DialogDescription>
              Defina quanto pretende gastar com {editing?.id === "total" ? "tudo" : "esta categoria"} em{" "}
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
