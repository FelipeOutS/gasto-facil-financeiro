import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  Repeat,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import {
  addReceita,
  deleteReceita,
  deleteReceitaRecorrencia,
  getReceitas,
  updateReceita,
  useBootstrap,
  useStore,
  type UpdateReceitaScope,
} from "@/lib/store";
import { TIPOS_RECEITA, type Receita, type TipoReceita } from "@/lib/types";
import {
  formatBRL,
  formatDateBR,
  formatMonthYear,
  parseBRLInput,
  todayISO,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

type RendaSearch = { ano?: number; mes?: number };

const MONTH_NAMES_PT = [
  "janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function normalizeDescricao(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const Route = createFileRoute("/renda")({
  head: () => ({ meta: [{ title: "Minha renda — Gasto Fácil" }] }),
  validateSearch: (search: Record<string, unknown>): RendaSearch => {
    const ano = Number(search.ano);
    const mes = Number(search.mes);
    return {
      ano: Number.isFinite(ano) && ano > 2000 ? ano : undefined,
      mes: Number.isFinite(mes) && mes >= 1 && mes <= 12 ? mes : undefined,
    };
  },
  component: RendaPage,
});

function RendaPage() {
  const ready = useBootstrap();
  const receitas = useStore(() => getReceitas());
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/renda" });

  const today = new Date();
  const [ym, setYm] = useState({
    ano: search.ano ?? today.getFullYear(),
    mes: search.mes ?? today.getMonth() + 1,
  });

  // Sincroniza URL quando o mês muda (sem disparar loop)
  useEffect(() => {
    void navigate({ search: { ano: ym.ano, mes: ym.mes }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym.ano, ym.mes]);

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  const doMes = useMemo(
    () => receitas.filter((r) => r.mes === ym.mes && r.ano === ym.ano),
    [receitas, ym.mes, ym.ano],
  );
  const totalMes = useMemo(() => doMes.reduce((s, r) => s + r.valor, 0), [doMes]);
  const salarioMes = useMemo(
    () => doMes.filter((r) => r.tipo === "salario").reduce((s, r) => s + r.valor, 0),
    [doMes],
  );
  const outrasMes = totalMes - salarioMes;

  // ---------- Histórico (todas, agrupadas por mês desc) ----------
  const historico = useMemo(() => {
    const groups = new Map<string, { ano: number; mes: number; itens: Receita[] }>();
    for (const r of receitas) {
      const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
      const g = groups.get(key);
      if (g) g.itens.push(r);
      else groups.set(key, { ano: r.ano, mes: r.mes, itens: [r] });
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.ano !== b.ano ? b.ano - a.ano : b.mes - a.mes,
    );
  }, [receitas]);

  // ---------- Nova entrada ----------
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoReceita>("salario");
  const [recorrente, setRecorrente] = useState(true);
  const [meses, setMeses] = useState(12);
  type NovaPayload = {
    descricao: string;
    valor: number;
    data: string;
    tipo: TipoReceita;
    recorrente: boolean;
    recorrenteMeses?: number;
  };
  const [confirmDup, setConfirmDup] = useState<null | {
    parecida: Receita;
    payload: NovaPayload;
  }>(null);

  function reset() {
    setDescricao("");
    setValorStr("");
    setData(todayISO());
    setTipo("salario");
    setRecorrente(true);
    setMeses(12);
  }

  function persistNova(payload: NovaPayload) {
    addReceita(payload);
    toast.success("Renda adicionada. Boa! 💸");
    setOpen(false);
    reset();
  }

  function handleSave() {
    const valor = parseBRLInput(valorStr);
    const desc = descricao.trim();
    if (!valor || !desc) {
      toast.error("Preencha a descrição e o valor.");
      return;
    }
    const dt = new Date(data + "T12:00:00");
    const mesNova = dt.getMonth() + 1;
    const anoNova = dt.getFullYear();
    const descNorm = normalizeDescricao(desc);

    const parecida = receitas.find((r) => {
      if (r.mes !== mesNova || r.ano !== anoNova) return false;
      if (r.tipo !== tipo) return false;
      const rDesc = normalizeDescricao(r.descricao);
      const descMatch =
        rDesc === descNorm || rDesc.includes(descNorm) || descNorm.includes(rDesc);
      const valorMatch = Math.abs(r.valor - valor) <= Math.max(1, valor * 0.05);
      return descMatch && valorMatch;
    });

    const payload: NovaPayload = {
      descricao: desc,
      valor,
      data,
      tipo,
      recorrente,
      recorrenteMeses: recorrente ? meses : undefined,
    };

    if (parecida) {
      setConfirmDup({ parecida, payload });
      return;
    }
    persistNova(payload);
  }


  // ---------- Editar / Excluir ----------
  const [editTarget, setEditTarget] = useState<Receita | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Receita | null>(null);

  // ---------- Histórico: busca + carregar mais ----------
  const [historicoQuery, setHistoricoQuery] = useState("");
  const [historicoLimit, setHistoricoLimit] = useState(3);

  const historicoFiltrado = useMemo(() => {
    const q = normalizeDescricao(historicoQuery);
    if (!q) return historico;
    const qNum = Number(q.replace(",", "."));
    return historico
      .map((g) => {
        const monthName = MONTH_NAMES_PT[g.mes] ?? "";
        const matchMes = monthName.includes(q) || String(g.mes) === q;
        const matchAno = String(g.ano).includes(q);
        if (matchMes || matchAno) return g;
        const itens = g.itens.filter((r) => {
          const desc = normalizeDescricao(r.descricao);
          const tipoLabel = normalizeDescricao(
            TIPOS_RECEITA.find((t) => t.id === r.tipo)?.label ?? "",
          );
          if (desc.includes(q)) return true;
          if (tipoLabel.includes(q)) return true;
          if (Number.isFinite(qNum) && qNum > 0 && Math.abs(r.valor - qNum) < 0.01) return true;
          return false;
        });
        return itens.length > 0 ? { ...g, itens } : null;
      })
      .filter((g): g is { ano: number; mes: number; itens: Receita[] } => g !== null);
  }, [historico, historicoQuery]);

  const historicoVisivel = useMemo(
    () => historicoFiltrado.slice(0, historicoLimit),
    [historicoFiltrado, historicoLimit],
  );

  if (!ready) return <MobileShell><div /></MobileShell>;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Entradas</p>
          <h1 className="text-2xl font-bold tracking-tight">Minha renda</h1>
        </div>
      </header>

      {/* Navegação de mês */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card px-2 py-2">
        <button
          onClick={() => changeMonth(-1)}
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold capitalize">
          {formatMonthYear(ym.ano, ym.mes)}
        </p>
        <button
          onClick={() => changeMonth(1)}
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <section className="mt-3 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-xs font-medium text-muted-foreground">Total de entradas no mês</p>
        <p className="num mt-1 text-4xl font-extrabold tracking-tight">{formatBRL(totalMes)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Salário</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(salarioMes)}</p>
          </div>
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Outras entradas</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(outrasMes)}</p>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogTrigger asChild>
          <Button size="lg" className="card-press mt-4 h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95">
            <Plus className="mr-1 h-5 w-5" />
            Nova entrada
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova entrada de dinheiro</DialogTitle>
            <DialogDescription>Salário, freelance, comissão e mais.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Descrição</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: Salário do mês"
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Valor</Label>
                <Input
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                  placeholder="0,00"
                  className="num mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Data</Label>
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
                <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEITA.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
              <div>
                <p className="text-sm font-medium">Repetir todo mês</p>
                <p className="text-xs text-muted-foreground">Entrada recorrente</p>
              </div>
              <Switch checked={recorrente} onCheckedChange={setRecorrente} />
            </div>
            {recorrente && (
              <div>
                <Label className="text-xs text-muted-foreground">Repetir por (meses)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={meses}
                  onChange={(e) => setMeses(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabs: Este mês / Histórico */}
      <Tabs defaultValue="mes" className="mt-5">
        <TabsList className="grid w-full grid-cols-2 bg-card">
          <TabsTrigger value="mes">Este mês</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="mes" className="mt-3">
          {doMes.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground animate-fade-in">
              <p className="font-medium text-foreground">Sem rendas neste mês ainda.</p>
              <p className="mt-1 text-xs">
                Adicione seu salário e outras entradas para o seu resumo ficar completo.
              </p>
              <div className="mt-3">
                <Button size="sm" onClick={() => setOpen(true)} className="card-press">
                  <Plus className="mr-1 h-4 w-4" /> Adicionar renda
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2 stagger">
              {doMes.map((r) => (
                <ReceitaItem
                  key={r.id}
                  r={r}
                  onEdit={() => setEditTarget(r)}
                  onDelete={() => setDeleteTarget(r)}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="historico" className="mt-3 space-y-3">
          {historico.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground animate-fade-in">
              Seu histórico ainda está em branco. Quando você cadastrar rendas, elas aparecem aqui por mês.
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={historicoQuery}
                  onChange={(e) => {
                    setHistoricoQuery(e.target.value);
                    setHistoricoLimit(3);
                  }}
                  placeholder="Buscar por descrição, tipo, mês, ano ou valor"
                  className="h-11 bg-card-elevated pl-9"
                />
              </div>

              {historicoFiltrado.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                  Nenhum resultado para “{historicoQuery}”.
                </div>
              ) : (
                <>
                  <div className="space-y-5">
                    {historicoVisivel.map((g) => {
                      const total = g.itens.reduce((s, r) => s + r.valor, 0);
                      return (
                        <div key={`${g.ano}-${g.mes}`}>
                          <div className="mb-2 flex items-baseline justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {formatMonthYear(g.ano, g.mes)}
                            </p>
                            <p className="num text-xs font-semibold text-success">
                              {formatBRL(total)}
                            </p>
                          </div>
                          <ul className="space-y-2">
                            {g.itens.map((r) => (
                              <ReceitaItem
                                key={r.id}
                                r={r}
                                onEdit={() => setEditTarget(r)}
                                onDelete={() => setDeleteTarget(r)}
                              />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>

                  {historicoFiltrado.length > historicoVisivel.length && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setHistoricoLimit((n) => n + 3)}
                    >
                      Carregar mais
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <EditReceitaDialog receita={editTarget} onClose={() => setEditTarget(null)} />
      <DeleteReceitaDialog receita={deleteTarget} onClose={() => setDeleteTarget(null)} />

      <AlertDialog
        open={!!confirmDup}
        onOpenChange={(o) => { if (!o) setConfirmDup(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renda parecida encontrada</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe uma renda parecida neste mês:{" "}
              <span className="font-medium text-foreground">
                {confirmDup?.parecida.descricao}
              </span>{" "}
              de{" "}
              <span className="num font-medium text-foreground">
                {confirmDup ? formatBRL(confirmDup.parecida.valor) : ""}
              </span>
              . Deseja salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDup) persistNova(confirmDup.payload);
                setConfirmDup(null);
              }}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

// =====================================================================
// Item de receita
// =====================================================================
function ReceitaItem({
  r,
  onEdit,
  onDelete,
}: {
  r: Receita;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tipoLabel = TIPOS_RECEITA.find((t) => t.id === r.tipo)?.label;
  return (
    <li className="flex items-center gap-2 overflow-hidden rounded-2xl border border-border bg-card px-3 py-3">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Editar ${r.descricao}`}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          {r.recorrente ? <Repeat className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{r.descricao}</p>
          <p className="truncate text-xs text-muted-foreground">
            {tipoLabel} · {formatDateBR(r.data)}
            {r.recorrente ? " · recorrente" : ""}
          </p>
          <p className="num mt-0.5 text-sm font-semibold text-success">
            +{formatBRL(r.valor)}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
          aria-label="Editar"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-destructive"
          aria-label="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

// =====================================================================
// Diálogo de edição
// =====================================================================
function EditReceitaDialog({
  receita,
  onClose,
}: {
  receita: Receita | null;
  onClose: () => void;
}) {
  const open = !!receita;
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoReceita>("salario");
  const [scope, setScope] = useState<UpdateReceitaScope>("single");

  useEffect(() => {
    if (receita) {
      setDescricao(receita.descricao);
      setValorStr(receita.valor.toFixed(2).replace(".", ","));
      setData(receita.data);
      setTipo(receita.tipo);
      setScope("single");
    }
  }, [receita]);

  function handleSave() {
    if (!receita) return;
    const valor = parseBRLInput(valorStr);
    if (!valor || !descricao.trim()) {
      toast.error("Preencha a descrição e o valor.");
      return;
    }
    updateReceita(
      receita.id,
      { descricao: descricao.trim(), valor, data, tipo },
      receita.recorrente && receita.recorrenciaId ? scope : "single",
    );
    toast.success("Renda atualizada. ✅");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar renda</DialogTitle>
          <DialogDescription>Altere os detalhes desta entrada.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Descrição</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Valor</Label>
              <Input
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                className="num mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Data</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
              <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_RECEITA.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {receita?.recorrente && receita.recorrenciaId && (
            <div className="rounded-xl border border-border bg-card-elevated p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Esta é uma renda recorrente. Como aplicar a alteração?
              </p>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as UpdateReceitaScope)}
                className="mt-2 space-y-2"
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="single" id="scope-single" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Alterar somente este mês</span>
                    <span className="block text-xs text-muted-foreground">
                      Não muda os outros meses.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="forward" id="scope-forward" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Alterar este mês e os próximos</span>
                    <span className="block text-xs text-muted-foreground">
                      Preserva o histórico anterior.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="all" id="scope-all" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Alterar toda a recorrência</span>
                    <span className="block text-xs text-muted-foreground">
                      Atualiza todos os meses ligados a esta renda.
                    </span>
                  </span>
                </label>
              </RadioGroup>
              <p className="mt-2 text-[11px] text-muted-foreground">
                A nova data informada acima só é aplicada nesta receita.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Diálogo de exclusão
// =====================================================================
function DeleteReceitaDialog({
  receita,
  onClose,
}: {
  receita: Receita | null;
  onClose: () => void;
}) {
  const open = !!receita;
  const [scope, setScope] = useState<UpdateReceitaScope>("single");

  useEffect(() => {
    if (receita) setScope("single");
  }, [receita]);

  function handleConfirm() {
    if (!receita) return;
    if (receita.recorrente && receita.recorrenciaId && scope !== "single") {
      if (scope === "forward") {
        deleteReceitaRecorrencia(receita.recorrenciaId, receita.mes, receita.ano);
      } else {
        deleteReceitaRecorrencia(receita.recorrenciaId);
      }
    } else {
      deleteReceita(receita.id);
    }
    toast.success("Renda removida.");
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir renda?</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir esta renda? Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {receita?.recorrente && receita.recorrenciaId && (
          <div className="rounded-xl border border-border bg-card-elevated p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Esta renda é recorrente. O que excluir?
            </p>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as UpdateReceitaScope)}
              className="mt-2 space-y-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="single" id="del-single" className="mt-0.5" />
                <span className="font-medium">Somente este mês</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="forward" id="del-forward" className="mt-0.5" />
                <span className="font-medium">Este mês e os próximos</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="all" id="del-all" className="mt-0.5" />
                <span className="font-medium">Toda a recorrência</span>
              </label>
            </RadioGroup>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
