import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ContaPagarForm } from "@/components/contas/ContaPagarForm";
import {
  ArrowLeft,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt,
  Repeat,
  RotateCcw,
  CalendarDays,
  Search,
  X,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useTranslation } from "react-i18next";
import { EmptyState as PremiumEmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBadge as PremiumStatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal, LockChip } from "@/components/UpgradeModal";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { extractDomain } from "@/lib/brand/resolver";
import { ImportContaDialog } from "@/components/ImportContaDialog";
import { Copy, Upload } from "lucide-react";
import {
  addContaAPagar,
  contaPertenceAoMesRef,
  deleteContaAPagar,
  deleteContaRecorrencia,
  desmarcarContaComoPago,
  getCategoriaById,
  getCategorias,
  getContasAPagar,
  marcarContaComoPago,
  statusContaEfetivo,
  updateContaAPagar,
  updateContaRecorrencia,
  useBootstrap,
  useStore,
} from "@/lib/store";
import type { ContaAPagar, StatusConta, FrequenciaRecorrencia } from "@/lib/types";
import { FORMAS_PAGAMENTO, FREQUENCIAS_RECORRENCIA, type FormaPagamento } from "@/lib/types";
import { formatBRL, formatDateBR, formatMonthYear, parseBRLInput, todayISO } from "@/lib/format";
import { useFornecedores } from "@/lib/fornecedores";
import { mesReferenciaOpcoes, ymFromDate } from "@/lib/mes-referencia";
import { useMesReferenciaRef } from "@/lib/use-mes-referencia";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contas-a-pagar/")({
  head: () => ({ meta: [{ title: "Contas a pagar — Gasto Inteligente" }] }),
  component: ContasAPagarPage,
});

type FilterId = "todas" | "pendentes" | "proximas" | "atrasadas" | "pagas" | "recorrentes";

