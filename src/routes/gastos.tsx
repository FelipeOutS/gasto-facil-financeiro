import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Hash,
  RefreshCw,
  Download,
  MoreVertical,
  Pencil,
  Search,
  ShoppingBasket,
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
import { EmptyState as PremiumEmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import type { Gasto } from "@/lib/types";
import { MobileShell } from "@/components/MobileShell";
import { AdSlot } from "@/components/AdSlot";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal, LockChip } from "@/components/UpgradeModal";
import { ImportExtratoDialog } from "@/components/ImportExtratoDialog";
import { GastosExportDialog } from "@/components/GastosExportDialog";
import { ExtratosImportadosDialog } from "@/components/ExtratosImportadosDialog";
import { Upload, History } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
import { BrandLogo } from "@/components/BrandLogo";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { hasMerchantLogo } from "@/lib/logos";
import { Money, CountNumber } from "@/components/Money";
import { useFornecedores } from "@/lib/fornecedores";
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
import { requireOnline } from "@/lib/use-online-status";
import { mesAnoToLabel, mesReferenciaOpcoes, ymFromDate, ymToLabel } from "@/lib/mes-referencia";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import {
  AppPageHeader,
  AppModuleBanner,
  AppSummaryCard,
  AppEmptyStateVisual,
} from "@/components/app-v2";

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

const PERIODO_KEYS: Record<PeriodoId, string> = {
  todos: "todos",
  hoje: "hoje",
  ontem: "ontem",
  "7d": "7d",
  "30d": "30d",
  mes: "mes",
  mesPassado: "mesPassado",
  "3m": "3m",
  "6m": "6m",
  ano: "ano",
  personalizado: "personalizado",
};

const PERIODOS_RAPIDOS: PeriodoId[] = ["hoje", "7d", "30d", "mes", "personalizado"];
const MES_REF_ALL = "todos";
const MES_REF_STORAGE_KEY = "gf:gastos:selectedReferenceMonth:v1";

function isValidReferenceMonth(value: string | null | undefined): value is string {
  return value === MES_REF_ALL || /^\d{4}-\d{2}$/.test(value ?? "");
}

function currentReferenceMonth() {
  return ymFromDate();
}

