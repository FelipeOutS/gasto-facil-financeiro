import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  Repeat,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  Wallet,
  Target,
  CalendarClock,
  Filter,
  ArrowUpRight,
  Briefcase,
  Coins,
  Gift,
  HandCoins,
  Receipt,
  ArrowDownUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { makeRevenueT, revenueSuffix } from "@/lib/revenue-vocab";
import { PageSkeleton } from "@/components/PageSkeleton";
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
import { requireOnline, isOnline } from "@/lib/use-online-status";
import { enqueueIncome } from "@/lib/offline/offline-income-queue";
import { TIPOS_RECEITA, type Receita, type TipoReceita } from "@/lib/types";
import {
  formatBRL,
  formatDateBR,
  formatMonthYear,
  parseBRLInput,
  todayISO,
} from "@/lib/format";
import { Money } from "@/components/Money";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useClientes } from "@/lib/clientes";
import { ClienteSelect, nomeExibicaoCliente } from "@/components/ClienteSelect";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  AppPageHeader,
  AppModuleBanner,
  AppEmptyStateVisual,
} from "@/components/app-v2";

type RendaSearch = { ano?: number; mes?: number };

const MONTH_NAMES_PT = [
  "janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const MONTH_SHORT_FALLBACK = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function normalizeDescricao(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tipoIcon(tipo: TipoReceita) {
  switch (tipo) {
    case "salario":
      return Briefcase;
    case "freelance":
      return Coins;
    case "comissao":
      return ArrowUpRight;
    case "venda":
      return Receipt;
    case "reembolso":
      return ArrowDownUp;
    case "pix":
      return HandCoins;
    case "bonus":
      return Gift;
    default:
      return Wallet;
  }
}

const TIPO_COLORS: Record<TipoReceita, string> = {
  salario: "var(--cat-salario)",
  freelance: "var(--cat-trabalho)",
  comissao: "var(--cat-pix)",
  venda: "var(--cat-mercado)",
  reembolso: "var(--cat-internet)",
  pix: "var(--cat-transferencia)",
  bonus: "var(--cat-presentes)",
  outros: "var(--cat-outros)",
};

const PIE_FALLBACK = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#94a3b8"];