const FILTRO_IDS: FilterId[] = ["todas", "pendentes", "proximas", "atrasadas", "pagas", "recorrentes"];

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function ContasAPagarPage() {
  const { t } = useTranslation("contas-a-pagar");
  const ready = useBootstrap();
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const today = new Date();
  const [ym, setYm] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];
  const [editing, setEditing] = useState<ContaAPagar | null>(null);
  const [creating, setCreating] = useState(false);

  const openCreate = () => {
    if (isMobile) {
      void navigate({ to: "/contas-a-pagar/nova" });
    } else {
      setCreating(true);
    }
  };
  const openEdit = (conta: ContaAPagar) => {
    if (isMobile) {
      void navigate({ to: "/contas-a-pagar/$id/editar", params: { id: conta.id } });
    } else {
      setEditing(conta);
    }
  };
  const [confirmDelete, setConfirmDelete] = useState<ContaAPagar | null>(null);
  const [confirmDesmarcar, setConfirmDesmarcar] = useState<ContaAPagar | null>(null);
  const [pagar, setPagar] = useState<ContaAPagar | null>(null);
  const [importing, setImporting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { can } = usePlan();
  const tryImportConta = () => {
    if (can("importar_conta")) setImporting(true);
    else setUpgradeOpen(true);
  };
  const [filtro, setFiltro] = useState<FilterId>("todas");
  const [busca, setBusca] = useState("");
  const [confirmDeleteRec, setConfirmDeleteRec] = useState<ContaAPagar | null>(null);

  const contas = useStore(() => getContasAPagar());
  const categorias = useStore(() => getCategorias());

  const hojeISO = todayISO();

  function diasAteVenc(c: ContaAPagar): number {
    const v = new Date(c.dataVencimento + "T00:00:00").getTime();
    const h = new Date(hojeISO + "T00:00:00").getTime();
    return Math.round((v - h) / (1000 * 60 * 60 * 24));
  }

  const doMes = useMemo(() => {
    const lista = contas.filter((c) => contaPertenceAoMesRef(c, ym.mes, ym.ano));
    function prioridade(c: ContaAPagar) {
      const s = statusContaEfetivo(c, hojeISO);
      if (s === "pago") return 4;
      if (s === "atrasado") return 0;
      const dias = diasAteVenc(c);
      if (dias === 0) return 1;
      if (dias > 0 && dias <= 3) return 2;
      return 3;
    }
    return lista.sort((a, b) => {
      const pa = prioridade(a);
      const pb = prioridade(b);
      if (pa !== pb) return pa - pb;
      return a.dataVencimento.localeCompare(b.dataVencimento);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contas, ym, hojeISO]);

  const totais = useMemo(() => {
    let pendente = 0;
    let pago = 0;
    let atrasado = 0;
    let proximos7 = 0;
    let qtdAtrasado = 0;
    let qtdPendente = 0;
    let qtdPago = 0;
    let qtdProximos7 = 0;
    for (const c of doMes) {
      const s = statusContaEfetivo(c, hojeISO);
      if (s === "pago") {
        pago += c.valor;
        qtdPago++;
      } else if (s === "atrasado") {
        atrasado += c.valor;
        qtdAtrasado++;
      } else {
        pendente += c.valor;
        qtdPendente++;
        const d = diasAteVenc(c);
        if (d >= 0 && d <= 7) {
          proximos7 += c.valor;
          qtdProximos7++;
        }
      }
    }
    return {
      pendente,
      pago,
      atrasado,
      proximos7,
      qtdPendente,
      qtdPago,
      qtdAtrasado,
      qtdProximos7,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doMes, hojeISO]);

  const proximaConta = useMemo(() => {
    return doMes
      .filter((c) => statusContaEfetivo(c, hojeISO) !== "pago")
      .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))[0];
  }, [doMes, hojeISO]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    return doMes.filter((c) => {
      const s = statusContaEfetivo(c, hojeISO);
      let okFiltro = true;
      switch (filtro) {
        case "todas":
          okFiltro = true;
          break;
        case "pendentes":
          okFiltro = s === "pendente" || s === "atrasado";
          break;
        case "proximas": {
          if (s === "pago" || s === "atrasado") {
            okFiltro = false;
          } else {
            const d = diasAteVenc(c);
            okFiltro = d >= 0 && d <= 7;
          }
          break;
        }
        case "atrasadas":
          okFiltro = s === "atrasado";
          break;
        case "pagas":
          okFiltro = s === "pago";
          break;
        case "recorrentes":
          okFiltro = !!c.recorrente;
          break;
        default:
          okFiltro = true;
      }
      if (!okFiltro) return false;
      if (!q) return true;
      const cat = c.categoriaId ? getCategoriaById(c.categoriaId) : undefined;
      const haystack = [
        c.nome,
        c.beneficiario ?? "",
        cat?.nome ?? "",
        formatBRL(c.valor),
        String(c.valor).replace(".", ","),
        formatDateBR(c.dataVencimento),
        c.dataVencimento,
      ]
        .map(normalizar)
        .join(" ");
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doMes, hojeISO, filtro, busca]);

  function changeMonth(delta: number) {
    const d = new Date(ym.ano, ym.mes - 1 + delta, 1);
    setYm({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  if (!ready) {
    return <PageSkeleton />;
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("header.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {vocab.contasAPagarTitle}
          </p>
          <h1 className="truncate text-xl font-bold tracking-tight capitalize">
            {formatMonthYear(ym.ano, ym.mes)}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            onClick={() => changeMonth(-1)}
            className="grid h-10 w-10 sm:h-8 sm:w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("header.prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => changeMonth(1)}
            className="grid h-10 w-10 sm:h-8 sm:w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("header.nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>

        </div>
      </header>

      {/* Resumo */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated animate-rise">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("summary.pendingMonth")}
        </p>
        <Money
          value={totais.pendente + totais.atrasado}
          className="num mt-1 block text-[30px] font-extrabold leading-none tracking-tight"
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatusPill
            label={t("pills.pending")}
            count={totais.qtdPendente}
            tone="warning"
            icon={<Clock className="h-3 w-3" />}
          />
          <StatusPill
            label={t("pills.overdue")}
            count={totais.qtdAtrasado}
            tone="destructive"
            icon={<AlertTriangle className="h-3 w-3" />}
          />
          <StatusPill
            label={t("pills.paid")}
            count={totais.qtdPago}
            tone="success"
            icon={<CheckCircle2 className="h-3 w-3" />}
          />
        </div>

        {(totais.pago > 0 || totais.qtdPago > 0) && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">{t("summary.paidMonth")}</span>
            <span className="num text-sm font-semibold text-success">
              {formatBRL(totais.pago)}
            </span>
          </div>
        )}

        {proximaConta && (
          <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("summary.nextDue")}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold">{proximaConta.nome}</p>
              <p className="num shrink-0 text-sm font-semibold">
                {formatBRL(proximaConta.valor)}
              </p>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("summary.dueOn", { date: formatDateBR(proximaConta.dataVencimento) })}
            </p>
          </div>
        )}
      </section>

      {/* Cards de resumo (mês) */}
      <section className="mt-3 grid grid-cols-2 gap-2.5 stagger lg:grid-cols-4">
        <ResumoCard
          label={t("stats.pending")}
          valorNum={totais.pendente}
          tone="warning"
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <ResumoCard
          label={t("stats.overdue")}
          valorNum={totais.atrasado}
          tone="destructive"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <ResumoCard
          label={t("stats.next7")}
          valorNum={totais.proximos7}
          tone="warning"
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          hint={t("stats.billCount", { count: totais.qtdProximos7 })}
        />
        <ResumoCard
          label={t("stats.paid")}
          valorNum={totais.pago}
          tone="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
      </section>

      {/* Mensagem amigável */}
      <p
        className={cn(
          "mt-3 px-1 text-xs leading-relaxed",
          totais.qtdAtrasado > 0
            ? "text-destructive"
            : totais.qtdProximos7 > 0
              ? "text-warning"
              : "text-muted-foreground",
        )}
      >
        {mensagemAmigavel(totais, t)}
      </p>

      {/* CTAs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="card-press h-14 rounded-2xl bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
          onClick={openCreate}
        >
          <Plus className="mr-1 h-5 w-5" />
          {t("cta.new")}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="card-press h-14 rounded-2xl text-sm font-semibold"
          onClick={tryImportConta}
        >
          <Upload className="mr-1 h-5 w-5" />
          {t("cta.import")}
          {!can("importar_conta") && <LockChip />}
        </Button>
      </div>

      {/* Filtros */}
      <div
        className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={t("filters.label")}
      >
        {FILTRO_IDS.map((id) => {
          const active = filtro === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setFiltro(id)}
              className={cn(
                "card-press shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-brand/40",
              )}
            >
              {t(`filters.${id}`)}
            </button>
          );
        })}
      </div>

      {/* Busca */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("search.placeholder")}
          className="h-10 rounded-full pl-9 pr-9"
          aria-label={t("search.label")}
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca("")}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("search.clear")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>


      {/* Lista */}
      <section className="mt-3 space-y-2.5">
        {doMes.length === 0 ? (
          <EmptyState onAdd={openCreate} />
        ) : filtradas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground animate-fade-in space-y-3">
            <p>
              {busca
                ? t("search.noResults", { query: busca })
                : t("search.emptyFilter")}
            </p>
            {(busca || filtro !== "todas") && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 rounded-full"
                onClick={() => {
                  setBusca("");
                  setFiltro("todas");
                }}
              >
                {t("search.clearFilters")}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 stagger">
            {filtradas.map((conta) => (
              <ContaCard
                key={conta.id}
                conta={conta}
                hojeISO={hojeISO}
                onEdit={() => openEdit(conta)}
                onDelete={() => {
                  if (conta.recorrente && conta.recorrenciaId) {
                    setConfirmDeleteRec(conta);
                  } else {
                    setConfirmDelete(conta);
                  }
                }}
                onPagar={() => setPagar(conta)}
                onDesmarcar={() => setConfirmDesmarcar(conta)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Dialogs */}
      {creating && (
        <ContaFormDialog
          open
          onOpenChange={(o) => !o && setCreating(false)}
          onSaved={() => setCreating(false)}
          defaultDate={`${ym.ano}-${String(ym.mes).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`}
        />
      )}

      {editing && (
        <ContaFormDialog
          open
          conta={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? confirmDelete.gastoId
                  ? t("delete.descPaid", { name: confirmDelete.nome })
                  : t("delete.desc", { name: confirmDelete.nome })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
            {confirmDelete?.gastoId && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirmDelete) {
                    deleteContaAPagar(confirmDelete.id, { excluirGastoVinculado: false });
                    toast.success(t("delete.toastKept"));
                  }
                  setConfirmDelete(null);
                }}
              >
                {t("delete.onlyBill")}
              </Button>
            )}
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) {
                  deleteContaAPagar(confirmDelete.id, {
                    excluirGastoVinculado: !!confirmDelete.gastoId,
                  });
                  toast.success(
                    confirmDelete.gastoId ? t("delete.toastBoth") : t("delete.toastOnly"),
                  );
                }
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDelete?.gastoId ? t("delete.billAndExpense") : t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmDesmarcar}
        onOpenChange={(o) => !o && setConfirmDesmarcar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("undo.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDesmarcar?.gastoId
                ? t("undo.descPaid", { name: confirmDesmarcar.nome })
                : t("undo.desc", { name: confirmDesmarcar?.nome ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("undo.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDesmarcar) {
                  try {
                    await desmarcarContaComoPago(confirmDesmarcar.id, {
                      removerGastoVinculado: true,
                    });
                    toast.success(t("undo.toastSuccess"));
                  } catch {
                    toast.error(t("undo.toastError"));
                  }
                }
                setConfirmDesmarcar(null);
              }}
            >
              {t("undo.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir conta recorrente — escopo */}
      <AlertDialog
        open={!!confirmDeleteRec}
        onOpenChange={(o) => !o && setConfirmDeleteRec(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteRec.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteRec ? t("deleteRec.desc", { name: confirmDeleteRec.nome }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                if (confirmDeleteRec) {
                  deleteContaAPagar(confirmDeleteRec.id, {
                    excluirGastoVinculado: !!confirmDeleteRec.gastoId,
                  });
                  toast.success(t("deleteRec.toastSingle"));
                }
                setConfirmDeleteRec(null);
              }}
            >
              {t("deleteRec.single")}
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                if (confirmDeleteRec?.recorrenciaId) {
                  deleteContaRecorrencia(
                    confirmDeleteRec.recorrenciaId,
                    confirmDeleteRec.mes,
                    confirmDeleteRec.ano,
                  );
                  toast.success(t("deleteRec.toastFuture"));
                }
                setConfirmDeleteRec(null);
              }}
            >
              {t("deleteRec.future")}
            </Button>
            <Button
              variant="destructive"
              className="justify-start"
              onClick={() => {
                if (confirmDeleteRec?.recorrenciaId) {
                  deleteContaRecorrencia(confirmDeleteRec.recorrenciaId);
                  toast.success(t("deleteRec.toastAll"));
                }
                setConfirmDeleteRec(null);
              }}
            >
              {t("deleteRec.all")}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteRec.cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pagar && (
        <PagarDialog
          conta={pagar}
          onClose={() => setPagar(null)}
          categoriasCount={categorias.length}
        />
      )}

      <ImportContaDialog open={importing} onOpenChange={setImporting} />
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        feature="importar_conta"
        featureLabel={t("upgrade.featureLabel")}
        benefit={t("upgrade.benefit")}
      />
    </MobileShell>
  );
}

// ---------- Subcomponents ----------

function ResumoCard({
  label,
  valorNum,
  tone,
  icon,
  hint,
}: {
  label: string;
  valorNum: number;
  tone: "warning" | "destructive" | "success" | "muted";
  icon: React.ReactNode;
  hint?: string;
}) {
  const metricTone =
    tone === "warning"
      ? "warning"
      : tone === "destructive"
        ? "negative"
        : tone === "success"
          ? "positive"
          : "default";
  return (
    <MetricCard
      label={label}
      icon={icon}
      tone={metricTone}
      value={<Money value={valorNum} className="num" />}
      hint={hint}
    />
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function mensagemAmigavel(
  totals: {
    qtdAtrasado: number;
    qtdProximos7: number;
    qtdPendente: number;
    qtdPago: number;
  },
  t: TFn,
): string {
  if (totals.qtdAtrasado > 0) {
    return t("friendly.overdue", { count: totals.qtdAtrasado });
  }
  if (totals.qtdProximos7 > 0) {
    return t("friendly.soon", { count: totals.qtdProximos7 });
  }
  if (totals.qtdPendente === 0 && totals.qtdPago === 0) {
    return t("friendly.noneEver");
  }
  if (totals.qtdPendente === 0) {
    return t("friendly.allPaid");
  }
  return t("friendly.next7Clear");
}

function StatusPill({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "warning" | "destructive" | "success";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning/15 text-warning"
      : tone === "destructive"
        ? "bg-destructive/15 text-destructive"
        : "bg-success/15 text-success";
  return (
    <div className="rounded-xl border border-border bg-background/40 p-2.5 text-center">
      <span
        className={cn(
          "mx-auto mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full",
          toneClass,
        )}
      >
        {icon}
      </span>
      <p className="num text-base font-bold leading-none">{count}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation("contas-a-pagar");
  return (
    <PremiumEmptyState
      variant="premium"
      icon={<Receipt className="h-6 w-6" />}
      title={t("empty.title")}
      description={t("empty.subtitle")}
      cta={
        <div className="flex flex-col items-center gap-2">
          <Button className="card-press min-h-11 rounded-full font-semibold" onClick={onAdd}>
            <Plus className="mr-1 h-4 w-4" />
            {t("empty.addFirst")}
          </Button>
          <p className="max-w-xs text-center text-[11px] text-muted-foreground">
            {t("empty.helper")}
          </p>
        </div>
      }
    />
  );
}


function nomeExibicaoFornecedor(f: { apelido?: string | null; nome_fantasia?: string | null; razao_social?: string | null; nome?: string | null } | undefined): string | null {
  if (!f) return null;
  return (
    f.apelido?.trim() ||
    f.nome_fantasia?.trim() ||
    f.razao_social?.trim() ||
    f.nome?.trim() ||
    null
  );
}

function ContaCard({
  conta,
  hojeISO,
  onEdit,
  onDelete,
  onPagar,
  onDesmarcar,
}: {
  conta: ContaAPagar;
  hojeISO: string;
  onEdit: () => void;
  onDelete: () => void;
  onPagar: () => void;
  onDesmarcar: () => void;
}) {
  const { t } = useTranslation("contas-a-pagar");
  const status = statusContaEfetivo(conta, hojeISO);
  const cat = conta.categoriaId ? getCategoriaById(conta.categoriaId) : undefined;
  const { porId: fornecedoresPorId } = useFornecedores();
  const fornecedorNome = conta.fornecedorId
    ? nomeExibicaoFornecedor(fornecedoresPorId[conta.fornecedorId])
    : null;

  const diasParaVencer = useMemo(() => {
    const v = new Date(conta.dataVencimento + "T00:00:00").getTime();
    const h = new Date(hojeISO + "T00:00:00").getTime();
    return Math.round((v - h) / (1000 * 60 * 60 * 24));
  }, [conta.dataVencimento, hojeISO]);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 transition-colors",
        status === "atrasado"
          ? "border-destructive/40"
          : status === "pago"
            ? "border-success/30 opacity-80"
            : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        {(fornecedorNome || conta.beneficiario || conta.nome) ? (
          <BrandLogo
            name={fornecedorNome || conta.beneficiario || conta.nome}
            domain={extractDomain(conta.bancoEmissor ?? null)}
            size="sm"
            fallbackIcon={cat ? undefined : <Receipt className="h-4 w-4" />}
          />
        ) : cat ? (
          <CategoryIcon categoria={cat} size="sm" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card-elevated text-muted-foreground">
            <Receipt className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{conta.nome}</p>
            <p
              className={cn(
                "num shrink-0 text-sm font-bold",
                status === "atrasado" && "text-destructive",
                status === "pago" && "text-success",
              )}
            >
              {formatBRL(conta.valor)}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="num">{t("card.dueShort", { date: formatDateBR(conta.dataVencimento) })}</span>
            {conta.recorrente && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3 w-3" />
                {conta.frequenciaRecorrencia
                  ? t(`frequency.${conta.frequenciaRecorrencia}`, { defaultValue: t("card.recurringFallback") })
                  : t("card.recurringFallback")}
              </span>
            )}
            <StatusBadge status={status} dias={diasParaVencer} />
          </div>
          {conta.fornecedorId && fornecedorNome && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {t("card.supplier")} <span className="text-foreground/80">{fornecedorNome}</span>
            </p>
          )}
        </div>
      </div>

      {(conta.codigoBoleto || conta.codigoPix || conta.chavePix) && (
        <div className="mt-3 space-y-1.5">
          {conta.codigoBoleto && (
            <CodigoCopiavel label={t("copy.boletoLabel")} valor={conta.codigoBoleto} />
          )}
          {conta.codigoPix && (
            <CodigoCopiavel label={t("copy.pixCopyLabel")} valor={conta.codigoPix} />
          )}
          {conta.chavePix && (
            <CodigoCopiavel label={t("copy.pixKeyLabel")} valor={conta.chavePix} />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {status === "pago" ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onDesmarcar}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {t("card.undoPaid")}
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={onPagar}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {t("card.markPaid")}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={onEdit}
          aria-label={t("card.edit")}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label={t("card.delete")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}

function CodigoCopiavel({ label, valor }: { label: string; valor: string }) {
  const { t } = useTranslation("contas-a-pagar");
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(t("copy.copied", { label }));
    } catch {
      toast.error(t("copy.copyError"));
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card-elevated/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-[11px] font-mono">{valor}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={copiar}
        aria-label={t("copy.copyButton", { label })}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function StatusBadge({ status, dias }: { status: StatusConta; dias: number }) {
  const { t } = useTranslation("contas-a-pagar");
  if (status === "pago") {
    return (
      <PremiumStatusBadge tone="success" dot>
        <CheckCircle2 className="h-2.5 w-2.5" />
        {t("status.paid")}
      </PremiumStatusBadge>
    );
  }
  if (status === "atrasado") {
    return (
      <PremiumStatusBadge tone="destructive" dot className="animate-pulse-soft">
        <AlertTriangle className="h-2.5 w-2.5" />
        {t("status.overdueDays", { days: Math.abs(dias) })}
      </PremiumStatusBadge>
    );
  }
  if (dias === 0) {
    return (
      <PremiumStatusBadge tone="warning" dot className="animate-pulse-soft">
        <Clock className="h-2.5 w-2.5" />
        {t("status.dueToday")}
      </PremiumStatusBadge>
    );
  }
  if (dias === 1) {
    return (
      <PremiumStatusBadge tone="warning" dot className="animate-pulse-soft">
        <Clock className="h-2.5 w-2.5" />
        {t("status.dueTomorrow")}
      </PremiumStatusBadge>
    );
  }
  if (dias <= 3) {
    return (
      <PremiumStatusBadge tone="warning" dot>
        <Clock className="h-2.5 w-2.5" />
        {t("status.dueInDays", { days: dias })}
      </PremiumStatusBadge>
    );
  }
  return (
    <PremiumStatusBadge tone="muted">
      {t("status.pendingDays", { days: dias })}
    </PremiumStatusBadge>
  );
}

// ---------- Form dialog (desktop wrapper around ContaPagarForm) ----------

function ContaFormDialog({
  open,
  onOpenChange,
  conta,
  onSaved,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conta?: ContaAPagar;
  onSaved: () => void;
  defaultDate?: string;
}) {
  const { t } = useTranslation("contas-a-pagar");
  const isEdit = !!conta;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
          <DialogDescription>
            {isEdit ? t("form.editDesc") : t("form.newDesc")}
          </DialogDescription>
        </DialogHeader>
        <ContaPagarForm
          conta={conta}
          defaultDate={defaultDate}
          onSaved={onSaved}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}


// ---------- Pagar dialog ----------

function PagarDialog({
  conta,
  onClose,
  categoriasCount,
}: {
  conta: ContaAPagar;
  onClose: () => void;
  categoriasCount: number;
}) {
  const { t } = useTranslation("contas-a-pagar");
  const categorias = getCategorias();
  const [nome, setNome] = useState(conta.nome);
  const [valorStr, setValorStr] = useState(
    conta.valor.toFixed(2).replace(".", ","),
  );
  const [categoriaId, setCategoriaId] = useState<string>(conta.categoriaId ?? "");
  const [criarGasto, setCriarGasto] = useState(true);
  const [forma, setForma] = useState<FormaPagamento>(conta.formaPagamento ?? "pix");
  const [dataPag, setDataPag] = useState(todayISO());
  const [obs, setObs] = useState(conta.observacao ?? "");

  async function handlePagar() {
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      toast.error(t("pay.errName"));
      return;
    }
    const valorNum = parseBRLInput(valorStr);
    if (!valorNum || valorNum <= 0) {
      toast.error(t("pay.errValue"));
      return;
    }
    try {
      await marcarContaComoPago(conta.id, {
        criarGasto,
        formaPagamento: forma,
        dataPagamento: dataPag,
        observacao: obs.trim() || undefined,
        nome: nomeTrim,
        valor: valorNum,
        categoriaId: categoriaId || undefined,
      });
      toast.success(
        criarGasto
          ? t("pay.toastWithExpense")
          : t("pay.toastOnly"),
      );
      onClose();
    } catch (e) {
      toastFromError(e, t("pay.toastError"));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("pay.title")}</DialogTitle>
          <DialogDescription>
            {t("pay.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pag-nome">{t("pay.name")}</Label>
            <Input
              id="pag-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("pay.namePlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pag-valor">{t("pay.value")}</Label>
              <Input
                id="pag-valor"
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pag-data">{t("pay.date")}</Label>
              <Input
                id="pag-data"
                type="date"
                value={dataPag}
                onChange={(e) => setDataPag(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("pay.method")}</Label>
              <Select value={forma} onValueChange={(v) => setForma(v as FormaPagamento)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("pay.category")}</Label>
              <Select
                value={categoriaId || "__none__"}
                onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("pay.noCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("pay.noCategory")}</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pag-obs">{t("pay.obs")}</Label>
            <Textarea
              id="pag-obs"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder={t("pay.obsPlaceholder")}
            />
          </div>

          <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("pay.asExpenseTitle")}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {categoriasCount === 0
                    ? t("pay.asExpenseHintNoCats")
                    : t("pay.asExpenseHint")}
                </p>
              </div>
              <Switch checked={criarGasto} onCheckedChange={setCriarGasto} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("pay.cancel")}
          </Button>
          <Button onClick={handlePagar}>
            <Check className="mr-1 h-4 w-4" />
            {t("pay.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
