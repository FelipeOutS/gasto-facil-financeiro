import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Hash,
  RefreshCw,
  MoreVertical,
  Pencil,
  PiggyBank,
  Receipt,
  Search,
  Sparkles,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditGastoDialog } from "@/components/EditGastoDialog";
import type { Gasto } from "@/lib/types";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal, LockChip } from "@/components/UpgradeModal";
import { ImportExtratoDialog } from "@/components/ImportExtratoDialog";
import { ExtratosImportadosDialog } from "@/components/ExtratosImportadosDialog";
import { Upload, History } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
import { BrandLogo } from "@/components/BrandLogo";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { hasMerchantLogo } from "@/lib/logos";
import { Money, CountNumber } from "@/components/Money";
import { AnimatePresence, motion } from "framer-motion";
import {
  bulkDeleteGastos,
  deleteGasto,
  getCategoriaById,
  getCategorias,
  getGastos,
  mesEfetivoGasto,
  reclassificarCategoriasExistentes,
  refreshGastos,
  useBootstrap,
  useStore,
  bulkSetMesReferencia,
} from "@/lib/store";
import { mesAnoToLabel, mesReferenciaOpcoes, ymToLabel } from "@/lib/mes-referencia";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatBRL, formatDateBR, parseDateLocal, toLocalISODate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/gastos")({
  head: () => ({ meta: [{ title: "Gastos — Gasto Inteligente" }] }),
  component: GastosPage,
});

type PeriodoId =
  | "todos"
  | "hoje"
  | "ontem"
  | "7d"
  | "30d"
  | "mes"
  | "mesPassado"
  | "3m"
  | "6m"
  | "ano"
  | "personalizado";

const PERIODO_LABEL: Record<PeriodoId, string> = {
  todos: "Todos",
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  mes: "Este mês",
  mesPassado: "Mês passado",
  "3m": "3 meses",
  "6m": "6 meses",
  ano: "Este ano",
  personalizado: "Personalizado",
};

const PERIODOS_RAPIDOS: PeriodoId[] = ["hoje", "7d", "30d", "mes", "personalizado"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function toISODate(d: Date) {
  return toLocalISODate(d);
}

function getRange(
  periodo: PeriodoId,
  custom: { from?: Date; to?: Date },
): { fromTs?: number; toTs?: number } {
  const now = new Date();
  const today = startOfDay(now);
  switch (periodo) {
    case "hoje":
      return { fromTs: today.getTime(), toTs: endOfDay(now).getTime() };
    case "ontem": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { fromTs: startOfDay(y).getTime(), toTs: endOfDay(y).getTime() };
    }
    case "7d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 6);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(now).getTime() };
    }
    case "30d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 29);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(now).getTime() };
    }
    case "mes": {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      const t = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(t).getTime() };
    }
    case "mesPassado": {
      const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const t = new Date(today.getFullYear(), today.getMonth(), 0);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(t).getTime() };
    }
    case "3m": {
      const f = new Date(today);
      f.setMonth(f.getMonth() - 3);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(now).getTime() };
    }
    case "6m": {
      const f = new Date(today);
      f.setMonth(f.getMonth() - 6);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(now).getTime() };
    }
    case "ano": {
      const f = new Date(today.getFullYear(), 0, 1);
      const t = new Date(today.getFullYear(), 11, 31);
      return { fromTs: startOfDay(f).getTime(), toTs: endOfDay(t).getTime() };
    }
    case "personalizado":
      return {
        fromTs: custom.from ? startOfDay(custom.from).getTime() : undefined,
        toTs: custom.to ? endOfDay(custom.to).getTime() : undefined,
      };
    default:
      return {};
  }
}