function readInitialReferenceMonth() {
  if (typeof window === "undefined") return currentReferenceMonth();
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("mes");
    if (isValidReferenceMonth(fromUrl)) return fromUrl;
    const fromStorage = window.localStorage.getItem(MES_REF_STORAGE_KEY);
    if (isValidReferenceMonth(fromStorage)) return fromStorage;
  } catch {
    // WebView Android pode bloquear localStorage — não deixe a rota quebrar.
  }
  return currentReferenceMonth();
}

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
  const { t } = useTranslation("gastos");
  const ready = useBootstrap();
  const { profile } = useAuth();
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const gastos = useStore(() => getGastos());
  const categorias = useStore(() => getCategorias());
  const { porId: fornecedoresPorId } = useFornecedores();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  // No mobile, editar abre rota dedicada (evita Dialog no Android WebView).
  // No desktop, abre o EditGastoDialog inline.
  const openEdit = (g: Gasto) => {
    if (isMobile) navigate({ to: "/gastos/$id/editar", params: { id: g.id } });
    else setEditing(g);
  };

  const tPag = (id: string, fallback: string) => t(`pagamento.${id}`, { defaultValue: fallback });

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
    const eff = mesEfetivoGasto(alvo);
    const targetYm = `${eff.ano}-${String(eff.mes).padStart(2, "0")}`;
    setQ("");
    setPeriodo("todos");
    setMesRef(targetYm);
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
  const [selectedReferenceMonth, setSelectedReferenceMonth] = useState<string>(() =>
    readInitialReferenceMonth(),
  );
  const mesRef = selectedReferenceMonth; // "todos" | "YYYY-MM"
  const setMesRef = setSelectedReferenceMonth;
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
  const [exportOpen, setExportOpen] = useState(false);
  const { can } = usePlan();

  useEffect(() => {
    if (typeof window === "undefined" || !isValidReferenceMonth(selectedReferenceMonth)) return;
    window.localStorage.setItem(MES_REF_STORAGE_KEY, selectedReferenceMonth);
    const url = new URL(window.location.href);
    url.searchParams.set("mes", selectedReferenceMonth);
    window.history.replaceState({}, "", url.toString());
    // Sincroniza com o hook global useMesReferenciaSelecionado.
    try {
      window.dispatchEvent(
        new CustomEvent("gf:mes-referencia:changed", { detail: selectedReferenceMonth }),
      );
    } catch {
      /* noop */
    }
  }, [selectedReferenceMonth]);

  // Recebe mudanças vindas de outras telas (Dashboard, Cartões etc).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (isValidReferenceMonth(detail) && detail !== selectedReferenceMonth) {
        setSelectedReferenceMonth(detail);
      }
    };
    window.addEventListener("gf:mes-referencia:changed", onExternal as EventListener);
    return () =>
      window.removeEventListener("gf:mes-referencia:changed", onExternal as EventListener);
  }, [selectedReferenceMonth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("mes");
      if (isValidReferenceMonth(fromUrl)) setSelectedReferenceMonth(fromUrl);
    };
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, []);

  const tryImportar = () => {
    if (can("importar_extrato")) setImportOpen(true);
    else setUpgradeOpen(true);
  };
  const handleReclassificar = async () => {
    setReclassificando(true);
    try {
      const count = await reclassificarCategoriasExistentes();
      await refreshGastos();
      toast.success(
        count > 0
          ? t("toast.reclassified", { count, defaultValue: `${count} gasto(s) reclassificado(s).` })
          : t("toast.reclassifyEmpty"),
      );
    } catch (error) {
      console.error(error);
      toast.error(t("toast.reclassifyError"));
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
        (g) => g.descricao.toLowerCase().includes(t) || g.estabelecimento.toLowerCase().includes(t),
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

  // Gastos apenas do período selecionado (mês de referência + intervalo),
  // ignorando filtros secundários — usado na opção "Todos os gastos do período".
  const doPeriodo = useMemo(() => {
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
    return [...list].sort((a, b) => (a.data < b.data ? -1 : 1));
  }, [gastos, mesRef, range]);

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

  // Opções de mês de referência: ano ativo completo + meses presentes nos gastos.
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    const baseYm =
      mesRef !== MES_REF_ALL && /^\d{4}-\d{2}$/.test(mesRef) ? mesRef : currentReferenceMonth();
    const [baseYear] = baseYm.split("-").map(Number);
    for (let m = 1; m <= 12; m++) set.add(`${baseYear}-${String(m).padStart(2, "0")}`);
    for (const g of gastos) {
      if (g.confirmado === false) continue;
      const eff = mesEfetivoGasto(g);
      set.add(`${eff.ano}-${String(eff.mes).padStart(2, "0")}`);
    }
    return Array.from(set).sort(); // asc YYYY-MM
  }, [gastos, mesRef]);

  const referenceMonthCaption =
    mesRef === MES_REF_ALL
      ? t("monthRef.captionAll")
      : t("monthRef.caption", { month: ymToLabel(mesRef) });

  const mesRefIdx = mesRef === "todos" ? -1 : mesesDisponiveis.indexOf(mesRef);
  function shiftMes(delta: number) {
    if (!mesesDisponiveis.length) return;
    if (mesRef === "todos") {
      // entra no mês atual ou mais próximo
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const ix = mesesDisponiveis.indexOf(cur) >= 0 ? mesesDisponiveis.indexOf(cur) : 0;
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
    if (!(await requireOnline())) return;
    setExcluindoBulk(true);
    try {
      const ids = Array.from(selected);
      const n = await bulkDeleteGastos(ids);
      if (n > 0) {
        toast.success(
          n === 1 ? t("bulk.deletedOne", { count: n }) : t("bulk.deletedMany", { count: n }),
        );
        clearSelection();
      } else {
        toast.error(t("bulk.deleteError"));
      }
      setConfirmBulk(false);
    } finally {
      setExcluindoBulk(false);
    }
  }

  const categoriaAtiva =
    catFilter !== "todas" ? categorias.find((c) => c.id === catFilter) : undefined;
  const pagamentoAtivo =
    pagFilter !== "todas" ? FORMAS_PAGAMENTO.find((f) => f.id === pagFilter) : undefined;

  const minNum = parseFloat(valorMin.replace(",", "."));
  const maxNum = parseFloat(valorMax.replace(",", "."));
  const hasMin = Number.isFinite(minNum) && minNum > 0;
  const hasMax = Number.isFinite(maxNum) && maxNum > 0;

  const periodoChipLabel = useMemo(() => {
    if (periodo === "todos") return null;
    if (periodo === "personalizado") {
      if (customFrom && customTo) {
        return t("periodo.fromTo", {
          from: formatDateBR(toISODate(customFrom)),
          to: formatDateBR(toISODate(customTo)),
        });
      }
      if (customFrom) return t("periodo.from", { from: formatDateBR(toISODate(customFrom)) });
      if (customTo) return t("periodo.to", { from: "", to: formatDateBR(toISODate(customTo)) });
      return t("periodo.personalizado");
    }
    return t(`periodo.${PERIODO_KEYS[periodo]}`);
  }, [periodo, customFrom, customTo, t]);

  const hasAnyFilter =
    !!periodoChipLabel ||
    !!categoriaAtiva ||
    !!pagamentoAtivo ||
    hasMin ||
    hasMax ||
    !!q.trim() ||
    order !== "recente";

  function clearAll() {
    setQ("");
    setPeriodo("todos");
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
      {/* V3 Page Header */}
      <AppPageHeader
        tone="gastos"
        icon={<Wallet className="h-5 w-5" />}
        title={t("v3.header.title", { defaultValue: vocab.gastosTitle })}
        description={t("v3.header.description")}
        actions={
          <div className="hidden sm:flex items-center gap-2">
            <Button
              type="button"
              onClick={handleReclassificar}
              className="h-9 rounded-full"
              variant="outline"
              disabled={reclassificando}
              title={t("actions.reclassifyTitle")}
            >
              <RefreshCw className={cn("h-4 w-4", reclassificando && "animate-spin")} />
              {t("actions.reclassify")}
            </Button>
            <Button
              type="button"
              onClick={() => setExportOpen(true)}
              className="h-9 rounded-full"
              variant="outline"
            >
              <Download className="h-4 w-4" />
              {t("actions.export")}
            </Button>
            <Button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="h-9 rounded-full"
              variant="outline"
            >
              <History className="h-4 w-4" />
              {t("actions.importedStatements")}
            </Button>
            <Button
              type="button"
              onClick={tryImportar}
              className="h-9 rounded-full"
              variant="secondary"
            >
              <Upload className="h-4 w-4" />
              {t("actions.import")}
              {!can("importar_extrato") && <LockChip />}
            </Button>
          </div>
        }
      />

      {/* V3 Module Banner */}
      <AppModuleBanner
        tone="gastos"
        className="mt-4"
        title={t("v3.banner.title")}
        subtitle={t("v3.banner.subtitle")}
        imageAlt={t("v3.banner.alt")}
        cta={
          <Button asChild size="sm" className="h-10 rounded-full px-4 font-semibold">
            <Link to="/adicionar">{t("v3.banner.cta")}</Link>
          </Button>
        }
      />

      {/* SELETOR PRINCIPAL: Mês de referência */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-3 sm:p-4 animate-rise">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <CalendarIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                {t("monthRef.label")}
              </p>
              <p className="text-xs text-muted-foreground/90 hidden sm:block">
                {t("monthRef.help")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => shiftMes(-1)}
              disabled={mesRef === "todos" || mesRefIdx <= 0}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card-elevated hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label={t("monthRef.prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Select value={mesRef} onValueChange={setMesRef}>
              <SelectTrigger className="h-9 min-w-[190px] rounded-full border-brand/30 bg-brand-soft/70 font-semibold text-sm text-foreground shadow-sm ring-1 ring-brand/10">
                <SelectValue>
                  {mesRef === "todos" ? t("monthRef.all") : ymToLabel(mesRef)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {mesesDisponiveis.map((ym) => (
                  <SelectItem key={ym} value={ym}>
                    {ymToLabel(ym)}
                  </SelectItem>
                ))}
                <SelectItem value="todos">{t("monthRef.all")}</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={() => shiftMes(1)}
              disabled={mesRef === "todos" || mesRefIdx >= mesesDisponiveis.length - 1}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card-elevated hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label={t("monthRef.next")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-brand" />
          <span>{referenceMonthCaption}</span>
        </p>
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
            {t("actions.review")}
          </Button>
          <Button
            type="button"
            onClick={tryImportar}
            className="relative h-11 rounded-2xl px-3 shrink-0"
            variant="secondary"
          >
            <Upload className="h-4 w-4" />
            {t("actions.importShort")}
            {!can("importar_extrato") && (
              <span
                aria-label={t("upgrade.premium")}
                className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full border border-background bg-amber-500 text-[9px] font-bold text-amber-950"
              >
                ★
              </span>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => setExportOpen(true)}
            className="h-11 rounded-2xl px-3 shrink-0"
            variant="outline"
          >
            <Download className="h-4 w-4" />
            {t("actions.exportShort")}
          </Button>
          <Button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="h-11 rounded-2xl px-3 shrink-0"
            variant="outline"
          >
            <History className="h-4 w-4" />
            {t("actions.statements")}
          </Button>
        </div>
      </div>

      <GastosExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        filtrados={filtered}
        doPeriodo={doPeriodo}
        periodLabel={mesRef === MES_REF_ALL ? t("monthRef.all") : ymToLabel(mesRef)}
      />

      <ImportExtratoDialog open={importOpen} onOpenChange={setImportOpen} />
      <ExtratosImportadosDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        feature="importar_extrato"
        featureLabel={t("upgrade.featureLabel")}
        benefit={t("upgrade.benefit")}
      />

      {/* Busca grande */}
      <div className="mt-4 relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("search.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-12 rounded-2xl border-border bg-card pl-11 text-sm"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated"
            aria-label={t("search.clear")}
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
                    {t("periodo.personalizado")}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 space-y-3" align="start">
                  <div>
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">
                      {t("periodo.startDate")}
                    </p>
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
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">
                      {t("periodo.endDate")}
                    </p>
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
              {t(`periodo.${PERIODO_KEYS[p]}`)}
            </button>
          );
        })}
        {/* Outros períodos via select compacto */}
        <Select
          value={["mesPassado", "3m", "6m", "ano", "ontem"].includes(periodo) ? periodo : ""}
          onValueChange={(v) => setPeriodo(v as PeriodoId)}
        >
          <SelectTrigger className="h-8 shrink-0 w-auto gap-1 rounded-full border-border bg-card px-3 text-xs">
            <SelectValue placeholder={t("periodo.morePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ontem">{t("periodo.ontem")}</SelectItem>
            <SelectItem value="mesPassado">{t("periodo.mesPassado")}</SelectItem>
            <SelectItem value="3m">{t("periodo.3mLong")}</SelectItem>
            <SelectItem value="6m">{t("periodo.6mLong")}</SelectItem>
            <SelectItem value="ano">{t("periodo.ano")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filtros avançados */}
      <Collapsible open={advOpen} onOpenChange={setAdvOpen} className="mt-3">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-card-elevated transition-colors">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("filters.advanced")}
            </span>
            <span className="text-xs text-muted-foreground">
              {advOpen ? t("filters.collapse") : t("filters.expand")}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-fade-in">
          <div className="mt-2 grid gap-3 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">{t("filters.category")}</label>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">{t("filters.allCategories")}</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("filters.payment")}</label>
              <Select value={pagFilter} onValueChange={setPagFilter}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">{t("filters.allPayments")}</SelectItem>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {tPag(f.id, f.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("filters.order")}</label>
              <Select value={order} onValueChange={setOrder}>
                <SelectTrigger className="mt-1 h-10 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recente">{t("filters.orderRecent")}</SelectItem>
                  <SelectItem value="antigo">{t("filters.orderOldest")}</SelectItem>
                  <SelectItem value="maior">{t("filters.orderHighest")}</SelectItem>
                  <SelectItem value="menor">{t("filters.orderLowest")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("filters.minValue")}</label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={valorMin}
                onChange={(e) => setValorMin(e.target.value)}
                className="mt-1 h-10 bg-card-elevated"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("filters.maxValue")}</label>
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
          {periodoChipLabel && (
            <ActiveChip
              label={periodoChipLabel}
              onRemove={() => {
                setPeriodo("todos");
                setCustomFrom(undefined);
                setCustomTo(undefined);
              }}
              removeLabel={t("filters.active.remove", { label: periodoChipLabel })}
            />
          )}
          {categoriaAtiva && (
            <ActiveChip
              label={t("filters.active.category", { name: categoriaAtiva.nome })}
              onRemove={() => setCatFilter("todas")}
              removeLabel={t("filters.active.remove", { label: categoriaAtiva.nome })}
            />
          )}
          {pagamentoAtivo && (
            <ActiveChip
              label={t("filters.active.payment", {
                name: tPag(pagamentoAtivo.id, pagamentoAtivo.label),
              })}
              onRemove={() => setPagFilter("todas")}
              removeLabel={t("filters.active.remove", {
                label: tPag(pagamentoAtivo.id, pagamentoAtivo.label),
              })}
            />
          )}
          {hasMin && (
            <ActiveChip
              label={t("filters.active.above", { value: formatBRL(minNum) })}
              onRemove={() => setValorMin("")}
            />
          )}
          {hasMax && (
            <ActiveChip
              label={t("filters.active.below", { value: formatBRL(maxNum) })}
              onRemove={() => setValorMax("")}
            />
          )}
          {q.trim() && (
            <ActiveChip
              label={t("filters.active.search", { q: q.trim() })}
              onRemove={() => setQ("")}
            />
          )}
          {order !== "recente" && (
            <ActiveChip
              label={t("filters.active.order", {
                name: t(
                  `filters.order${order === "antigo" ? "Oldest" : order === "maior" ? "Highest" : order === "menor" ? "Lowest" : "Recent"}`,
                ),
              })}
              onRemove={() => setOrder("recente")}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("filters.clear")}
          </Button>
        </div>
      )}

      {/* Resumo premium (V3) */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 stagger">
        <AppSummaryCard
          tone="neutral"
          icon={<Hash className="h-4 w-4" />}
          label={t("summary.found")}
          value={<CountNumber value={filtered.length} />}
          hint={mesRef === "todos" ? t("summary.foundHintPeriod") : ymToLabel(mesRef)}
        />
        <AppSummaryCard
          tone="gastos"
          icon={<Wallet className="h-4 w-4" />}
          label={t("summary.total")}
          value={<Money value={total} />}
          hint={t("summary.totalHint")}
        />
        <AppSummaryCard
          tone="relatorios"
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("summary.avg")}
          value={<Money value={media} />}
          hint={
            filtered.length
              ? t("summary.avgHint", { count: filtered.length })
              : t("summary.noValue")
          }
        />
        <AppSummaryCard
          tone="metas"
          icon={<Tag className="h-4 w-4" />}
          label={t("summary.topCategory")}
          value={
            topCategoria ? (
              <span className="truncate block">{topCategoria.nome}</span>
            ) : (
              <span className="text-muted-foreground">{t("summary.noValue")}</span>
            )
          }
          hint={topCategoria ? formatBRL(topCategoria.valor) : t("summary.noData")}
        />
      </div>

      {/* Barra de seleção em massa */}
      {filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card-elevated px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={() => toggleAllVisible()}
              aria-label={t("bulk.selectAll")}
            />
            <span>
              {allSelected
                ? t("bulk.allSelected", { count: filtered.length })
                : selected.size > 0
                  ? t("bulk.selected", { count: selected.size })
                  : hasAnyFilter
                    ? t("bulk.selectFiltered", { count: filtered.length })
                    : t("bulk.selectAllN", { count: filtered.length })}
            </span>
          </label>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-xs text-muted-foreground">
                {t("bulk.total", { value: formatBRL(valorSelecionado) })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-10 sm:h-8 rounded-full px-3 text-xs"
                onClick={clearSelection}
              >
                {t("bulk.clear")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 sm:h-8 rounded-full px-3 text-xs"
                  >
                    <CalendarIcon className="mr-1 h-3.5 w-3.5" />
                    {t("bulk.moveToMonth")}
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
                          toast.success(t("bulk.moved", { count: n, month: o.label }));
                          clearSelection();
                        } else {
                          toast.error(t("bulk.moveError"));
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
                className="h-10 sm:h-8 rounded-full px-3 text-xs"
                onClick={() => setConfirmBulk(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("bulk.delete")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="mt-6">
          {hasAnyFilter ? (
            <PremiumEmptyState
              icon={<Search className="h-6 w-6" />}
              title={t("empty.filteredTitle")}
              description={t("empty.filteredSub")}
              cta={
                <Button onClick={clearAll} variant="outline" className="min-h-11 rounded-full">
                  {t("empty.clearFilters")}
                </Button>
              }
            />
          ) : mesRef !== "todos" ? (
            <AppEmptyStateVisual
              tone="gastos"
              icon={<Wallet className="h-6 w-6" />}
              title={t("empty.monthTitle")}
              description={t("empty.monthSub", { month: ymToLabel(mesRef) })}
              action={
                <Button asChild className="min-h-11 rounded-full font-semibold">
                  <Link to="/adicionar">{t("empty.monthCta", { month: ymToLabel(mesRef) })}</Link>
                </Button>
              }
            />
          ) : (
            <AppEmptyStateVisual
              tone="gastos"
              icon={<Sparkles className="h-6 w-6" />}
              title={t("empty.noneTitle")}
              description={t("empty.noneSub")}
              action={
                <div className="flex w-full flex-col items-center gap-4">
                  <Button asChild className="min-h-11 rounded-full font-semibold">
                    <Link to="/adicionar">{t("empty.noneCta")}</Link>
                  </Button>
                  <ol className="grid w-full max-w-sm gap-2 text-left text-xs sm:grid-cols-3">
                    {(["expense", "details", "summary"] as const).map((k, i) => (
                      <li
                        key={k}
                        className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated px-3 py-2"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="text-foreground">{t(`empty.steps.${k}`)}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="max-w-sm text-[11px] text-muted-foreground">{t("empty.helper")}</p>
                </div>
              }
            />
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2 pb-4" data-fornecedores-map>
          <AnimatePresence initial={false}>
            {filtered.map((g, idx) => {
              const cat = getCategoriaById(g.categoriaId);
              const formaInfo = FORMAS_PAGAMENTO.find((f) => f.id === g.formaPagamento);
              const pag = formaInfo ? tPag(formaInfo.id, formaInfo.label) : undefined;
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
                    highlightId === g.id &&
                      "ring-2 ring-emerald-500/70 border-emerald-500/40 bg-emerald-500/5",
                    selected.has(g.id) && "border-primary/50 bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={selected.has(g.id)}
                    onCheckedChange={() => toggleOne(g.id)}
                    aria-label={t("item.select")}
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
                      {cat?.nome ?? t("item.otherCategory")} · {formatDateBR(g.data)}
                      {g.horario ? ` ${t("item.at")} ${g.horario}` : ""} · {pag}
                      {g.tipoGasto === "parcelado" && g.totalParcelas
                        ? ` · ${g.parcelaAtual}/${g.totalParcelas}`
                        : g.tipoGasto === "recorrente"
                          ? ` · ${t("item.recurring")}`
                          : ""}
                    </p>
                    {g.fornecedorId && fornecedoresPorId[g.fornecedorId] ? (
                      <p className="truncate text-[11px] text-muted-foreground/80">
                        {t("item.supplier", {
                          name:
                            fornecedoresPorId[g.fornecedorId].apelido ||
                            fornecedoresPorId[g.fornecedorId].nome_fantasia ||
                            fornecedoresPorId[g.fornecedorId].razao_social ||
                            fornecedoresPorId[g.fornecedorId].nome,
                        })}
                      </p>
                    ) : null}
                    {g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth) ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-on-soft">
                        <CalendarIcon className="h-3 w-3" />
                        {ymToLabel(g.invoiceMonth)}
                      </span>
                    ) : (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <CalendarIcon className="h-3 w-3" />
                        {mesAnoToLabel(mesEfetivoGasto(g).mes, mesEfetivoGasto(g).ano)}
                      </span>
                    )}
                    {g.origem === "mercado_inteligente" && (
                      <span
                        className="ml-1 mt-1 inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-on-soft"
                        title={t("item.originMercadoTitle")}
                      >
                        <ShoppingBasket className="h-3 w-3" />
                        {t("item.originMercadoBadge")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(g)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t("item.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t("item.more")}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(g)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("item.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={async () => {
                              if (!(await requireOnline())) return;
                              deleteGasto(g.id);
                              toast.success(t("item.deleted"));
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("item.delete")}
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

      <AlertDialog
        open={confirmBulk}
        onOpenChange={(o) => !o && !excluindoBulk && setConfirmBulk(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulk.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey={selected.size === 1 ? "bulk.confirmDescOne" : "bulk.confirmDescMany"}
                values={{ count: selected.size, value: formatBRL(valorSelecionado) }}
                components={{ 1: <strong />, 3: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoBulk}>{t("bulk.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executarBulkDelete();
              }}
              disabled={excluindoBulk}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindoBulk ? t("bulk.deleting") : t("bulk.deleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* AdSlot — apenas free_ads ativo (Fase 1E-B2L) */}
      <AdSlot className="mt-4" slotId="gastos-bottom" />
    </MobileShell>
  );
}

function ActiveChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3 py-1 text-xs font-medium animate-fade-in">
      {label}
      <button
        onClick={onRemove}
        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
        aria-label={removeLabel ?? label}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

type StatTone = "neutral" | "brand" | "info" | "success";

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
  const metricTone =
    tone === "brand"
      ? "primary"
      : tone === "success"
        ? "positive"
        : tone === "info"
          ? "default"
          : "default";
  return (
    <MetricCard
      label={label}
      icon={icon}
      tone={metricTone}
      value={<span className={cn("num", highlight && "text-xl sm:text-2xl")}>{value}</span>}
      hint={hint}
      className={cn(
        "hover-lift card-press animate-rise",
        highlight && "bg-gradient-to-br from-card-elevated via-card to-card",
      )}
    />
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
      <line
        x1="6"
        y1="68"
        x2="118"
        y2="68"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1.5"
      />
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
        cx="110"
        cy="18"
        r="3.5"
        fill="oklch(0.78 0.16 55)"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 1.2, duration: 0.4, type: "spring" }}
      />
    </svg>
  );
}
