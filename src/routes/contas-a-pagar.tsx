import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { useAuth } from "@/lib/auth-context";
import { getVocab, type TipoCadastro } from "@/lib/profile-utils";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal, LockChip } from "@/components/UpgradeModal";
import { PageSkeleton } from "@/components/PageSkeleton";
import { CategoryIcon } from "@/components/CategoryIcon";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contas-a-pagar")({
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
  const vocab = getVocab(profile?.tipo_cadastro as TipoCadastro);
  const today = new Date();
  const [ym, setYm] = useMesReferenciaRef() as unknown as [
    { mes: number; ano: number },
    (next: { mes: number; ano: number }) => void,
  ];
  const [editing, setEditing] = useState<ContaAPagar | null>(null);
  const [creating, setCreating] = useState(false);
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

      {/* Resumo */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated animate-rise">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Total pendente no mês
        </p>
        <Money
          value={totais.pendente + totais.atrasado}
          className="num mt-1 block text-[30px] font-extrabold leading-none tracking-tight"
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatusPill
            label="Pendentes"
            count={totais.qtdPendente}
            tone="warning"
            icon={<Clock className="h-3 w-3" />}
          />
          <StatusPill
            label="Atrasadas"
            count={totais.qtdAtrasado}
            tone="destructive"
            icon={<AlertTriangle className="h-3 w-3" />}
          />
          <StatusPill
            label="Pagas"
            count={totais.qtdPago}
            tone="success"
            icon={<CheckCircle2 className="h-3 w-3" />}
          />
        </div>

        {(totais.pago > 0 || totais.qtdPago > 0) && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">Total pago no mês</span>
            <span className="num text-sm font-semibold text-success">
              {formatBRL(totais.pago)}
            </span>
          </div>
        )}

        {proximaConta && (
          <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Próxima a vencer
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold">{proximaConta.nome}</p>
              <p className="num shrink-0 text-sm font-semibold">
                {formatBRL(proximaConta.valor)}
              </p>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Vence em {formatDateBR(proximaConta.dataVencimento)}
            </p>
          </div>
        )}
      </section>

      {/* Cards de resumo (mês) */}
      <section className="mt-3 grid grid-cols-2 gap-2.5 stagger lg:grid-cols-4">
        <ResumoCard
          label="Total pendente"
          valorNum={totais.pendente}
          tone="warning"
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <ResumoCard
          label="Total atrasado"
          valorNum={totais.atrasado}
          tone="destructive"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <ResumoCard
          label="Próximos 7 dias"
          valorNum={totais.proximos7}
          tone="warning"
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          hint={`${totais.qtdProximos7} ${totais.qtdProximos7 === 1 ? "conta" : "contas"}`}
        />
        <ResumoCard
          label="Total pago"
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
        {mensagemAmigavel(totais)}
      </p>

      {/* CTAs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="card-press h-14 rounded-2xl bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
          onClick={() => setCreating(true)}
        >
          <Plus className="mr-1 h-5 w-5" />
          Nova conta
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="card-press h-14 rounded-2xl text-sm font-semibold"
          onClick={tryImportConta}
        >
          <Upload className="mr-1 h-5 w-5" />
          Importar conta
          {!can("importar_conta") && <LockChip />}
        </Button>
      </div>

      {/* Filtros */}
      <div
        className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Filtrar contas"
      >
        {FILTROS.map((f) => {
          const active = filtro === f.id;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={active}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "card-press shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-brand/40",
              )}
            >
              {f.label}
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
          placeholder="Buscar por nome, categoria, valor ou vencimento"
          className="h-10 rounded-full pl-9 pr-9"
          aria-label="Buscar contas"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca("")}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Lista */}
      <section className="mt-3 space-y-2.5">
        {doMes.length === 0 ? (
          <EmptyState onAdd={() => setCreating(true)} />
        ) : filtradas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground animate-fade-in">
            {busca
              ? `Nada encontrado para "${busca}".`
              : "Nada nesse filtro por aqui."}
          </div>
        ) : (
          <div className="space-y-2.5 stagger">
            {filtradas.map((conta) => (
              <ContaCard
                key={conta.id}
                conta={conta}
                hojeISO={hojeISO}
                onEdit={() => setEditing(conta)}
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
            <AlertDialogTitle>Excluir esta conta?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? confirmDelete.gastoId
                  ? `"${confirmDelete.nome}" foi paga e gerou um gasto vinculado. Como deseja excluir?`
                  : `Tem certeza que quer excluir "${confirmDelete.nome}"? Essa ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {confirmDelete?.gastoId && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirmDelete) {
                    deleteContaAPagar(confirmDelete.id, { excluirGastoVinculado: false });
                    toast.success("Conta excluída. Gasto mantido.");
                  }
                  setConfirmDelete(null);
                }}
              >
                Excluir só a conta
              </Button>
            )}
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) {
                  deleteContaAPagar(confirmDelete.id, {
                    excluirGastoVinculado: !!confirmDelete.gastoId,
                  });
                  toast.success(
                    confirmDelete.gastoId ? "Conta e gasto excluídos." : "Conta excluída.",
                  );
                }
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDelete?.gastoId ? "Excluir conta e gasto" : "Excluir"}
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
            <AlertDialogTitle>Desfazer pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDesmarcar?.gastoId
                ? `"${confirmDesmarcar.nome}" voltará para pendente. O gasto vinculado em Gastos também será removido.`
                : `"${confirmDesmarcar?.nome ?? ""}" voltará para pendente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDesmarcar) {
                  try {
                    await desmarcarContaComoPago(confirmDesmarcar.id, {
                      removerGastoVinculado: true,
                    });
                    toast.success("Conta voltou para pendente.");
                  } catch {
                    toast.error("Não foi possível desfazer o pagamento.");
                  }
                }
                setConfirmDesmarcar(null);
              }}
            >
              Desfazer pagamento
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
            <AlertDialogTitle>Excluir conta recorrente</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteRec
                ? `"${confirmDeleteRec.nome}" se repete em vários meses. O que você quer excluir?`
                : ""}
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
                  toast.success("Apenas esta ocorrência foi excluída.");
                }
                setConfirmDeleteRec(null);
              }}
            >
              Apenas esta ocorrência
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
                  toast.success("Esta e as próximas ocorrências foram excluídas.");
                }
                setConfirmDeleteRec(null);
              }}
            >
              Esta e as próximas
            </Button>
            <Button
              variant="destructive"
              className="justify-start"
              onClick={() => {
                if (confirmDeleteRec?.recorrenciaId) {
                  deleteContaRecorrencia(confirmDeleteRec.recorrenciaId);
                  toast.success("Toda a recorrência foi excluída.");
                }
                setConfirmDeleteRec(null);
              }}
            >
              Excluir toda a recorrência
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
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
        featureLabel="Importar boleto, Pix ou conta"
        benefit="Identifique automaticamente boletos, Pix e contas a pagar."
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
  const toneClass =
    tone === "warning"
      ? "bg-warning/15 text-warning"
      : tone === "destructive"
        ? "bg-destructive/15 text-destructive"
        : tone === "success"
          ? "bg-success/15 text-success"
          : "bg-card-elevated text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 hover-lift card-press animate-rise">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full",
            toneClass,
          )}
        >
          {icon}
        </span>
      </div>
      <Money value={valorNum} className="num mt-1.5 block text-base font-bold leading-tight" />
      {hint && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function mensagemAmigavel(t: {
  qtdAtrasado: number;
  qtdProximos7: number;
  qtdPendente: number;
  qtdPago: number;
}): string {
  if (t.qtdAtrasado > 0) {
    return t.qtdAtrasado === 1
      ? "1 conta atrasada precisa de atenção."
      : `${t.qtdAtrasado} contas atrasadas pedem atenção.`;
  }
  if (t.qtdProximos7 > 0) {
    return t.qtdProximos7 === 1
      ? "1 conta vence nos próximos dias."
      : `${t.qtdProximos7} contas vencem nos próximos dias.`;
  }
  if (t.qtdPendente === 0 && t.qtdPago === 0) {
    return "Sem boletos te perseguindo por enquanto.";
  }
  if (t.qtdPendente === 0) {
    return "Tudo em dia por aqui. 🎉";
  }
  return "Boa! Nada vencendo nos próximos 7 dias.";
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
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center animate-rise">
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-card text-muted-foreground animate-pop">
        <Receipt className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold">Sem boletos te perseguindo por enquanto</p>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
        Cadastre uma conta e deixe o app lembrar por você antes de vencer.
      </p>
      <Button size="sm" className="card-press rounded-full mt-4" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" />
        Adicionar primeira conta
      </Button>
    </div>
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
        {cat ? (
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
            <span className="num">Vence {formatDateBR(conta.dataVencimento)}</span>
            {conta.recorrente && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3 w-3" />
                {FREQUENCIAS_RECORRENCIA.find((f) => f.id === conta.frequenciaRecorrencia)?.label ?? "Recorrente"}
              </span>
            )}
            <StatusBadge status={status} dias={diasParaVencer} />
          </div>
          {conta.fornecedorId && fornecedorNome && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              Fornecedor: <span className="text-foreground/80">{fornecedorNome}</span>
            </p>
          )}
        </div>
      </div>

      {(conta.codigoBoleto || conta.codigoPix || conta.chavePix) && (
        <div className="mt-3 space-y-1.5">
          {conta.codigoBoleto && (
            <CodigoCopiavel label="Código de boleto" valor={conta.codigoBoleto} />
          )}
          {conta.codigoPix && (
            <CodigoCopiavel label="Pix copia e cola" valor={conta.codigoPix} />
          )}
          {conta.chavePix && (
            <CodigoCopiavel label="Chave Pix" valor={conta.chavePix} />
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
            Desmarcar
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={onPagar}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Marcar como pago
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={onEdit}
          aria-label="Editar"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}

function CodigoCopiavel({ label, valor }: { label: string; valor: string }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não consegui copiar. Copie manualmente.");
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
        aria-label={`Copiar ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function StatusBadge({ status, dias }: { status: StatusConta; dias: number }) {
  if (status === "pago") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Paga
      </span>
    );
  }
  if (status === "atrasado") {
    return (
      <span className="inline-flex animate-pulse-soft items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <AlertTriangle className="h-2.5 w-2.5" />
        Atrasada {Math.abs(dias)}d
      </span>
    );
  }
  if (dias === 0) {
    return (
      <span className="inline-flex animate-pulse-soft items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
        <Clock className="h-2.5 w-2.5" />
        Vence hoje
      </span>
    );
  }
  if (dias === 1) {
    return (
      <span className="inline-flex animate-pulse-soft items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
        <Clock className="h-2.5 w-2.5" />
        Vence amanhã
      </span>
    );
  }
  if (dias <= 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
        <Clock className="h-2.5 w-2.5" />
        Em {dias}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Pendente · {dias}d
    </span>
  );
}

// ---------- Form dialog ----------

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
  const isEdit = !!conta;
  const isPaga = conta?.status === "pago";
  const categorias = useStore(() => getCategorias());

  const [nome, setNome] = useState(conta?.nome ?? "");
  const [valorStr, setValorStr] = useState(
    conta ? String(conta.valor).replace(".", ",") : "",
  );
  const [dataVenc, setDataVenc] = useState(
    conta?.dataVencimento ?? defaultDate ?? todayISO(),
  );
  const [categoriaId, setCategoriaId] = useState<string>(conta?.categoriaId ?? "");
  const [observacao, setObservacao] = useState(conta?.observacao ?? "");
  const [mesReferencia, setMesReferencia] = useState<string>(() => {
    if (conta?.mesReferencia && /^\d{4}-\d{2}$/.test(conta.mesReferencia)) {
      return conta.mesReferencia;
    }
    const base = conta?.dataVencimento ?? defaultDate;
    if (base && /^\d{4}-\d{2}-\d{2}/.test(base)) return base.slice(0, 7);
    return ymFromDate();
  });
  const [recorrente, setRecorrente] = useState(conta?.recorrente ?? false);
  const [frequencia, setFrequencia] = useState<FrequenciaRecorrencia>(
    conta?.frequenciaRecorrencia ?? "mensal",
  );
  const [meses, setMeses] = useState("12");

  // Campos extras
  const [beneficiario, setBeneficiario] = useState(conta?.beneficiario ?? "");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | "">(
    conta?.formaPagamento ?? "",
  );
  const [bancoEmissor, setBancoEmissor] = useState(conta?.bancoEmissor ?? "");
  const [codigoBoleto, setCodigoBoleto] = useState(conta?.codigoBoleto ?? "");
  const [codigoPix, setCodigoPix] = useState(conta?.codigoPix ?? "");
  const [chavePix, setChavePix] = useState(conta?.chavePix ?? "");
  const [fornecedorId, setFornecedorId] = useState<string>(conta?.fornecedorId ?? "");
  const { ativos: fornecedoresAtivos } = useFornecedores();
  const [mostrarExtras, setMostrarExtras] = useState(
    !!(conta?.beneficiario ||
      conta?.formaPagamento ||
      conta?.bancoEmissor ||
      conta?.codigoBoleto ||
      conta?.codigoPix ||
      conta?.chavePix ||
      conta?.fornecedorId),
  );

  // Sincronizar gasto vinculado (apenas conta já paga)
  const [sincronizarGasto, setSincronizarGasto] = useState(true);

  function handleSave() {
    const valor = parseBRLInput(valorStr);
    if (!nome.trim()) {
      toast.error("Dá um nome pra essa conta.");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!dataVenc) {
      toast.error("Escolha a data de vencimento.");
      return;
    }

    if (isEdit && conta) {
      const fields = {
        nome: nome.trim(),
        valor,
        dataVencimento: dataVenc,
        categoriaId: (categoriaId || null) as string | null,
        observacao: observacao.trim() || undefined,
        mesReferencia: /^\d{4}-\d{2}$/.test(mesReferencia) ? mesReferencia : null,
        beneficiario: beneficiario.trim() || null,
        formaPagamento: (formaPagamento || null) as FormaPagamento | null,
        bancoEmissor: bancoEmissor.trim() || null,
        codigoBoleto: codigoBoleto.trim() || null,
        codigoPix: codigoPix.trim() || null,
        chavePix: chavePix.trim() || null,
        fornecedorId: fornecedorId || null,
        atualizarGastoVinculado: isPaga ? sincronizarGasto : false,
      };
      // Se conta recorrente, sempre pergunta escopo da edição
      if (conta.recorrente && conta.recorrenciaId) {
        setEditScopeFields(fields);
        return;
      }
      updateContaAPagar(conta.id, fields);
      toast.success(
        isPaga && sincronizarGasto
          ? "Conta e gasto atualizados. ✅"
          : "Conta atualizada. ✅",
      );
    } else {
      addContaAPagar({
        nome: nome.trim(),
        valor,
        dataVencimento: dataVenc,
        categoriaId: categoriaId || undefined,
        observacao: observacao.trim() || undefined,
        mesReferencia: /^\d{4}-\d{2}$/.test(mesReferencia) ? mesReferencia : undefined,
        recorrente,
        frequenciaRecorrencia: recorrente ? frequencia : undefined,
        recorrenteMeses: recorrente ? Math.max(1, parseInt(meses) || 12) : undefined,
        beneficiario: beneficiario.trim() || undefined,
        formaPagamento: (formaPagamento || undefined) as FormaPagamento | undefined,
        bancoEmissor: bancoEmissor.trim() || undefined,
        codigoBoleto: codigoBoleto.trim() || undefined,
        codigoPix: codigoPix.trim() || undefined,
        chavePix: chavePix.trim() || undefined,
        fornecedorId: fornecedorId || null,
      });
      toast.success(recorrente ? "Conta recorrente criada. 🔁" : "Conta cadastrada.");
    }
    onSaved();
  }

  // Dialog de escopo para edição de conta recorrente
  const [editScopeFields, setEditScopeFields] = useState<null | Parameters<
    typeof updateContaAPagar
  >[1]>(null);

  function applyEditScope(scope: "single" | "future" | "all") {
    if (!conta || !editScopeFields) return;
    // Atualiza a ocorrência atual (com sync de gasto vinculado se for o caso)
    updateContaAPagar(conta.id, editScopeFields);

    // Para os demais escopos, propaga sem dataVencimento e sem mexer em gastos vinculados de outras ocorrências
    if (scope !== "single" && conta.recorrenciaId) {
      const propagatedFields = { ...editScopeFields };
      delete propagatedFields.atualizarGastoVinculado;
      updateContaRecorrencia(
        conta.recorrenciaId,
        propagatedFields,
        scope,
        conta.mes,
        conta.ano,
      );
    }

    toast.success(
      scope === "all"
        ? "Toda a recorrência foi atualizada. ✅"
        : scope === "future"
        ? "Esta e as próximas foram atualizadas. ✅"
        : "Conta atualizada. ✅",
    );
    setEditScopeFields(null);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar conta" : "Nova conta a pagar"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Atualize os dados da conta."
              : "Cadastre essa conta e a gente te avisa antes do vencimento."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conta-nome">Nome da conta</Label>
            <Input
              id="conta-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Aluguel, Internet, Luz…"
              autoFocus={!isEdit}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="conta-valor">Valor</Label>
              <Input
                id="conta-valor"
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conta-data">Vencimento</Label>
              <Input
                id="conta-data"
                type="date"
                value={dataVenc}
                onChange={(e) => setDataVenc(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={categoriaId || "_none"} onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sem categoria</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conta-mes-ref">Mês de referência</Label>
            <Select value={mesReferencia} onValueChange={setMesReferencia}>
              <SelectTrigger id="conta-mes-ref">
                <SelectValue placeholder="Mês de competência" />
              </SelectTrigger>
              <SelectContent>
                {mesReferenciaOpcoes(undefined, 12, 6).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Mês ao qual esta conta pertence (ex.: fatura de Maio paga em Junho → Maio).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conta-obs">Observação (opcional)</Label>
            <Textarea
              id="conta-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="Detalhes adicionais"
            />
          </div>

          {/* Campos extras (boleto/Pix/beneficiário) */}
          <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
            <button
              type="button"
              onClick={() => setMostrarExtras((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <p className="text-sm font-medium">Mais detalhes (opcional)</p>
                <p className="text-[11px] text-muted-foreground">
                  Beneficiário, forma de pagamento, código de boleto/Pix
                </p>
              </div>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  mostrarExtras && "rotate-90",
                )}
              />
            </button>

            {mostrarExtras && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="conta-benef">Beneficiário</Label>
                  <Input
                    id="conta-benef"
                    value={beneficiario}
                    onChange={(e) => setBeneficiario(e.target.value)}
                    placeholder="Quem recebe o pagamento"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Fornecedor (opcional)</Label>
                  {fornecedoresAtivos.length > 0 ? (
                    <Select
                      value={fornecedorId || "_none"}
                      onValueChange={(v) => setFornecedorId(v === "_none" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sem fornecedor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Sem fornecedor</SelectItem>
                        {fornecedoresAtivos.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.apelido || f.nome_fantasia || f.razao_social || f.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Você ainda não tem fornecedores cadastrados.{" "}
                      <Link
                        to="/fornecedores"
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Cadastrar fornecedor
                      </Link>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Forma de pagamento</Label>
                    <Select
                      value={formaPagamento || "_none"}
                      onValueChange={(v) =>
                        setFormaPagamento(v === "_none" ? "" : (v as FormaPagamento))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">—</SelectItem>
                        {FORMAS_PAGAMENTO.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="conta-banco">Banco emissor</Label>
                    <Input
                      id="conta-banco"
                      value={bancoEmissor}
                      onChange={(e) => setBancoEmissor(e.target.value)}
                      placeholder="Ex.: Itaú, Nubank…"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="conta-boleto">Código de boleto</Label>
                  <Textarea
                    id="conta-boleto"
                    value={codigoBoleto}
                    onChange={(e) => setCodigoBoleto(e.target.value)}
                    rows={2}
                    placeholder="Linha digitável do boleto"
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="conta-pix-cc">Pix copia e cola</Label>
                  <Textarea
                    id="conta-pix-cc"
                    value={codigoPix}
                    onChange={(e) => setCodigoPix(e.target.value)}
                    rows={2}
                    placeholder="Código BR Code do Pix"
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="conta-chave">Chave Pix</Label>
                  <Input
                    id="conta-chave"
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    placeholder="CPF, e-mail, telefone ou aleatória"
                  />
                </div>
              </div>
            )}
          </div>

          {!isEdit && (
            <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Conta recorrente</p>
                  <p className="text-[11px] text-muted-foreground">
                    Gera as próximas ocorrências automaticamente
                  </p>
                </div>
              <Switch checked={recorrente} onCheckedChange={setRecorrente} />
            </div>
            {recorrente && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="conta-freq">Frequência</Label>
                  <Select
                    value={frequencia}
                    onValueChange={(v) => setFrequencia(v as FrequenciaRecorrencia)}
                  >
                    <SelectTrigger id="conta-freq">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIAS_RECORRENCIA.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conta-meses">
                    {frequencia === "anual"
                      ? "Quantos anos?"
                      : frequencia === "semanal"
                      ? "Quantas semanas?"
                      : frequencia === "quinzenal"
                      ? "Quantas quinzenas?"
                      : "Quantos meses?"}
                  </Label>
                  <Input
                    id="conta-meses"
                    type="number"
                    min={1}
                    max={120}
                    value={meses}
                    onChange={(e) => setMeses(e.target.value)}
                  />
                </div>
              </div>
            )}
            </div>
          )}

          {isEdit && isPaga && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Atualizar gasto vinculado</p>
                  <p className="text-[11px] text-muted-foreground">
                    Esta conta já foi paga. Quer aplicar as mudanças no gasto criado em "Gastos"?
                  </p>
                </div>
                <Switch
                  checked={sincronizarGasto}
                  onCheckedChange={setSincronizarGasto}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>{isEdit ? "Salvar" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>

      {/* Escopo da edição em conta recorrente */}
      <AlertDialog
        open={!!editScopeFields}
        onOpenChange={(o) => !o && setEditScopeFields(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              <Repeat className="h-3.5 w-3.5" />
              Conta recorrente
            </div>
            <AlertDialogTitle>Como deseja aplicar esta alteração?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está editando uma conta recorrente. Deseja aplicar esta alteração
              somente nesta conta ou também nas demais recorrências?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => applyEditScope("single")}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <p className="text-sm font-semibold">Somente esta conta</p>
              <p className="text-xs text-muted-foreground">
                Altera apenas a ocorrência de {formatMonthYear(conta?.ano ?? 0, conta?.mes ?? 0)}.
              </p>
            </button>
            <button
              type="button"
              onClick={() => applyEditScope("future")}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <p className="text-sm font-semibold">Esta e as próximas</p>
              <p className="text-xs text-muted-foreground">
                Altera esta ocorrência e todas as futuras (mantém o histórico passado).
              </p>
            </button>
            <button
              type="button"
              onClick={() => applyEditScope("all")}
              className="w-full rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
            >
              <p className="text-sm font-semibold">Todas as recorrências</p>
              <p className="text-xs text-muted-foreground">
                Altera toda a série, incluindo passadas (ocorrências já pagas são preservadas).
              </p>
            </button>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      toast.error("Informe a descrição da conta.");
      return;
    }
    const valorNum = parseBRLInput(valorStr);
    if (!valorNum || valorNum <= 0) {
      toast.error("Informe um valor válido.");
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
          ? "Conta paga e gasto registrado."
          : "Conta marcada como paga.",
      );
      onClose();
    } catch {
      toast.error("Não foi possível salvar o pagamento. Tente novamente.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marcar como paga</DialogTitle>
          <DialogDescription>
            Revise os dados antes de confirmar o pagamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pag-nome">Descrição</Label>
            <Input
              id="pag-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Internet"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pag-valor">Valor pago</Label>
              <Input
                id="pag-valor"
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pag-data">Data do pagamento</Label>
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
              <Label>Forma de pagamento</Label>
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
              <Label>Categoria</Label>
              <Select
                value={categoriaId || "__none__"}
                onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem categoria</SelectItem>
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
            <Label htmlFor="pag-obs">Observação (opcional)</Label>
            <Textarea
              id="pag-obs"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder="Conta usada, comprovante, etc."
            />
          </div>

          <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Registrar como gasto</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {categoriasCount === 0
                    ? "Sem categorias cadastradas — vai para “Outros” em Gastos."
                    : "Cria um lançamento em Gastos com a categoria selecionada."}
                </p>
              </div>
              <Switch checked={criarGasto} onCheckedChange={setCriarGasto} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handlePagar}>
            <Check className="mr-1 h-4 w-4" />
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
