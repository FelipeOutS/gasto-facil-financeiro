import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  marcarRecebida,
  desmarcarRecebida,
  cancelarContaReceber,
  calcularResumo,
  statusEfetivo,
} from "@/lib/contas-receber";
import { useClientes } from "@/lib/clientes";
import { ClienteSelect, nomeExibicaoCliente } from "@/components/ClienteSelect";

export const Route = createFileRoute("/contas-a-receber")({
  component: ContasAReceberPage,
});

type FilterStatus = "todas" | "pendente" | "atrasado" | "parcial" | "recebido" | "cancelado";

function ContasAReceberPage() {
  const { t } = useTranslation("contas-a-receber");
  const { user } = useAuth();
  const userId = user?.id;
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
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => {
            setEditing(null);
            setOpenForm(true);
          }}
        >
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
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
            <HandCoins className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {lista.length === 0 ? t("empty.none") : t("empty.noResults")}
            </p>
            {lista.length === 0 && (
              <Button
                size="sm"
                className="mt-3 rounded-xl"
                onClick={() => {
                  setEditing(null);
                  setOpenForm(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("empty.addFirst")}
              </Button>
            )}
          </div>
        ) : (
          listaFiltrada.map((c) => (
            <ContaCard
              key={c.id}
              conta={c}
              clienteNome={c.cliente_id ? nomeExibicaoCliente(clientesPorId[c.cliente_id]) : undefined}
              onMarcar={() => setOpenReceber(c)}
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
              onEdit={() => {
                setEditing(c);
                setOpenForm(true);
              }}
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
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : tone === "brand"
          ? "text-brand"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-card">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-base font-bold", toneClass)}>{formatBRL(valor)}</p>
      {subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>}
    </div>
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
  const eff = statusEfetivo(conta);
  const isRecebido = eff === "recebido";
  const isCancelado = conta.status === "cancelado";
  const tipoLabel = TIPOS_RECEBIMENTO.find((t) => t.id === conta.tipo_recebimento)?.label ?? conta.tipo_recebimento;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3.5 shadow-card transition-colors",
        isCancelado ? "opacity-60" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={eff} cancelado={isCancelado} />
            <p className="text-[11px] text-muted-foreground">{tipoLabel}</p>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold">{conta.titulo}</h3>
          {conta.pagador_nome && (
            <p className="truncate text-[12px] text-muted-foreground">de {conta.pagador_nome}</p>
          )}
          {clienteNome && (
            <p className="truncate text-[11px] text-muted-foreground">Cliente: {clienteNome}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Previsto: {formatDateBR(conta.data_prevista)}
            {conta.data_recebimento && (
              <> · Recebido em {formatDateBR(conta.data_recebimento)}</>
            )}
          </p>
        </div>
        <div className="text-right">
          <Money value={Number(conta.valor_total)} className="num text-sm font-bold" />
          {Number(conta.valor_recebido) > 0 && Number(conta.valor_recebido) < Number(conta.valor_total) && (
            <p className="num mt-0.5 text-[10px] text-muted-foreground">
              Recebido {formatBRL(Number(conta.valor_recebido))}
            </p>
          )}
          {!isRecebido && !isCancelado && Number(conta.valor_restante) > 0 && (
            <p className="num mt-0.5 text-[10px] text-success">
              Restante {formatBRL(Number(conta.valor_restante))}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {!isCancelado && !isRecebido && (
          <Button size="sm" variant="default" className="h-8 rounded-lg" onClick={onMarcar}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Marcar recebido
          </Button>
        )}
        {!isCancelado && isRecebido && (
          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={onDesmarcar}>
            <Clock className="mr-1 h-3.5 w-3.5" />
            Desmarcar
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={onEdit}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Editar
        </Button>
        {!isCancelado && (
          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={onCancel}>
            <Ban className="mr-1 h-3.5 w-3.5" />
            Cancelar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status, cancelado }: { status: StatusContaReceber; cancelado: boolean }) {
  if (cancelado) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Ban className="h-3 w-3" /> Cancelado
      </span>
    );
  }
  if (status === "recebido") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle2 className="h-3 w-3" /> Recebido
      </span>
    );
  }
  if (status === "atrasado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" /> Atrasado
      </span>
    );
  }
  if (status === "parcial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
        <Clock className="h-3 w-3" /> Parcial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand">
      <Clock className="h-3 w-3" /> Pendente
    </span>
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
      toast.error("Informe um título");
      return;
    }
    const valorNum = parseBRLInput(valor);
    if (!valorNum || valorNum <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (!dataPrevista) {
      toast.error("Informe a data prevista");
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
        toast.success("Conta atualizada");
      } else {
        await criarContaReceber(userId, payload);
        toast.success("Conta criada");
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar conta a receber" : "Nova conta a receber"}</DialogTitle>
          <DialogDescription>
            Cadastre uma entrada prevista para acompanhar o que você ainda tem a receber.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cr-titulo">Título *</Label>
            <Input
              id="cr-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Projeto site João"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cr-valor">Valor *</Label>
              <Input
                id="cr-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-data">Data prevista *</Label>
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
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEBIMENTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Forma prevista</Label>
              <Select value={forma || "__none"} onValueChange={(v) => setForma(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {FORMAS_RECEBIMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-pagador">Pagador (opcional)</Label>
            <Input
              id="cr-pagador"
              value={pagador}
              onChange={(e) => setPagador(e.target.value)}
              placeholder="Nome de quem vai pagar"
              maxLength={120}
            />
          </div>
          <ClienteSelect
            value={clienteId}
            onChange={setClienteId}
            clientesAtivos={clientesAtivos}
          />
          <div className="space-y-1.5">
            <Label htmlFor="cr-categoria">Categoria (opcional)</Label>
            <Input
              id="cr-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Ex: Serviços, Aluguel"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-obs">Observação</Label>
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
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            <Check className="mr-1 h-4 w-4" />
            {editing ? "Salvar alterações" : "Criar conta"}
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
  const [valorAgora, setValorAgora] = useState("");
  const [data, setData] = useState(todayISO());
  const [forma, setForma] = useState<string>("");
  const [parcial, setParcial] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (conta) {
      setValorAgora("");
      setData(todayISO());
      setForma((conta.forma_recebimento as string) ?? "");
      setParcial(false);
    }
  }, [conta]);

  if (!conta) return null;
  const restante = Math.max(0, Number(conta.valor_total) - Number(conta.valor_recebido));

  async function handleConfirm() {
    if (!conta) return;
    setSaving(true);
    try {
      const opts: { valor_recebido_agora?: number; data_recebimento?: string; forma_recebimento?: string | null } = {
        data_recebimento: data,
        forma_recebimento: forma || null,
      };
      if (parcial) {
        const v = parseBRLInput(valorAgora);
        if (!v || v <= 0) {
          toast.error("Informe o valor recebido");
          setSaving(false);
          return;
        }
        opts.valor_recebido_agora = v;
      }
      await marcarRecebida(conta.id, opts);
      toast.success("Recebimento registrado");
      onConfirmed();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!conta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            {conta.titulo} · restante {formatBRL(restante)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={parcial}
              onChange={(e) => setParcial(e.target.checked)}
              className="h-4 w-4"
            />
            Recebimento parcial
          </label>

          {parcial && (
            <div className="space-y-1.5">
              <Label>Valor recebido agora</Label>
              <Input
                inputMode="decimal"
                value={valorAgora}
                onChange={(e) => setValorAgora(e.target.value)}
                placeholder="0,00"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Forma</Label>
              <Select value={forma || "__none"} onValueChange={(v) => setForma(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {FORMAS_RECEBIMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            <Check className="mr-1 h-4 w-4" />
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