function GastosPage() {
  const ready = useBootstrap();
  const { profile } = useAuth();
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const gastos = useStore(() => getGastos());
  const categorias = useStore(() => getCategorias());

  // Refetch gastos ao entrar na página: pega registros criados fora do
  // cliente (ex: webhook do WhatsApp) que não passaram pelo cache local.
  useEffect(() => {
    if (ready) void refreshGastos();
  }, [ready]);

  // Suporte a ?highlight=<id> para destacar um gasto vindo de outras telas
  // (ex: /whatsapp → "Ver em Gastos"). Limpa filtros para garantir visibilidade.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("highlight");
    if (!id) return;
    setHighlightId(id);
    // Remove o parâmetro da URL sem recarregar.
    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState({}, "", url.toString());
    // Auto-limpa o destaque após 6s.
    const t = setTimeout(() => setHighlightId(null), 6000);
    return () => clearTimeout(t);
  }, []);

  // Quando há highlight ativo, garante que filtros não escondam o gasto.
  useEffect(() => {
    if (!highlightId) return;
    const alvo = gastos.find((g) => g.id === highlightId);
    if (!alvo) return;
    // Reset suave: remove filtros e período para o item ser visível.
      setQ("");
      setPeriodo("todos");
      setMesRef("todos");
      setCatFilter("todas");
      setPagFilter("todas");
      setValorMin("");
      setValorMax("");
    // Scroll até o card depois do render.
    setTimeout(() => {
      const el = document.getElementById(`gasto-${highlightId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }, [highlightId, gastos]);

  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoId>("todos");
  const [mesRef, setMesRef] = useState<string>("todos"); // "todos" | "YYYY-MM"
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [pagFilter, setPagFilter] = useState<string>("todas");
  const [order, setOrder] = useState<string>("recente");
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [advOpen, setAdvOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [excluindoBulk, setExcluindoBulk] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [reclassificando, setReclassificando] = useState(false);
  const { can } = usePlan();
  const tryImportar = () => {
    if (can("importar_extrato")) setImportOpen(true);
    else setUpgradeOpen(true);
  };
  const handleReclassificar = async () => {
    setReclassificando(true);
    try {
      const count = await reclassificarCategoriasExistentes();
      await refreshGastos();
      toast.success(count > 0 ? `${count} gasto(s) reclassificado(s).` : "Categorias já estavam atualizadas.");
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível reclassificar agora.");
    } finally {
      setReclassificando(false);
    }
  };

  const range = useMemo(
    () => getRange(periodo, { from: customFrom, to: customTo }),
    [periodo, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    // Filtra fora gastos não confirmados (rascunhos pré-importação) para
    // manter o total da tela alinhado com Dashboard e Relatórios, que já
    // ignoram `confirmado === false`.
    let list = gastos.filter((g) => g.confirmado !== false);
    if (mesRef !== "todos" && /^\d{4}-\d{2}$/.test(mesRef)) {
      const [ay, am] = mesRef.split("-").map(Number);
      list = list.filter((g) => {
        const eff = mesEfetivoGasto(g);
        return eff.ano === ay && eff.mes === am;
      });
    }
    if (range.fromTs != null || range.toTs != null) {
      list = list.filter((g) => {
        const d = parseDateLocal(g.data);
        if (!d) return false;
        const ts = d.getTime();
        if (range.fromTs != null && ts < range.fromTs) return false;
        if (range.toTs != null && ts > range.toTs) return false;
        return true;
      });
    }
    if (catFilter !== "todas") list = list.filter((g) => g.categoriaId === catFilter);
    if (pagFilter !== "todas") list = list.filter((g) => g.formaPagamento === pagFilter);
    const min = parseFloat(valorMin.replace(",", "."));
    const max = parseFloat(valorMax.replace(",", "."));
    if (Number.isFinite(min) && min > 0) list = list.filter((g) => g.valor >= min);
    if (Number.isFinite(max) && max > 0) list = list.filter((g) => g.valor <= max);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (g) =>
          g.descricao.toLowerCase().includes(t) ||
          g.estabelecimento.toLowerCase().includes(t),
      );
    }
    const sorted = [...list];
    switch (order) {
      case "antigo":
        sorted.sort((a, b) => (a.data < b.data ? -1 : 1));
        break;
      case "maior":
        sorted.sort((a, b) => b.valor - a.valor);
        break;
      case "menor":
        sorted.sort((a, b) => a.valor - b.valor);
        break;
      default:
        sorted.sort((a, b) => (a.data > b.data ? -1 : 1));
    }
    return sorted;
  }, [gastos, q, range, mesRef, catFilter, pagFilter, valorMin, valorMax, order]);

  const total = useMemo(() => filtered.reduce((s, g) => s + g.valor, 0), [filtered]);
  const media = filtered.length ? total / filtered.length : 0;
  const topCategoria = useMemo(() => {
    if (!filtered.length) return null;
    const acc = new Map<string, number>();
    for (const g of filtered) acc.set(g.categoriaId, (acc.get(g.categoriaId) ?? 0) + g.valor);
    let bestId = "";
    let bestVal = -1;
    acc.forEach((v, k) => {
      if (v > bestVal) {
        bestVal = v;
        bestId = k;
      }
    });
    const cat = getCategoriaById(bestId);
    return cat ? { nome: cat.nome, valor: bestVal, cat } : null;
  }, [filtered]);

  // Opções de mês de referência: meses presentes nos gastos + atual + 2 vizinhos.
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const g of gastos) {
      if (g.confirmado === false) continue;
      const eff = mesEfetivoGasto(g);
      set.add(`${eff.ano}-${String(eff.mes).padStart(2, "0")}`);
    }
    const now = new Date();
    for (let i = -2; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return Array.from(set).sort(); // asc YYYY-MM
  }, [gastos]);

  const mesRefIdx = mesRef === "todos" ? -1 : mesesDisponiveis.indexOf(mesRef);
  function shiftMes(delta: number) {
    if (!mesesDisponiveis.length) return;
    if (mesRef === "todos") {
      // entra no mês atual ou mais próximo
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const ix = Math.max(0, mesesDisponiveis.indexOf(cur));
      setMesRef(mesesDisponiveis[ix] ?? mesesDisponiveis[0]);
      return;
    }
    const next = mesRefIdx + delta;
    if (next < 0 || next >= mesesDisponiveis.length) return;
    setMesRef(mesesDisponiveis[next]);
  }


  // Limpa seleção quando filtros mudam (mantém apenas IDs ainda visíveis)
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visiveis = new Set(filtered.map((g) => g.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visiveis.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const allSelected = filtered.length > 0 && filtered.every((g) => selected.has(g.id));
  const someSelected = selected.size > 0 && !allSelected;
  const valorSelecionado = useMemo(
    () => filtered.filter((g) => selected.has(g.id)).reduce((s, g) => s + g.valor, 0),
    [filtered, selected],
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      if (filtered.every((g) => prev.has(g.id))) {
        // Desmarca todos visíveis
        const next = new Set(prev);
        filtered.forEach((g) => next.delete(g.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((g) => next.add(g.id));
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  async function executarBulkDelete() {
    if (selected.size === 0) return;
    setExcluindoBulk(true);
    try {
      const ids = Array.from(selected);
      const n = await bulkDeleteGastos(ids);
      if (n > 0) {
        toast.success(`${n} ${n === 1 ? "gasto removido" : "gastos removidos"}.`);
        clearSelection();
      } else {
        toast.error("Não foi possível excluir os gastos selecionados.");
      }
      setConfirmBulk(false);
    } finally {
      setExcluindoBulk(false);
    }
  }

  const categoriaAtiva = catFilter !== "todas"
    ? categorias.find((c) => c.id === catFilter)
    : undefined;
  const pagamentoAtivo = pagFilter !== "todas"
    ? FORMAS_PAGAMENTO.find((f) => f.id === pagFilter)
    : undefined;

  const minNum = parseFloat(valorMin.replace(",", "."));
  const maxNum = parseFloat(valorMax.replace(",", "."));
  const hasMin = Number.isFinite(minNum) && minNum > 0;
  const hasMax = Number.isFinite(maxNum) && maxNum > 0;

  const periodoChipLabel = useMemo(() => {
    if (periodo === "todos") return null;
    if (periodo === "personalizado") {
      if (customFrom && customTo) {
        return `${formatDateBR(toISODate(customFrom))} → ${formatDateBR(toISODate(customTo))}`;
      }
      if (customFrom) return `A partir de ${formatDateBR(toISODate(customFrom))}`;
      if (customTo) return `Até ${formatDateBR(toISODate(customTo))}`;
      return "Personalizado";
    }
    return PERIODO_LABEL[periodo];
  }, [periodo, customFrom, customTo]);

  const hasAnyFilter =
    !!periodoChipLabel ||
    !!categoriaAtiva ||
    !!pagamentoAtivo ||
    hasMin ||
    hasMax ||
    !!q.trim() ||
    mesRef !== "todos" ||
    order !== "recente";

  function clearAll() {
    setQ("");
    setPeriodo("todos");
    setMesRef("todos");
    setCustomFrom(undefined);
    setCustomTo(undefined);
    setCatFilter("todas");
    setPagFilter("todas");
    setValorMin("");
    setValorMax("");
    setOrder("recente");
  }

  if (!ready) return <PageSkeleton wide />;

  return (
    <MobileShell wide>
      {/* HERO premium */}
      <section className="relative mt-1 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card-elevated to-card p-5 sm:p-6 shadow-card animate-rise">
        {/* Glow decorativo */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--brand-soft, oklch(0.7 0.15 260 / 0.25)), transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.72 0.18 152 / 0.22), transparent 70%)" }}
        />

        <div className="relative flex items-start gap-3">
          <Link
            to="/"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card/70 backdrop-blur text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
              Painel financeiro
            </p>
            <h1 className="mt-0.5 text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              {vocab.gastosTitle}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-xl">
              Visualize, organize e entenda para onde seu dinheiro está indo.
            </p>
          </div>
          {/* Ilustração animada (SVG leve) — finanças/gráfico */}
          <div className="hidden sm:flex shrink-0 ml-2">
            <HeroFinanceArt />
          </div>
        </div>

        {/* Ações desktop */}
        <div className="relative mt-4 hidden sm:flex items-center gap-2">
          <Button
            type="button"
            onClick={handleReclassificar}
            className="h-9 rounded-full"
            variant="outline"
            disabled={reclassificando}
            title="Reclassificar categorias"
          >
            <RefreshCw className={cn("h-4 w-4", reclassificando && "animate-spin")} />
            Reclassificar
          </Button>
          <Button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="h-9 rounded-full"
            variant="outline"
          >
            <History className="h-4 w-4" />
            Extratos importados
          </Button>
          <Button
            type="button"
            onClick={tryImportar}
            className="h-9 rounded-full"
            variant="secondary"
          >
            <Upload className="h-4 w-4" />
            Importar extrato
            {!can("importar_extrato") && <LockChip />}
          </Button>
        </div>
      </section>

      {/* SELETOR PRINCIPAL: Mês de referência */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-3 sm:p-4 animate-rise">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <CalendarIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                Mês de referência
              </p>
              <p className="text-xs text-muted-foreground/90 hidden sm:block">
                Mês ao qual o gasto pertence — mesmo que pago em outro mês.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => shiftMes(-1)}
              disabled={mesRef === "todos" || mesRefIdx <= 0}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card-elevated hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Select value={mesRef} onValueChange={setMesRef}>
              <SelectTrigger className="h-9 min-w-[180px] rounded-full bg-card-elevated border-border font-semibold text-sm">
                <SelectValue>
                  {mesRef === "todos" ? "Todos os meses" : ymToLabel(mesRef)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="todos">Todos os meses</SelectItem>
                {mesesDisponiveis.map((ym) => (
                  <SelectItem key={ym} value={ym}>
                    {ymToLabel(ym)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={() => shiftMes(1)}
              disabled={mesRef === "todos" || mesRefIdx >= mesesDisponiveis.length - 1}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card-elevated hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        {mesRef !== "todos" && (
          <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-brand" />
            Este resumo considera apenas os gastos de{" "}
            <strong className="text-foreground">{ymToLabel(mesRef)}</strong>.
          </p>
        )}
      </section>

      {/* Botões mobile */}
      <div className="mt-3 sm:hidden -mx-4 px-4 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-2 w-max pb-1">
          <Button
            type="button"
            onClick={handleReclassificar}
            className="h-11 rounded-2xl px-3 shrink-0"
            variant="outline"
            disabled={reclassificando}
          >
            <RefreshCw className={cn("h-4 w-4", reclassificando && "animate-spin")} />
            Revisar
          </Button>
          <Button
            type="button"
            onClick={tryImportar}
            className="relative h-11 rounded-2xl px-3 shrink-0"
            variant="secondary"
          >
            <Upload className="h-4 w-4" />
            Importar
            {!can("importar_extrato") && (
              <span
                aria-label="Premium"
                className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full border border-background bg-amber-500 text-[9px] font-bold text-amber-950"
              >
                ★
              </span>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="h-11 rounded-2xl px-3 shrink-0"
            variant="outline"
          >
            <History className="h-4 w-4" />
            Extratos
          </Button>
        </div>
      </div>

      <ImportExtratoDialog open={importOpen} onOpenChange={setImportOpen} />
      <ExtratosImportadosDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        feature="importar_extrato"
        featureLabel="Importar extrato bancário"
        benefit="Importe seu extrato em PDF/CSV e o app categoriza tudo automaticamente."
      />

      {/* Busca grande */}
      <div className="mt-4 relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por mercado, Uber, aluguel..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-12 rounded-2xl border-border bg-card pl-11 text-sm"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Chips rápidos de período */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
        {PERIODOS_RAPIDOS.map((p) => {
          const active = periodo === p;
          if (p === "personalizado") {
            return (
              <Popover key={p}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                      active
                        ? "border-foreground/40 bg-card-elevated"
                        : "border-border bg-card hover:bg-card-elevated",
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    Personalizado
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 space-y-3" align="start">
                  <div>
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">Data inicial</p>
                    <Calendar
                      mode="single"
                      selected={customFrom}
                      onSelect={(d) => {
                        setCustomFrom(d);
                        setPeriodo("personalizado");
                      }}
                      className={cn("p-0 pointer-events-auto")}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">Data final</p>
                    <Calendar
                      mode="single"
                      selected={customTo}
                      onSelect={(d) => {
                        setCustomTo(d);
                        setPeriodo("personalizado");
                      }}
                      className={cn("p-0 pointer-events-auto")}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            );
          }
          return (
            <button
              key={p}
              onClick={() => setPeriodo(active ? "todos" : p)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-foreground/40 bg-card-elevated"
                  : "border-border bg-card hover:bg-card-elevated",
              )}
            >
              {PERIODO_LABEL[p]}
            </button>
          );
        })}
        {/* Outros períodos via select compacto */}
        <Select
          value={["mesPassado", "3m", "6m", "ano", "ontem"].includes(periodo) ? periodo : ""}
          onValueChange={(v) => setPeriodo(v as PeriodoId)}
        >
          <SelectTrigger className="h-8 shrink-0 w-auto gap-1 rounded-full border-border bg-card px-3 text-xs">
            <SelectValue placeholder="Mais períodos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ontem">Ontem</SelectItem>
            <SelectItem value="mesPassado">Mês passado</SelectItem>
            <SelectItem value="3m">Últimos 3 meses</SelectItem>
            <SelectItem value="6m">Últimos 6 meses</SelectItem>
            <SelectItem value="ano">Este ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filtros avançados */}
      <Collapsible open={advOpen} onOpenChange={setAdvOpen} className="mt-3">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-card-elevated transition-colors">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros avançados
            </span>
            <span className="text-xs text-muted-foreground">
              {advOpen ? "Recolher" : "Expandir"}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-fade-in">
          <div className="mt-2 grid gap-3 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Categoria</label>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas categorias</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Pagamento</label>
              <Select value={pagFilter} onValueChange={setPagFilter}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos pagamentos</SelectItem>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ordenar</label>
              <Select value={order} onValueChange={setOrder}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recente">Mais recente</SelectItem>
                  <SelectItem value="antigo">Mais antigo</SelectItem>
                  <SelectItem value="maior">Maior valor</SelectItem>
                  <SelectItem value="menor">Menor valor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor mínimo (R$)</label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={valorMin}
                onChange={(e) => setValorMin(e.target.value)}
                className="mt-1 h-10 bg-card-elevated"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor máximo (R$)</label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={valorMax}
                onChange={(e) => setValorMax(e.target.value)}
                className="mt-1 h-10 bg-card-elevated"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Chips de filtros ativos */}
      {hasAnyFilter && (
        <div className="mt-3 flex flex-wrap items-center gap-2 animate-fade-in">
          {mesRef !== "todos" && (
            <ActiveChip
              label={`Mês: ${ymToLabel(mesRef)}`}
              onRemove={() => setMesRef("todos")}
            />
          )}
          {periodoChipLabel && (
            <ActiveChip
              label={periodoChipLabel}
              onRemove={() => {
                setPeriodo("todos");
                setCustomFrom(undefined);
                setCustomTo(undefined);
              }}
            />
          )}
          {categoriaAtiva && (
            <ActiveChip
              label={`Categoria: ${categoriaAtiva.nome}`}
              onRemove={() => setCatFilter("todas")}
            />
          )}
          {pagamentoAtivo && (
            <ActiveChip
              label={`Pagamento: ${pagamentoAtivo.label}`}
              onRemove={() => setPagFilter("todas")}
            />
          )}
          {hasMin && (
            <ActiveChip
              label={`Acima de ${formatBRL(minNum)}`}
              onRemove={() => setValorMin("")}
            />
          )}
          {hasMax && (
            <ActiveChip
              label={`Até ${formatBRL(maxNum)}`}
              onRemove={() => setValorMax("")}
            />
          )}
          {q.trim() && (
            <ActiveChip label={`Busca: "${q.trim()}"`} onRemove={() => setQ("")} />
          )}
          {order !== "recente" && (
            <ActiveChip
              label={`Ordem: ${
                { antigo: "Mais antigo", maior: "Maior valor", menor: "Menor valor" }[order] ??
                order
              }`}
              onRemove={() => setOrder("recente")}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Limpar filtros
          </Button>
        </div>
      )}

      {/* Resumo premium */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 stagger">
        <SummaryStat
          icon={<Hash className="h-4 w-4" />}
          tone="neutral"
          label="Encontrados"
          value={<CountNumber value={filtered.length} />}
          hint={mesRef === "todos" ? "no período" : ymToLabel(mesRef)}
        />
        <SummaryStat
          icon={<Wallet className="h-4 w-4" />}
          tone="brand"
          label="Total"
          value={<Money value={total} />}
          hint="somatório dos itens"
          highlight
        />
        <SummaryStat
          icon={<TrendingUp className="h-4 w-4" />}
          tone="info"
          label="Média por gasto"
          value={<Money value={media} />}
          hint={filtered.length ? `${filtered.length} itens` : "—"}
        />
        <SummaryStat
          icon={<Tag className="h-4 w-4" />}
          tone="success"
          label="Top categoria"
          value={
            topCategoria ? (
              <span className="truncate block">{topCategoria.nome}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          hint={topCategoria ? formatBRL(topCategoria.valor) : "sem dados"}
        />
      </div>

      {/* Barra de seleção em massa */}
      {filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card-elevated px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={() => toggleAllVisible()}
              aria-label="Selecionar todos"
            />
            <span>
              {allSelected
                ? `Todos selecionados (${filtered.length})`
                : selected.size > 0
                  ? `${selected.size} selecionado${selected.size === 1 ? "" : "s"}`
                  : hasAnyFilter
                    ? `Selecionar todos filtrados (${filtered.length})`
                    : `Selecionar todos (${filtered.length})`}
            </span>
          </label>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="num text-xs text-muted-foreground">
                Total: {formatBRL(valorSelecionado)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3 text-xs"
                onClick={clearSelection}
              >
                Limpar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs">
                    <CalendarIcon className="mr-1 h-3.5 w-3.5" />
                    Mover p/ mês
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  {mesReferenciaOpcoes(undefined, 12, 6).map((o) => (
                    <DropdownMenuItem
                      key={o.value}
                      onClick={async () => {
                        const ids = Array.from(selected);
                        const n = await bulkSetMesReferencia(ids, o.value);
                        if (n > 0) {
                          toast.success(`${n} gasto(s) movido(s) para ${o.label}.`);
                          clearSelection();
                        } else {
                          toast.error("Não foi possível mover os gastos.");
                        }
                      }}
                    >
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setConfirmBulk(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Excluir selecionados
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-border bg-card/50 p-10 text-center animate-fade-in">
          {hasAnyFilter ? (
            <>
              <p className="font-medium text-foreground">Nada encontrado nesse filtro</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tenta mudar o período, categoria ou forma de pagamento.
              </p>
              <Button onClick={clearAll} variant="outline" size="sm" className="mt-4 rounded-full">
                Limpar filtros
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">Nenhum gasto por aqui ainda</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Quando você lançar um gasto, ele aparece aqui bonitinho pra você acompanhar.
              </p>
              <Button asChild size="sm" className="mt-4 rounded-full">
                <Link to="/adicionar">Adicionar meu primeiro gasto</Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2 pb-4">
          <AnimatePresence initial={false}>
            {filtered.map((g, idx) => {
              const cat = getCategoriaById(g.categoriaId);
              const pag = FORMAS_PAGAMENTO.find((f) => f.id === g.formaPagamento)?.label;
              return (
                <motion.li
                  key={g.id}
                  id={`gasto-${g.id}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { delay: Math.min(idx, 8) * 0.03, duration: 0.25 },
                  }}
                  exit={{
                    opacity: 0,
                    x: 80,
                    transition: { duration: 0.22 },
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border border-border bg-card p-3 hover-lift",
                    highlightId === g.id && "ring-2 ring-emerald-500/70 border-emerald-500/40 bg-emerald-500/5",
                    selected.has(g.id) && "border-primary/50 bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={selected.has(g.id)}
                    onCheckedChange={() => toggleOne(g.id)}
                    aria-label="Selecionar gasto"
                    className="shrink-0"
                  />
                  <div className="relative shrink-0">
                    <TransactionAvatar
                      estabelecimento={g.estabelecimento || g.descricao}
                      categoria={cat}
                      size="md"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.estabelecimento || g.descricao}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cat?.nome ?? "Outros"} · {formatDateBR(g.data)}
                      {g.horario ? ` às ${g.horario}` : ""} · {pag}
                      {g.tipoGasto === "parcelado" && g.totalParcelas
                        ? ` · ${g.parcelaAtual}/${g.totalParcelas}`
                        : g.tipoGasto === "recorrente"
                          ? " · recorrente"
                          : ""}
                    </p>
                    {g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth) && (
                      <p className="truncate text-[11px] text-muted-foreground/80">
                        Mês de referência: {ymToLabel(g.invoiceMonth)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditing(g)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Editar gasto"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Mais ações"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(g)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar gasto
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              deleteGasto(g.id);
                              toast.success("Gasto removido.");
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir gasto
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      <EditGastoDialog
        gasto={editing}
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      />

      <AlertDialog open={confirmBulk} onOpenChange={(o) => !o && !excluindoBulk && setConfirmBulk(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir gastos selecionados?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir <strong>{selected.size}</strong>{" "}
              {selected.size === 1 ? "gasto" : "gastos"}, totalizando{" "}
              <strong>{formatBRL(valorSelecionado)}</strong>. Essa ação não poderá ser desfeita.
              Apenas gastos serão removidos — receitas, contas e outros dados não serão afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoBulk}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executarBulkDelete();
              }}
              disabled={excluindoBulk}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindoBulk ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3 py-1 text-xs font-medium animate-fade-in">
      {label}
      <button
        onClick={onRemove}
        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
        aria-label={`Remover ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

type StatTone = "neutral" | "brand" | "info" | "success";

const TONE_STYLES: Record<StatTone, { icon: string; ring: string }> = {
  neutral: { icon: "bg-muted text-muted-foreground", ring: "" },
  brand: { icon: "bg-brand-soft text-brand", ring: "ring-1 ring-brand/30" },
  info: { icon: "bg-blue-500/15 text-blue-500 dark:text-blue-300", ring: "" },
  success: { icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", ring: "" },
};

function SummaryStat({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatTone;
  highlight?: boolean;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border p-3 sm:p-4 transition-all hover-lift card-press",
        highlight
          ? "bg-gradient-to-br from-card-elevated via-card to-card shadow-card"
          : "bg-card",
        t.ring,
      )}
    >
      <div className="flex items-center gap-2">
        {icon && (
          <span className={cn("grid h-7 w-7 place-items-center rounded-lg shrink-0", t.icon)}>
            {icon}
          </span>
        )}
        <p className="text-[10px] sm:text-[11px] uppercase tracking-widest text-muted-foreground font-semibold truncate">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1.5 num font-extrabold truncate",
          highlight ? "text-xl sm:text-2xl" : "text-base sm:text-lg",
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[10px] sm:text-[11px] text-muted-foreground/90 truncate">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Pequena ilustração SVG animada para o hero — sutil e premium. */
function HeroFinanceArt() {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="opacity-90"
      aria-hidden
    >
      <defs>
        <linearGradient id="heroBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.16 152)" />
          <stop offset="100%" stopColor="oklch(0.55 0.16 152)" />
        </linearGradient>
        <linearGradient id="heroBar2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.8 0.14 230)" />
          <stop offset="100%" stopColor="oklch(0.55 0.14 230)" />
        </linearGradient>
      </defs>
      {/* Eixo */}
      <line x1="6" y1="68" x2="118" y2="68" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
      {/* Barras */}
      {[
        { x: 12, h: 22, fill: "url(#heroBar2)", delay: 0 },
        { x: 32, h: 36, fill: "url(#heroBar)", delay: 0.1 },
        { x: 52, h: 28, fill: "url(#heroBar2)", delay: 0.2 },
        { x: 72, h: 48, fill: "url(#heroBar)", delay: 0.3 },
        { x: 92, h: 40, fill: "url(#heroBar2)", delay: 0.4 },
      ].map((b, i) => (
        <motion.rect
          key={i}
          x={b.x}
          width="14"
          rx="3"
          fill={b.fill}
          initial={{ y: 68, height: 0 }}
          animate={{ y: 68 - b.h, height: b.h }}
          transition={{ delay: b.delay, duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
        />
      ))}
      {/* Linha de tendência */}
      <motion.path
        d="M12 46 Q 38 30 60 38 T 110 18"
        stroke="oklch(0.78 0.16 55)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.9 }}
      />
      <motion.circle
        cx="110" cy="18" r="3.5"
        fill="oklch(0.78 0.16 55)"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 1.2, duration: 0.4, type: "spring" }}
      />
    </svg>
  );
}