export const Route = createFileRoute("/renda/")({
  head: () => ({ meta: [{ title: "Renda — Gasto Inteligente" }] }),
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
  const { t: tBase, i18n } = useTranslation("renda");
  const ready = useBootstrap();
  const { profile, user } = useAuth();
  const tipoCad = profile?.tipo_cadastro as TipoCadastro;
  const vocab = getVocab(tipoCad);
  const suffix = revenueSuffix(tipoCad);
  // `t` aplica vocabulário contextual: MEI/Empresa veem variantes
  // "<chave>_mei" / "<chave>_empresa" quando existem; demais usam padrão.
  const t = useMemo(() => makeRevenueT(tBase, suffix), [tBase, suffix]);
  const monthShort = useMemo(() => {
    const raw = t("months", { returnObjects: true }) as unknown;
    return Array.isArray(raw) && raw.length === 12 ? (raw as string[]) : MONTH_SHORT_FALLBACK;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);
  const tipoLabel = (id: TipoReceita) => t(`tipo.${id}`);
  const receitas = useStore(() => getReceitas());
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/renda/" });
  const isMobile = useIsMobile();

  const today = new Date();
  const [ym, setYm] = useState({
    ano: search.ano ?? today.getFullYear(),
    mes: search.mes ?? today.getMonth() + 1,
  });

  useEffect(() => {
    void navigate({ search: { ano: ym.ano, mes: ym.mes }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym.ano, ym.mes]);

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  // ===================== DERIVED =====================
  const doMes = useMemo(
    () => receitas.filter((r) => r.mes === ym.mes && r.ano === ym.ano),
    [receitas, ym.mes, ym.ano],
  );
  const totalMes = useMemo(() => doMes.reduce((s, r) => s + r.valor, 0), [doMes]);
  const salarioMes = useMemo(
    () => doMes.filter((r) => r.tipo === "salario").reduce((s, r) => s + r.valor, 0),
    [doMes],
  );
  const recorrentesMes = useMemo(
    () => doMes.filter((r) => r.recorrente),
    [doMes],
  );
  const recorrentesValor = useMemo(
    () => recorrentesMes.reduce((s, r) => s + r.valor, 0),
    [recorrentesMes],
  );
  const outrasMes = totalMes - salarioMes;
  const extraMes = useMemo(
    () =>
      doMes
        .filter((r) => r.tipo !== "salario")
        .reduce((s, r) => s + r.valor, 0),
    [doMes],
  );

  // Mês anterior para comparação
  const mesAnteriorYm = useMemo(() => {
    const d = new Date(ym.ano, ym.mes - 2, 1);
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }, [ym]);
  const totalMesAnterior = useMemo(
    () =>
      receitas
        .filter((r) => r.mes === mesAnteriorYm.mes && r.ano === mesAnteriorYm.ano)
        .reduce((s, r) => s + r.valor, 0),
    [receitas, mesAnteriorYm],
  );

  const variacaoPct = useMemo(() => {
    if (totalMesAnterior <= 0) return null;
    return ((totalMes - totalMesAnterior) / totalMesAnterior) * 100;
  }, [totalMes, totalMesAnterior]);

  // Já recebido vs futuro (no mês selecionado)
  const todayStr = todayISO();
  const isMesAtual = ym.ano === today.getFullYear() && ym.mes === today.getMonth() + 1;
  const recebidoMes = useMemo(() => {
    if (!isMesAtual) return totalMes;
    return doMes.filter((r) => r.data <= todayStr).reduce((s, r) => s + r.valor, 0);
  }, [doMes, totalMes, isMesAtual, todayStr]);
  const aReceberMes = Math.max(0, totalMes - recebidoMes);

  // Evolução últimos 6 meses
  const evolucao6m = useMemo(() => {
    const arr: { key: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ym.ano, ym.mes - 1 - i, 1);
      const m = d.getMonth() + 1;
      const a = d.getFullYear();
      const total = receitas
        .filter((r) => r.mes === m && r.ano === a)
        .reduce((s, r) => s + r.valor, 0);
      arr.push({
        key: `${a}-${m}`,
        label: monthShort[m - 1],
        total,
      });
    }
    return arr;
  }, [receitas, ym]);

  // Composição por tipo (mês atual)
  const composicao = useMemo(() => {
    const map = new Map<TipoReceita, number>();
    for (const r of doMes) {
      map.set(r.tipo, (map.get(r.tipo) ?? 0) + r.valor);
    }
    return Array.from(map.entries())
      .map(([tipo, valor]) => ({
        tipo,
        valor,
        label: tipoLabel(tipo),
        cor: TIPO_COLORS[tipo],
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [doMes]);

  // Insights
  const insights = useMemo(() => {
    const out: { icon: typeof Sparkles; text: string; tone: "good" | "neutral" | "warn" }[] = [];
    if (totalMes === 0) {
      out.push({ icon: Sparkles, text: t("insights.empty"), tone: "neutral" });
    }
    if (variacaoPct !== null) {
      if (variacaoPct > 1) {
        out.push({
          icon: TrendingUp,
          text: t("insights.up", { pct: variacaoPct.toFixed(1) }),
          tone: "good",
        });
      } else if (variacaoPct < -1) {
        out.push({
          icon: TrendingDown,
          text: t("insights.down", { pct: Math.abs(variacaoPct).toFixed(1) }),
          tone: "warn",
        });
      }
    }
    if (totalMes > 0 && composicao.length > 0) {
      const maior = composicao[0];
      const pct = (maior.valor / totalMes) * 100;
      out.push({
        icon: Wallet,
        text: t("insights.topSource", { pct: pct.toFixed(0), label: maior.label.toLowerCase() }),
        tone: "neutral",
      });
    }
    if (recorrentesMes.length > 0) {
      out.push({
        icon: Repeat,
        text: t("insights.recurring", { count: recorrentesMes.length, value: formatBRL(recorrentesValor) }),
        tone: "good",
      });
    }
    if (totalMes > 0 && extraMes > 0) {
      const pct = (extraMes / totalMes) * 100;
      out.push({
        icon: Sparkles,
        text: t("insights.extraShare", { pct: pct.toFixed(0) }),
        tone: "neutral",
      });
    } else if (totalMes > 0 && extraMes === 0) {
      out.push({ icon: Sparkles, text: t("insights.noExtra"), tone: "neutral" });
    }
    return out.slice(0, 4);
  }, [t, totalMes, variacaoPct, composicao, recorrentesMes.length, recorrentesValor, extraMes]);

  // Próximas recorrências (3 meses à frente)
  const proximasRecorrencias = useMemo(() => {
    const lista: { receita: Receita; data: string }[] = [];
    const refDate = new Date();
    for (const r of receitas) {
      if (!r.recorrente) continue;
      const d = new Date(r.data + "T12:00:00");
      if (d > refDate) {
        lista.push({ receita: r, data: r.data });
      }
    }
    return lista
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(0, 5);
  }, [receitas]);

  // Histórico
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

  // ===================== FILTROS =====================
  const [filtroTipo, setFiltroTipo] = useState<"todas" | TipoReceita>("todas");
  const [filtroRec, setFiltroRec] = useState<"todas" | "recorrente" | "unica">("todas");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<"data" | "valor" | "tipo">("data");

  const doMesFiltrado = useMemo(() => {
    const q = normalizeDescricao(busca);
    const out = doMes.filter((r) => {
      if (filtroTipo !== "todas" && r.tipo !== filtroTipo) return false;
      if (filtroRec === "recorrente" && !r.recorrente) return false;
      if (filtroRec === "unica" && r.recorrente) return false;
      if (q && !normalizeDescricao(r.descricao).includes(q)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (ordem === "valor") return b.valor - a.valor;
      if (ordem === "tipo") return a.tipo.localeCompare(b.tipo);
      return b.data.localeCompare(a.data);
    });
    return out;
  }, [doMes, filtroTipo, filtroRec, busca, ordem]);

  // ===================== NOVA ENTRADA =====================
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoReceita>("salario");
  const [recorrente, setRecorrente] = useState(true);
  const [meses, setMeses] = useState(12);
  const [novaClienteId, setNovaClienteId] = useState<string | null>(null);
  const { ativos: clientesAtivos, porId: clientesPorId } = useClientes();
  type NovaPayload = {
    descricao: string;
    valor: number;
    data: string;
    tipo: TipoReceita;
    recorrente: boolean;
    recorrenteMeses?: number;
    clienteId?: string | null;
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
    setNovaClienteId(null);
  }

  async function persistNova(payload: NovaPayload) {
    // Fluxo offline: apenas para receita não recorrente, com usuário logado.
    if (!payload.recorrente && user?.id && !isOnline()) {
      try {
        await enqueueIncome(user.id, {
          descricao: payload.descricao,
          valor: payload.valor,
          data: payload.data,
          tipo: payload.tipo,
          recorrente: false,
          clienteId: payload.clienteId ?? null,
        });
        toast.success(
          "Receita salva offline. Ela será sincronizada quando a internet voltar.",
        );
        setOpen(false);
        reset();
        return;
      } catch (err) {
        console.error("[offline-income] enqueue failed", err);
        toast.error("Não foi possível salvar offline.");
        return;
      }
    }
    try {
      await addReceita(payload);
      toast.success(t("toast.added"));
      setOpen(false);
      reset();
    } catch {
      // addReceita já exibiu toast.error apropriado.
    }
  }

  function openWithPreset(preset: { tipo: TipoReceita; recorrente: boolean; descricao?: string }) {
    if (isMobile) {
      void navigate({
        to: "/renda/nova",
        search: {
          tipo: preset.tipo,
          recorrente: preset.recorrente ? "1" : "0",
          descricao: preset.descricao,
        } as never,
      });
      return;
    }
    reset();
    setTipo(preset.tipo);
    setRecorrente(preset.recorrente);
    if (preset.descricao) setDescricao(preset.descricao);
    setOpen(true);
  }

  function openEdit(r: Receita) {
    if (isMobile) {
      void navigate({ to: "/renda/$id/editar", params: { id: r.id } });
      return;
    }
    setEditTarget(r);
  }

  async function handleSave() {
    const valor = parseBRLInput(valorStr);
    const desc = descricao.trim();
    if (!valor || !desc) {
      toast.error(t("toast.fillFields"));
      return;
    }
    // Não bloqueia se offline: receita não recorrente cai na fila.
    // Recorrência ainda precisa de internet.
    if (recorrente && !(await requireOnline())) return;
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
      clienteId: novaClienteId,
    };

    if (parecida) {
      setConfirmDup({ parecida, payload });
      return;
    }
    persistNova(payload);
  }

  // Edit / Delete targets
  const [editTarget, setEditTarget] = useState<Receita | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Receita | null>(null);

  // Histórico: busca + paginação
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
          const tLabel = normalizeDescricao(tipoLabel(r.tipo));
          if (desc.includes(q)) return true;
          if (tLabel.includes(q)) return true;
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

  if (!ready) return <PageSkeleton />;

  return (
    <MobileShell>
      {/* V3 Header */}
      <AppPageHeader
        tone="receitas"
        icon={<TrendingUp className="h-5 w-5" />}
        title={t("v3.header.title", { defaultValue: vocab.rendaTitle })}
        description={t("v3.header.description")}
      />

      {/* V3 Banner */}
      <AppModuleBanner
        tone="receitas"
        className="mt-4"
        title={t("v3.banner.title")}
        subtitle={t("v3.banner.subtitle")}
        imageAlt={t("v3.banner.alt")}
        cta={
          <Button
            size="sm"
            className="h-10 rounded-full px-4 font-semibold"
            onClick={() =>
              isMobile ? navigate({ to: "/renda/nova" }) : setOpen(true)
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("v3.banner.cta")}
          </Button>
        }
      />


      {/* NAV DE MÊS */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card px-2 py-2 shadow-sm">
        <button
          onClick={() => changeMonth(-1)}
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:bg-card-elevated hover:text-foreground active:scale-95"
          aria-label={t("nav.prev")}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold capitalize">
          {formatMonthYear(ym.ano, ym.mes)}
        </p>
        <button
          onClick={() => changeMonth(1)}
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:bg-card-elevated hover:text-foreground active:scale-95"
          aria-label={t("nav.next")}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* CARD PRINCIPAL — RESUMO PREMIUM */}
      <AnimatePresence mode="wait">
        <motion.section
          key={`${ym.ano}-${ym.mes}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="relative mt-3 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-card-elevated p-5 shadow-elevated sm:p-6"
        >
          {/* glow decorativo */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--success) 0%, transparent 70%)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -left-12 h-40 w-40 rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--cat-pix) 0%, transparent 70%)" }}
          />

          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("summary.totalLabel")}
              </p>
              <Money value={totalMes} className="num mt-1 block text-4xl font-extrabold tracking-tight sm:text-5xl" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("summary.entries", { count: doMes.length })}
                </span>
                {variacaoPct !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      variacaoPct >= 0
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {variacaoPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {t("summary.variation", { sign: variacaoPct >= 0 ? "+" : "", value: variacaoPct.toFixed(1) })}
                  </span>
                )}
              </div>
            </div>
            <div className="hidden h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success sm:grid">
              <TrendingUp className="h-7 w-7" />
            </div>
          </div>

          {/* mini barras grid 4 */}
          <div className="relative mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <MiniStat
              label={t("miniStat.salario")}
              value={salarioMes}
              icon={Briefcase}
              accent="text-success"
              total={totalMes}
            />
            <MiniStat
              label={t("miniStat.extra")}
              value={extraMes}
              icon={Coins}
              accent="text-[color:var(--cat-pix)]"
              total={totalMes}
            />
            <MiniStat
              label={t("miniStat.recorrentes")}
              value={recorrentesValor}
              icon={Repeat}
              accent="text-[color:var(--cat-trabalho)]"
              footer={t("miniStat.entries", { count: recorrentesMes.length })}
            />
            <MiniStat
              label={t("miniStat.outras")}
              value={outrasMes}
              icon={Wallet}
              accent="text-[color:var(--cat-presentes)]"
              total={totalMes}
            />
          </div>
        </motion.section>
      </AnimatePresence>

      {/* INSIGHTS */}
      {insights.length > 0 && (
        <section className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {insights.map((it, i) => {
            const Icon = it.icon;
            const tone =
              it.tone === "good"
                ? "border-success/30 bg-success/5 text-success"
                : it.tone === "warn"
                  ? "border-warning/30 bg-warning/5 text-warning"
                  : "border-border bg-card text-muted-foreground";
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-3.5 backdrop-blur-sm",
                  tone,
                )}
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-background/40">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="text-xs leading-snug text-foreground/90 sm:text-sm">{it.text}</p>
              </motion.div>
            );
          })}
        </section>
      )}

      {/* CTA NOVA ENTRADA + ATALHOS */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          {isMobile ? (
            <Button
              size="lg"
              onClick={() => navigate({ to: "/renda/nova" })}
              className="card-press h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95"
            >
              <Plus className="mr-1 h-5 w-5" />
              {t("cta.new")}
            </Button>
          ) : (
            <DialogTrigger asChild>
              <Button
                size="lg"
                className="card-press h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95"
              >
                <Plus className="mr-1 h-5 w-5" />
                {t("cta.new")}
              </Button>
            </DialogTrigger>
          )}
          <div className="flex flex-wrap gap-1.5">
            <QuickAction icon={Briefcase} label={t("cta.quick.salario")} onClick={() => openWithPreset({ tipo: "salario", recorrente: true })} />
            <QuickAction icon={Coins} label={t("cta.quick.freela")} onClick={() => openWithPreset({ tipo: "freelance", recorrente: false })} />
            <QuickAction icon={Repeat} label={t("cta.quick.recorrente")} onClick={() => openWithPreset({ tipo: "salario", recorrente: true })} />
            <QuickAction icon={Receipt} label={t("cta.quick.avulsa")} onClick={() => openWithPreset({ tipo: "outros", recorrente: false })} />
          </div>
        </div>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.newTitle")}</DialogTitle>
            <DialogDescription>{t("dialog.newDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.fields.descricao")}</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={t("dialog.fields.descricaoPlaceholder")}
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("dialog.fields.valor")}</Label>
                <Input
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                  placeholder="0,00"
                  className="num mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("dialog.fields.data")}</Label>
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.fields.tipo")}</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
                <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEITA.map((tp) => (
                    <SelectItem key={tp.id} value={tp.id}>{tipoLabel(tp.id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ClienteSelect
              value={novaClienteId}
              onChange={setNovaClienteId}
              clientesAtivos={clientesAtivos}
            />
            <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t("dialog.fields.repeat")}</p>
                <p className="text-xs text-muted-foreground">{t("dialog.fields.repeatHint")}</p>
              </div>
              <Switch checked={recorrente} onCheckedChange={setRecorrente} />
            </div>
            {recorrente && (
              <div>
                <Label className="text-xs text-muted-foreground">{t("dialog.fields.repeatMonths")}</Label>
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
            <Button variant="outline" onClick={() => setOpen(false)}>{t("dialog.cancel")}</Button>
            <Button onClick={handleSave}>{t("dialog.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GRÁFICOS */}
      <section className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Evolução 6 meses */}
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm lg:col-span-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("charts.evolutionKicker")}
              </p>
              <h3 className="text-sm font-bold">{t("charts.evolutionTitle")}</h3>
            </div>
            {(() => {
              const valores = evolucao6m.map((e) => e.total);
              const meses = valores.filter((v) => v > 0).length;
              const media = meses > 0 ? valores.reduce((s, v) => s + v, 0) / meses : 0;
              const pico = Math.max(0, ...valores);
              return (
                <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
                  <span className="rounded-full border border-border bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t("charts.average")} <span className="text-foreground tabular-nums">{formatBRL(media)}</span>
                  </span>
                  <span className="rounded-full border border-border bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t("charts.peak")} <span className="text-foreground tabular-nums">{formatBRL(pico)}</span>
                  </span>
                </div>
              );
            })()}
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolucao6m} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="rendaArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.72 0.18 152)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="oklch(0.72 0.18 152)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.32 0.008 260)" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.78 0.005 260)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="oklch(0.78 0.005 260)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                />
                <ReTooltip
                  contentStyle={{
                    background: "oklch(0.225 0.006 260)",
                    border: "1px solid oklch(0.32 0.008 260)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [formatBRL(v), t("charts.incomeLabel")]}
                  labelStyle={{ color: "oklch(0.78 0.005 260)" }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="oklch(0.72 0.18 152)"
                  strokeWidth={2.5}
                  fill="url(#rendaArea)"
                />
                <Line type="monotone" dataKey="total" stroke="oklch(0.72 0.18 152)" strokeWidth={2.5} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Composição */}
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("charts.compositionKicker")}
              </p>
              <h3 className="text-sm font-bold">{t("charts.compositionTitle")}</h3>
            </div>
          </div>
          {composicao.length === 0 ? (
            <div className="grid h-44 place-items-center text-xs text-muted-foreground">
              {t("charts.noData")}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
              <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={composicao}
                      dataKey="valor"
                      nameKey="label"
                      innerRadius={32}
                      outerRadius={52}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {composicao.map((c, i) => (
                        <Cell key={c.tipo} fill={c.cor || PIE_FALLBACK[i % PIE_FALLBACK.length]} />
                      ))}
                    </Pie>
                    <ReTooltip
                      contentStyle={{
                        background: "oklch(0.225 0.006 260)",
                        border: "1px solid oklch(0.32 0.008 260)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(v: number, n) => [formatBRL(v), n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full min-w-0 flex-1 space-y-1.5 text-[11px] sm:text-xs">
                {composicao.slice(0, 5).map((c, i) => (
                  <li key={c.tipo} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: c.cor || PIE_FALLBACK[i % PIE_FALLBACK.length] }}
                    />
                    <span className="text-muted-foreground break-words">{c.label}</span>
                    <span className="num ml-auto shrink-0 font-semibold tabular-nums">
                      {totalMes > 0 ? `${((c.valor / totalMes) * 100).toFixed(0)}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* PREVISÃO + RECORRÊNCIAS */}
      <section className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("forecast.kicker")}
              </p>
              <h3 className="text-sm font-bold">
                {isMesAtual ? t("forecast.titleCurrent") : t("forecast.titleSelected")}
              </h3>
            </div>
            <Target className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-[11px] text-muted-foreground">{t("forecast.received")}</p>
                <Money value={recebidoMes} className="num text-2xl font-bold text-success" />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">{t("forecast.toReceive")}</p>
                <Money value={aReceberMes} className="num text-base font-semibold text-foreground" />
              </div>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-success to-emerald-300"
                initial={{ width: 0 }}
                animate={{ width: `${totalMes > 0 ? Math.min(100, (recebidoMes / totalMes) * 100) : 0}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {t("forecast.total")} <span className="num font-semibold text-foreground">{formatBRL(totalMes)}</span>
              </span>
              <span>
                {t("forecast.completed", { pct: totalMes > 0 ? ((recebidoMes / totalMes) * 100).toFixed(0) : "0" })}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("upcoming.kicker")}
              </p>
              <h3 className="text-sm font-bold">{t("upcoming.title")}</h3>
            </div>
            <Repeat className="h-4 w-4 text-muted-foreground" />
          </div>
          {proximasRecorrencias.length === 0 ? (
            <p className="grid h-24 place-items-center rounded-2xl border border-dashed border-border text-xs text-muted-foreground">
              {t("upcoming.empty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {proximasRecorrencias.map(({ receita: r }) => {
                const Icon = tipoIcon(r.tipo);
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl bg-card-elevated px-3 py-2 transition-colors hover:bg-accent/40"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      style={{ background: `${TIPO_COLORS[r.tipo]}25`, color: TIPO_COLORS[r.tipo] }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.descricao}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateBR(r.data)}</p>
                    </div>
                    <span className="num text-sm font-semibold text-success">
                      +{formatBRL(r.valor)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* TABS */}
      <Tabs defaultValue="mes" className="mt-5">
        <TabsList className="grid w-full grid-cols-4 bg-card">
          <TabsTrigger value="mes">{t("tabs.month")}</TabsTrigger>
          <TabsTrigger value="recorrentes">{t("tabs.recurring")}</TabsTrigger>
          <TabsTrigger value="historico">{t("tabs.history")}</TabsTrigger>
          <TabsTrigger value="previsoes">{t("tabs.forecasts")}</TabsTrigger>
        </TabsList>

        {/* ESTE MÊS */}
        <TabsContent value="mes" className="mt-3 space-y-3">
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t("filters.search")}
                className="h-9 bg-card-elevated pl-9 text-sm"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v as typeof filtroTipo)}>
              <SelectTrigger className="h-9 w-auto min-w-[120px] bg-card-elevated text-xs">
                <Filter className="mr-1 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{t("filters.allTypes")}</SelectItem>
                {TIPOS_RECEITA.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>{tipoLabel(tp.id)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroRec} onValueChange={(v) => setFiltroRec(v as typeof filtroRec)}>
              <SelectTrigger className="h-9 w-auto min-w-[120px] bg-card-elevated text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{t("filters.all")}</SelectItem>
                <SelectItem value="recorrente">{t("filters.onlyRecurring")}</SelectItem>
                <SelectItem value="unica">{t("filters.onlyUnique")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ordem} onValueChange={(v) => setOrdem(v as typeof ordem)}>
              <SelectTrigger className="h-9 w-auto min-w-[110px] bg-card-elevated text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="data">{t("filters.sortRecent")}</SelectItem>
                <SelectItem value="valor">{t("filters.sortValue")}</SelectItem>
                <SelectItem value="tipo">{t("filters.sortType")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {doMesFiltrado.length === 0 ? (
            doMes.length === 0 ? (
              <AppEmptyStateVisual
                tone="receitas"
                icon={<TrendingUp className="h-6 w-6" />}
                title={t("v3.empty.title")}
                description={t("v3.empty.description")}
                action={
                  <div className="flex w-full flex-col items-center gap-4">
                    <Button
                      size="sm"
                      onClick={() => (isMobile ? navigate({ to: "/renda/nova" }) : setOpen(true))}
                      className="min-h-11 rounded-full font-semibold"
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      {t("v3.empty.cta")}
                    </Button>
                    <ol className="grid w-full max-w-sm gap-2 text-left text-xs sm:grid-cols-3">
                      {(["source", "amount", "summary"] as const).map((k, i) => (
                        <li
                          key={k}
                          className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated px-3 py-2"
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/15 text-[11px] font-semibold text-success">
                            {i + 1}
                          </span>
                          <span className="text-foreground">{t(`v3.empty.steps.${k}`)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                }
              />
            ) : (
              <EmptyRenda
                title={t("empty.filterTitle")}
                subtitle={t("empty.filterSubtitle")}
              />
            )
          ) : (
            <ul className="space-y-2">

              <AnimatePresence initial={false}>
                {doMesFiltrado.map((r, i) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
                  >
                    <ReceitaItem
                      r={r}
                      onEdit={() => openEdit(r)}
                      onDelete={() => setDeleteTarget(r)}
                      clienteNome={r.clienteId ? nomeExibicaoCliente(clientesPorId[r.clienteId]) : undefined}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </TabsContent>

        {/* RECORRENTES */}
        <TabsContent value="recorrentes" className="mt-3 space-y-2">
          {recorrentesMes.length === 0 ? (
            <EmptyRenda
              title={t("empty.recurringTitle")}
              subtitle={t("empty.recurringSubtitle")}
              onAction={() => openWithPreset({ tipo: "salario", recorrente: true })}
              actionLabel={t("empty.recurringAction")}
            />
          ) : (
            <ul className="space-y-2">
              {recorrentesMes.map((r) => (
                <ReceitaItem
                  key={r.id}
                  r={r}
                  onEdit={() => openEdit(r)}
                  onDelete={() => setDeleteTarget(r)}
                  clienteNome={r.clienteId ? nomeExibicaoCliente(clientesPorId[r.clienteId]) : undefined}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        {/* HISTÓRICO */}
        <TabsContent value="historico" className="mt-3 space-y-3">
          {historico.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground animate-fade-in">
              {t("history.empty")}
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
                  placeholder={t("history.search")}
                  className="h-11 bg-card-elevated pl-9"
                />
              </div>

              {historicoFiltrado.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                  {t("history.noResults", { query: historicoQuery })}
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
                                onEdit={() => openEdit(r)}
                                onDelete={() => setDeleteTarget(r)}
                                clienteNome={r.clienteId ? nomeExibicaoCliente(clientesPorId[r.clienteId]) : undefined}
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
                      {t("history.loadMore")}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* PREVISÕES */}
        <TabsContent value="previsoes" className="mt-3 space-y-3">
          <div className="rounded-3xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold">{t("forecasts.title")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("forecasts.subtitle")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => {
                const d = new Date(ym.ano, ym.mes - 1 + i + 1, 1);
                const m = d.getMonth() + 1;
                const a = d.getFullYear();
                const previsto = receitas
                  .filter((r) => r.recorrente && r.mes === m && r.ano === a)
                  .reduce((s, r) => s + r.valor, 0);
                return (
                  <div key={`${a}-${m}`} className="rounded-2xl bg-card-elevated p-3">
                    <p className="text-[11px] capitalize text-muted-foreground">
                      {monthShort[m - 1]}/{String(a).slice(-2)}
                    </p>
                    <Money value={previsto} className="num mt-0.5 block text-base font-bold text-success" />
                  </div>
                );
              })}
            </div>
          </div>
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
            <AlertDialogTitle>{t("duplicate.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                i18nKey="duplicate.body"
                t={t}
                values={{
                  descricao: confirmDup?.parecida.descricao ?? "",
                  valor: confirmDup ? formatBRL(confirmDup.parecida.valor) : "",
                }}
                components={[
                  <span key="0" className="font-medium text-foreground" />,
                  <span key="1" className="num font-medium text-foreground" />,
                ]}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("duplicate.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDup) persistNova(confirmDup.payload);
                setConfirmDup(null);
              }}
            >
              {t("duplicate.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function MiniStat({
  label,
  value,
  icon: Icon,
  accent,
  footer,
  total,
}: {
  label: string;
  value: number;
  icon: typeof Wallet;
  accent: string;
  footer?: string;
  total?: number;
}) {
  const { t } = useTranslation("renda");
  const pct = total && total > 0 ? Math.min(100, (value / total) * 100) : null;
  return (
    <div className="group min-w-0 overflow-hidden rounded-2xl bg-card-elevated/80 p-3 backdrop-blur-sm transition-all hover:bg-card-elevated hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accent)} />
      </div>
      <Money
        value={value}
        className="num mt-1 block truncate text-sm font-bold tabular-nums sm:text-base lg:text-lg"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {footer ? (
          <p className="truncate text-[10px] text-muted-foreground">{footer}</p>
        ) : pct !== null ? (
          <p className="truncate text-[10px] font-medium text-muted-foreground tabular-nums">
            {t("miniStat.pctMonth", { pct: pct.toFixed(0) })}
          </p>
        ) : <span />}
      </div>
      {pct !== null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/60">
          <div
            className={cn("h-full rounded-full bg-current transition-[width] duration-700", accent)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Wallet;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-press inline-flex h-14 items-center gap-1.5 rounded-2xl border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-all hover:border-success/40 hover:bg-card-elevated hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyRenda({
  title,
  subtitle,
  onAction,
  actionLabel,
  showSteps,
}: {
  title: string;
  subtitle: string;
  onAction?: () => void;
  actionLabel?: string;
  showSteps?: boolean;
}) {
  const { t } = useTranslation("renda");
  const exampleKeys = ["salario", "freelance", "comissao", "aluguel", "vendas"] as const;
  const stepKeys = ["source", "amount", "summary"] as const;
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground animate-rise">
      <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success animate-pop">
        <TrendingUp className="h-6 w-6" />
      </span>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs">{subtitle}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {exampleKeys.map((k) => (
          <Badge key={k} variant="outline" className="rounded-full text-[10px] font-normal">
            {t(`empty.examples.${k}`)}
          </Badge>
        ))}
      </div>
      {onAction && (
        <div className="mt-4">
          <Button size="sm" onClick={onAction} className="card-press rounded-full min-h-11">
            <Plus className="mr-1 h-4 w-4" /> {actionLabel ?? t("empty.defaultAction")}
          </Button>
        </div>
      )}
      {showSteps && (
        <>
          <ol className="mx-auto mt-5 grid max-w-sm gap-2 text-left text-xs sm:grid-cols-3">
            {stepKeys.map((key, idx) => (
              <li
                key={key}
                className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated px-3 py-2"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/15 text-[11px] font-semibold text-success">
                  {idx + 1}
                </span>
                <span className="text-foreground">{t(`empty.steps.${key}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mx-auto mt-3 max-w-sm text-[11px] text-muted-foreground">
            {t("empty.helper")}
          </p>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Item de receita
// =====================================================================
function ReceitaItem({
  r,
  onEdit,
  onDelete,
  clienteNome,
}: {
  r: Receita;
  onEdit: () => void;
  onDelete: () => void;
  clienteNome?: string;
}) {
  const { t } = useTranslation("renda");
  const tipoText = t(`tipo.${r.tipo}`);
  const Icon = tipoIcon(r.tipo);
  const isFuturo = r.data > todayISO();
  return (
    <li className="group flex items-center gap-2 overflow-hidden rounded-2xl border border-border bg-card px-3 py-3 transition-all hover:border-success/30 hover:bg-card-elevated">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={t("item.editAria", { name: r.descricao })}
      >
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ background: `${TIPO_COLORS[r.tipo]}25`, color: TIPO_COLORS[r.tipo] }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{r.descricao}</p>
            {r.recorrente && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--cat-trabalho)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--cat-trabalho)]">
                <Repeat className="h-2.5 w-2.5" /> {t("item.rec")}
              </span>
            )}
            {isFuturo && (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning">
                {t("item.future")}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {tipoText} · {formatDateBR(r.data)}
          </p>
          {clienteNome ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {t("item.client", { name: clienteNome })}
            </p>
          ) : null}
          <p className="num mt-0.5 text-sm font-semibold text-success">
            +{formatBRL(r.valor)}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-all hover:bg-card-elevated hover:text-foreground active:scale-95"
          aria-label={t("item.edit")}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-all hover:bg-card-elevated hover:text-destructive active:scale-95"
          aria-label={t("item.delete")}
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
  const { t } = useTranslation("renda");
  const open = !!receita;
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoReceita>("salario");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [scope, setScope] = useState<UpdateReceitaScope>("single");
  const { ativos: clientesAtivos } = useClientes();

  useEffect(() => {
    if (receita) {
      setDescricao(receita.descricao);
      setValorStr(receita.valor.toFixed(2).replace(".", ","));
      setData(receita.data);
      setTipo(receita.tipo);
      setClienteId(receita.clienteId ?? null);
      setScope("single");
    }
  }, [receita]);

  async function handleSave() {
    if (!receita) return;
    const valor = parseBRLInput(valorStr);
    if (!valor || !descricao.trim()) {
      toast.error(t("toast.fillFields"));
      return;
    }
    if (!(await requireOnline())) return;
    updateReceita(
      receita.id,
      { descricao: descricao.trim(), valor, data, tipo, clienteId },
      receita.recorrente && receita.recorrenciaId ? scope : "single",
    );
    toast.success(t("toast.updated"));
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.editTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.editDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.fields.descricao")}</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.fields.valor")}</Label>
              <Input
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                className="num mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.fields.data")}</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.fields.tipo")}</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
              <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_RECEITA.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>{t(`tipo.${tp.id}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ClienteSelect
            value={clienteId}
            onChange={setClienteId}
            clientesAtivos={clientesAtivos}
          />

          {receita?.recorrente && receita.recorrenciaId && (
            <div className="rounded-xl border border-border bg-card-elevated p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t("dialog.scopeTitle")}
              </p>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as UpdateReceitaScope)}
                className="mt-2 space-y-2"
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="single" id="scope-single" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{t("dialog.scope.single")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("dialog.scope.singleHint")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="forward" id="scope-forward" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{t("dialog.scope.forward")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("dialog.scope.forwardHint")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="all" id="scope-all" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{t("dialog.scope.all")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("dialog.scope.allHint")}
                    </span>
                  </span>
                </label>
              </RadioGroup>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("dialog.scopeDateNote")}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("dialog.cancel")}</Button>
          <Button onClick={handleSave}>{t("dialog.saveEdit")}</Button>
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
  const { t } = useTranslation("renda");
  const open = !!receita;
  const [scope, setScope] = useState<UpdateReceitaScope>("single");

  useEffect(() => {
    if (receita) setScope("single");
  }, [receita]);

  async function handleConfirm() {
    if (!receita) return;
    if (!(await requireOnline())) return;
    if (receita.recorrente && receita.recorrenciaId && scope !== "single") {
      if (scope === "forward") {
        deleteReceitaRecorrencia(receita.recorrenciaId, receita.mes, receita.ano);
      } else {
        deleteReceitaRecorrencia(receita.recorrenciaId);
      }
    } else {
      deleteReceita(receita.id);
    }
    toast.success(t("toast.removed"));
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("delete.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {receita?.recorrente && receita.recorrenciaId && (
          <div className="rounded-xl border border-border bg-card-elevated p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("delete.recurringQuestion")}
            </p>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as UpdateReceitaScope)}
              className="mt-2 space-y-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="single" id="del-single" className="mt-0.5" />
                <span className="font-medium">{t("delete.scope.single")}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="forward" id="del-forward" className="mt-0.5" />
                <span className="font-medium">{t("delete.scope.forward")}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="all" id="del-all" className="mt-0.5" />
                <span className="font-medium">{t("delete.scope.all")}</span>
              </label>
            </RadioGroup>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
