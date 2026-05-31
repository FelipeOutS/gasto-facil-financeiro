import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState as PremiumEmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBadge as PremiumStatusBadge } from "@/components/ui/status-badge";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HandCoins,
  X,
  Search,
  Ban,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Money } from "@/components/Money";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { formatBRL, formatDateBR, parseBRLInput, todayISO } from "@/lib/format";
import {
  type ContaReceber,
  type NovaContaReceberInput,
  type StatusContaReceber,
  TIPOS_RECEBIMENTO,
  FORMAS_RECEBIMENTO,
  listarContasReceber,
  criarContaReceber,
  atualizarContaReceber,
  excluirContaReceber,
  
  desmarcarRecebida,
  cancelarContaReceber,
  calcularResumo,
  statusEfetivo,
} from "@/lib/contas-receber";
import { useClientes } from "@/lib/clientes";
import { ClienteSelect, nomeExibicaoCliente } from "@/components/ClienteSelect";
import { ReceberContaForm } from "@/components/contas/ReceberContaForm";

export const Route = createFileRoute("/contas-a-receber/")({
  component: ContasAReceberPage,
});

type FilterStatus = "todas" | "pendente" | "atrasado" | "parcial" | "recebido" | "cancelado";

function ContasAReceberPage() {
  const { t } = useTranslation("contas-a-receber");
  const { user } = useAuth();
  const userId = user?.id;
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [lista, setLista] = useState<ContaReceber[]>([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<ContaReceber | null>(null);
  const [openReceber, setOpenReceber] = useState<ContaReceber | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContaReceber | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ContaReceber | null>(null);
  const [filtro, setFiltro] = useState<FilterStatus>("todas");
  const [busca, setBusca] = useState("");
  const { porId: clientesPorId } = useClientes();

  const openCreate = () => {
    if (isMobile) {
      void navigate({ to: "/contas-a-receber/nova" });
      return;
    }
    setEditing(null);
    setOpenForm(true);
  };

  const openEdit = (c: ContaReceber) => {
    if (isMobile) {
      void navigate({ to: "/contas-a-receber/$id/editar", params: { id: c.id } });
      return;
    }
    setEditing(c);
    setOpenForm(true);
  };

  const openReceive = (c: ContaReceber) => {
    if (isMobile) {
      void navigate({ to: "/contas-a-receber/$id/receber", params: { id: c.id } });
      return;
    }
    setOpenReceber(c);
  };

  async function recarregar() {
    if (!userId) return;
    try {
      const data = await listarContasReceber(userId);
      setLista(data);
    } catch (err) {
      console.error(err);
      toast.error(t("errors.loadFailed"));
    }
  }

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    listarContasReceber(userId)
      .then(setLista)
      .catch((e) => {
        console.error(e);
        toast.error(t("errors.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [userId, t]);

  const resumo = useMemo(() => calcularResumo(lista), [lista]);

  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((c) => {
      const eff = statusEfetivo(c);
      if (filtro !== "todas" && eff !== filtro) return false;
      if (q) {
        const hay = `${c.titulo} ${c.pagador_nome ?? ""} ${c.categoria ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lista, filtro, busca]);

  if (loading) return <PageSkeleton />;

  return (
    <MobileShell wide>
      <header className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            aria-label={t("header.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("header.eyebrow")}
            </p>
            <h1 className="text-lg font-bold tracking-tight">{t("header.title")}</h1>
          </div>
        </div>
        <Button size="sm" className="rounded-xl" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t("header.new")}
        </Button>
      </header>

      {/* Resumo */}
      <section className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <ResumoCard
          label={t("summary.toReceive")}
          valor={resumo.totalPendente + resumo.totalAtrasado}
          tone="brand"
          subtitle={t("summary.toReceiveSub", { count: resumo.countPendentes + resumo.countAtrasadas })}
        />
        <ResumoCard
          label={t("summary.overdue")}
          valor={resumo.totalAtrasado}
          tone="destructive"
          subtitle={t("summary.overdueSub", { count: resumo.countAtrasadas })}
        />
        <ResumoCard
          label={t("summary.received")}
          valor={resumo.totalRecebido}
          tone="success"
          subtitle={t("summary.receivedSub", { count: resumo.countRecebidas })}
        />
        <ResumoCard
          label={t("summary.expected")}
          valor={resumo.totalPrevisto}
          tone="muted"
          subtitle={t("summary.expectedSub", { count: resumo.total })}
        />
      </section>

      {/* Filtros */}
      <section className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as FilterStatus)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">{t("filters.todas")}</SelectItem>
            <SelectItem value="pendente">{t("filters.pendente")}</SelectItem>
            <SelectItem value="atrasado">{t("filters.atrasado")}</SelectItem>
            <SelectItem value="parcial">{t("filters.parcial")}</SelectItem>
            <SelectItem value="recebido">{t("filters.recebido")}</SelectItem>
            <SelectItem value="cancelado">{t("filters.cancelado")}</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* Lista */}
      <section className="mt-4 space-y-2.5">
        {listaFiltrada.length === 0 ? (
          <PremiumEmptyState
            variant={lista.length === 0 ? "premium" : "default"}
            icon={<HandCoins className="h-6 w-6" />}
            title={lista.length === 0 ? t("empty.none") : t("empty.noResults")}
            description={lista.length === 0 ? t("empty.noneDesc") : undefined}
            cta={
              lista.length === 0 ? (
                <div className="flex flex-col items-center gap-2">
                  <Button
                    className="min-h-11 rounded-full font-semibold"
                    onClick={openCreate}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    {t("empty.addFirst")}
                  </Button>
                  <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                    {t("empty.helper")}
                  </p>
                </div>
              ) : (busca || filtro !== "todas") ? (
                <Button
                  variant="outline"
                  className="min-h-11 rounded-full"
                  onClick={() => {
                    setBusca("");
                    setFiltro("todas");
                  }}
                >
                  {t("empty.clearFilters")}
                </Button>
              ) : undefined
            }
          />



        ) : (
          listaFiltrada.map((c) => (
            <ContaCard
              key={c.id}
              conta={c}
              clienteNome={c.cliente_id ? nomeExibicaoCliente(clientesPorId[c.cliente_id]) : undefined}
              onMarcar={() => openReceive(c)}
              onDesmarcar={async () => {
                try {
                  await desmarcarRecebida(c.id);
                  toast.success(t("unmark.toastSuccess"));
                  recarregar();
                } catch (e) {
                  console.error(e);
                  toast.error(t("unmark.toastError"));
                }
              }}
              onEdit={() => openEdit(c)}
              onDelete={() => setConfirmDelete(c)}
              onCancel={() => setConfirmCancel(c)}
            />
          ))
        )}
      </section>

      <ContaReceberFormDialog
        open={openForm}
        onOpenChange={setOpenForm}
        editing={editing}
        userId={userId}
        onSaved={() => {
          setOpenForm(false);
          setEditing(null);
          recarregar();
        }}
      />

      <ReceberDialog
        conta={openReceber}
        onClose={() => setOpenReceber(null)}
        onConfirmed={() => {
          setOpenReceber(null);
          recarregar();
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.desc", { name: confirmDelete?.titulo ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await excluirContaReceber(confirmDelete.id);
                  toast.success(t("delete.toastSuccess"));
                  setConfirmDelete(null);
                  recarregar();
                } catch (e) {
                  console.error(e);
                  toast.error(t("delete.toastError"));
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cancel.desc", { name: confirmCancel?.titulo ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel.back")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmCancel) return;
                try {
                  await cancelarContaReceber(confirmCancel.id);
                  toast.success(t("cancel.toastSuccess"));
                  setConfirmCancel(null);
                  recarregar();
                } catch (e) {
                  console.error(e);
                  toast.error(t("cancel.toastError"));
                }
              }}
            >
              {t("cancel.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ResumoCard({
  label,
  valor,
  subtitle,
  tone,
}: {
  label: string;
  valor: number;
  subtitle?: string;
  tone: "brand" | "destructive" | "success" | "muted";
}) {
  const metricTone =
    tone === "destructive"
      ? "negative"
      : tone === "success"
        ? "positive"
        : tone === "brand"
          ? "primary"
          : "default";
  return (
    <MetricCard
      label={label}
      value={<span className="num">{formatBRL(valor)}</span>}
      hint={subtitle}
      tone={metricTone}
    />
  );
}

function ContaCard({
  conta,
  onMarcar,
  onDesmarcar,
  onEdit,
  onDelete,
  onCancel,
  clienteNome,
}: {
  conta: ContaReceber;
  onMarcar: () => void;
  onDesmarcar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
  clienteNome?: string;
}) {
  const { t } = useTranslation("contas-a-receber");
  const eff = statusEfetivo(conta);
  const isRecebido = eff === "recebido";
  const isCancelado = conta.status === "cancelado";
  const tipoLabel = TIPOS_RECEBIMENTO.find((x) => x.id === conta.tipo_recebimento)
    ? t(`tipos.${conta.tipo_recebimento}` as const, { defaultValue: conta.tipo_recebimento })
    : conta.tipo_recebimento;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3.5 shadow-card transition-colors",
        isCancelado ? "opacity-60" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <BrandLogo
            name={clienteNome || conta.pagador_nome || conta.titulo || "?"}
            size="sm"
          />
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={eff} cancelado={isCancelado} />
            <p className="text-[11px] text-muted-foreground">{tipoLabel}</p>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold">{conta.titulo}</h3>
          {conta.pagador_nome && (
            <p className="truncate text-[12px] text-muted-foreground">
              {t("card.from", { name: conta.pagador_nome })}
            </p>
          )}
          {clienteNome && (
            <p className="truncate text-[11px] text-muted-foreground">
              {t("card.client", { name: clienteNome })}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("card.expectedOn", { date: formatDateBR(conta.data_prevista) })}
            {conta.data_recebimento && (
              <> · {t("card.receivedOn", { date: formatDateBR(conta.data_recebimento) })}</>
            )}
          </p>
          </div>
        </div>
        <div className="text-right">
          <Money value={Number(conta.valor_total)} className="num text-sm font-bold" />
          {Number(conta.valor_recebido) > 0 && Number(conta.valor_recebido) < Number(conta.valor_total) && (
            <p className="num mt-0.5 text-[10px] text-muted-foreground">
              {t("card.receivedAmount", { amount: formatBRL(Number(conta.valor_recebido)) })}
            </p>
          )}
          {!isRecebido && !isCancelado && Number(conta.valor_restante) > 0 && (
            <p className="num mt-0.5 text-[10px] text-success">
              {t("card.remainingAmount", { amount: formatBRL(Number(conta.valor_restante)) })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {!isCancelado && !isRecebido && (
          <Button size="sm" variant="default" className="h-10 rounded-lg sm:h-8" onClick={onMarcar}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {t("card.markReceived")}
          </Button>
        )}
        {!isCancelado && isRecebido && (
          <Button size="sm" variant="outline" className="h-10 rounded-lg sm:h-8" onClick={onDesmarcar}>
            <Clock className="mr-1 h-3.5 w-3.5" />
            {t("card.unmark")}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-10 rounded-lg sm:h-8" onClick={onEdit}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("card.edit")}
        </Button>
        {!isCancelado && (
          <Button size="sm" variant="outline" className="h-10 rounded-lg sm:h-8" onClick={onCancel}>
            <Ban className="mr-1 h-3.5 w-3.5" />
            {t("card.cancel")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-10 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-8"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status, cancelado }: { status: StatusContaReceber; cancelado: boolean }) {
  const { t } = useTranslation("contas-a-receber");
  if (cancelado) {
    return (
      <PremiumStatusBadge tone="muted" dot>
        <Ban className="h-3 w-3" /> {t("status.cancelado")}
      </PremiumStatusBadge>
    );
  }
  if (status === "recebido") {
    return (
      <PremiumStatusBadge tone="success" dot>
        <CheckCircle2 className="h-3 w-3" /> {t("status.recebido")}
      </PremiumStatusBadge>
    );
  }
  if (status === "atrasado") {
    return (
      <PremiumStatusBadge tone="destructive" dot>
        <AlertTriangle className="h-3 w-3" /> {t("status.atrasado")}
      </PremiumStatusBadge>
    );
  }
  if (status === "parcial") {
    return (
      <PremiumStatusBadge tone="warning" dot>
        <Clock className="h-3 w-3" /> {t("status.parcial")}
      </PremiumStatusBadge>
    );
  }
  return (
    <PremiumStatusBadge tone="info" dot>
      <Clock className="h-3 w-3" /> {t("status.pendente")}
    </PremiumStatusBadge>
  );
}

function ContaReceberFormDialog({
  open,
  onOpenChange,
  editing,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ContaReceber | null;
  userId: string | undefined;
  onSaved: () => void;
}) {
  const { t } = useTranslation("contas-a-receber");
  const [titulo, setTitulo] = useState("");
  const [pagador, setPagador] = useState("");
  const [tipo, setTipo] = useState<string>("cliente");
  const [valor, setValor] = useState("");
  const [dataPrevista, setDataPrevista] = useState(todayISO());
  const [categoria, setCategoria] = useState("");
  const [forma, setForma] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { ativos: clientesAtivos } = useClientes();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitulo(editing.titulo);
      setPagador(editing.pagador_nome ?? "");
      setTipo(editing.tipo_recebimento);
      setValor(formatBRL(Number(editing.valor_total)).replace("R$", "").trim());
      setDataPrevista(editing.data_prevista);
      setCategoria(editing.categoria ?? "");
      setForma((editing.forma_recebimento as string) ?? "");
      setObservacao(editing.observacao ?? "");
      setClienteId(editing.cliente_id ?? null);
    } else {
      setTitulo("");
      setPagador("");
      setTipo("cliente");
      setValor("");
      setDataPrevista(todayISO());
      setCategoria("");
      setForma("");
      setObservacao("");
      setClienteId(null);
    }
  }, [open, editing]);

  async function handleSubmit() {
    if (!userId) return;
    const tituloTrim = titulo.trim();
    if (!tituloTrim) {
      toast.error(t("form.errTitle"));
      return;
    }
    const valorNum = parseBRLInput(valor);
    if (!valorNum || valorNum <= 0) {
      toast.error(t("form.errValue"));
      return;
    }
    if (!dataPrevista) {
      toast.error(t("form.errDate"));
      return;
    }

    setSaving(true);
    try {
      const payload: NovaContaReceberInput = {
        titulo: tituloTrim,
        pagador_nome: pagador || null,
        tipo_recebimento: tipo,
        valor_total: valorNum,
        data_prevista: dataPrevista,
        categoria: categoria || null,
        forma_recebimento: forma || null,
        observacao: observacao || null,
        cliente_id: clienteId,
      };
      if (editing) {
        await atualizarContaReceber(editing.id, payload);
        toast.success(t("form.toastUpdated"));
      } else {
        await criarContaReceber(userId, payload);
        toast.success(t("form.toastCreated"));
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, t("form.toastError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
          <DialogDescription>{t("form.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cr-titulo">{t("form.titleLabel")}</Label>
            <Input
              id="cr-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cr-valor">{t("form.value")}</Label>
              <Input
                id="cr-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={t("form.valuePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-data">{t("form.expectedDate")}</Label>
              <Input
                id="cr-data"
                type="date"
                value={dataPrevista}
                onChange={(e) => setDataPrevista(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("form.tipo")}</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEBIMENTO.map((tp) => (
                    <SelectItem key={tp.id} value={tp.id}>
                      {t(`tipos.${tp.id}` as const, { defaultValue: tp.label })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("form.forma")}</Label>
              <Select value={forma || "__none"} onValueChange={(v) => setForma(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("form.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("form.none")}</SelectItem>
                  {FORMAS_RECEBIMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {t(`formas.${f.id}` as const, { defaultValue: f.label })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-pagador">{t("form.payer")}</Label>
            <Input
              id="cr-pagador"
              value={pagador}
              onChange={(e) => setPagador(e.target.value)}
              placeholder={t("form.payerPlaceholder")}
              maxLength={120}
            />
          </div>
          <ClienteSelect
            value={clienteId}
            onChange={setClienteId}
            clientesAtivos={clientesAtivos}
          />
          <div className="space-y-1.5">
            <Label htmlFor="cr-categoria">{t("form.category")}</Label>
            <Input
              id="cr-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder={t("form.categoryPlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-obs">{t("form.obs")}</Label>
            <Textarea
              id="cr-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" />
            {t("form.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            <Check className="mr-1 h-4 w-4" />
            {editing ? t("form.save") : t("form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceberDialog({
  conta,
  onClose,
  onConfirmed,
}: {
  conta: ContaReceber | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { t } = useTranslation("contas-a-receber");
  if (!conta) return null;
  return (
    <Dialog open={!!conta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("receive.title")}</DialogTitle>
        </DialogHeader>
        <ReceberContaForm conta={conta} onConfirmed={onConfirmed} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
