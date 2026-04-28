import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Target,
  Trophy,
  Sparkles,
  Pencil,
  MoreVertical,
  Minus,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import {
  addMeta,
  addMovimentacaoMeta,
  deleteMeta,
  getBancos,
  getMetas,
  statusMeta,
  updateMeta,
  useBootstrap,
  useStore,
} from "@/lib/store";
import type { Meta } from "@/lib/types";
import { formatBRL, formatDateBR, parseBRLInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const META_COLORS = [
  "#34d399", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c",
  "#fde047", "#22d3ee", "#f87171", "#e879f9", "#94a3b8",
];

const STATUS_LABEL = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  quase: "Quase concluída",
  concluida: "Concluída",
} as const;

export const Route = createFileRoute("/metas")({
  head: () => ({ meta: [{ title: "Metas financeiras — Gasto Fácil" }] }),
  component: MetasPage,
});

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; meta: Meta }
  | { kind: "add"; meta: Meta }
  | { kind: "remove"; meta: Meta };

function MetasPage() {
  const ready = useBootstrap();
  const metas = useStore(() => getMetas());
  const bancos = useStore(() => getBancos());

  const ordenadas = useMemo(() => {
    return [...metas].sort((a, b) => {
      const pa = a.valorObjetivo > 0 ? a.valorAtual / a.valorObjetivo : 0;
      const pb = b.valorObjetivo > 0 ? b.valorAtual / b.valorObjetivo : 0;
      return pb - pa;
    });
  }, [metas]);

  const totalAcumulado = useMemo(
    () => metas.reduce((s, m) => s + m.valorAtual, 0),
    [metas],
  );

  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [confirmDelete, setConfirmDelete] = useState<Meta | null>(null);

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Objetivos</p>
          <h1 className="text-2xl font-bold tracking-tight">Metas financeiras</h1>
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-xs font-medium text-muted-foreground">Total acumulado em metas</p>
        <p className="num mt-1 text-4xl font-extrabold tracking-tight">{formatBRL(totalAcumulado)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {metas.length} {metas.length === 1 ? "meta" : "metas"} criadas
        </p>
      </section>

      <Button
        size="lg"
        className="mt-4 h-14 w-full rounded-2xl text-base font-semibold shadow-elevated"
        onClick={() => setDialog({ kind: "create" })}
      >
        <Plus className="mr-1 h-5 w-5" />
        Nova meta
      </Button>

      <section className="mt-5 space-y-3">
        {ordenadas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center animate-fade-in">
            <Target className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Sua primeira meta pode começar hoje.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Defina um objetivo e acompanhe seu progresso passo a passo.
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {ordenadas.map((m) => (
              <MetaCard
                key={m.id}
                meta={m}
                onAdd={() => setDialog({ kind: "add", meta: m })}
                onRemove={() => setDialog({ kind: "remove", meta: m })}
                onEdit={() => setDialog({ kind: "edit", meta: m })}
                onDelete={() => setConfirmDelete(m)}
              />
            ))}
          </div>
        )}
      </section>

      <MetaFormDialog
        mode={dialog}
        bancos={bancos}
        onClose={() => setDialog({ kind: "closed" })}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir meta?</AlertDialogTitle>
            <AlertDialogDescription>
              A meta <strong>{confirmDelete?.nome}</strong> e seu histórico serão removidos. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) {
                  deleteMeta(confirmDelete.id);
                  toast.success("Meta excluída.");
                }
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function MetaCard({
  meta,
  onAdd,
  onRemove,
  onEdit,
  onDelete,
}: {
  meta: Meta;
  onAdd: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = statusMeta(meta);
  const pct = meta.valorObjetivo > 0 ? Math.min(100, (meta.valorAtual / meta.valorObjetivo) * 100) : 0;
  const restante = Math.max(0, meta.valorObjetivo - meta.valorAtual);

  return (
    <div
      className="rounded-3xl border border-border bg-card p-4 hover-lift"
      style={{ boxShadow: status === "concluida" ? `0 0 0 1px ${meta.colorHex} inset` : undefined }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in oklab, ${meta.colorHex} 22%, transparent)`, color: meta.colorHex }}
        >
          {status === "concluida" ? <Trophy className="h-5 w-5" /> : <Target className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{meta.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {STATUS_LABEL[status]}
            {meta.prazo ? ` · até ${formatDateBR(meta.prazo)}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
              aria-label="Mais ações"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar meta
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar valor
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove} disabled={meta.valorAtual <= 0}>
              <Minus className="mr-2 h-4 w-4" />
              Remover valor
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir meta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <p className="num text-2xl font-extrabold tracking-tight">{formatBRL(meta.valorAtual)}</p>
        <p className="num text-xs text-muted-foreground">de {formatBRL(meta.valorObjetivo)}</p>
      </div>

      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: meta.colorHex }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="num font-semibold" style={{ color: meta.colorHex }}>{pct.toFixed(0)}%</span>
        <span className="num text-muted-foreground">faltam {formatBRL(restante)}</span>
      </div>

      {status === "concluida" ? (
        <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-xs text-success">
          <Sparkles className="h-3.5 w-3.5" />
          Parabéns! Você concluiu sua meta.
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-9 w-full rounded-xl"
          onClick={onAdd}
        >
          <Plus className="mr-1 h-4 w-4" />
          Adicionar valor
        </Button>
      )}
    </div>
  );
}

function MetaFormDialog({
  mode,
  bancos,
  onClose,
}: {
  mode: DialogMode;
  bancos: ReturnType<typeof getBancos>;
  onClose: () => void;
}) {
  const isCreate = mode.kind === "create";
  const isEdit = mode.kind === "edit";
  const isAdd = mode.kind === "add";
  const isRemove = mode.kind === "remove";
  const open = isCreate || isEdit || isAdd || isRemove;
  const baseMeta = isEdit || isAdd || isRemove ? mode.meta : null;

  const [nome, setNome] = useState("");
  const [objetivoStr, setObjetivoStr] = useState("");
  const [acumuladoStr, setAcumuladoStr] = useState("");
  const [prazo, setPrazo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [colorHex, setColorHex] = useState(META_COLORS[0]);
  const [bancoId, setBancoId] = useState<string>("nenhum");
  const [valorStr, setValorStr] = useState("");
  const [movBanco, setMovBanco] = useState<string>("nenhum");

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    if (isCreate) {
      setNome("");
      setObjetivoStr("");
      setAcumuladoStr("");
      setPrazo("");
      setDescricao("");
      setColorHex(META_COLORS[0]);
      setBancoId("nenhum");
    } else if (baseMeta) {
      setNome(baseMeta.nome);
      setObjetivoStr(formatBRL(baseMeta.valorObjetivo).replace("R$", "").trim());
      setAcumuladoStr(formatBRL(baseMeta.valorAtual).replace("R$", "").trim());
      setPrazo(baseMeta.prazo ?? "");
      setDescricao(baseMeta.descricao ?? "");
      setColorHex(baseMeta.colorHex);
      setBancoId(baseMeta.bancoId ?? "nenhum");
    }
    setValorStr("");
    setMovBanco("nenhum");
  }, [open, isCreate, baseMeta]);

  function handleCreateOrEdit() {
    const objetivo = parseBRLInput(objetivoStr);
    if (!nome.trim() || !objetivo) {
      toast.error("Coloca um nome e o valor da meta.");
      return;
    }
    if (isCreate) {
      addMeta({
        nome: nome.trim(),
        valorObjetivo: objetivo,
        valorAtual: parseBRLInput(acumuladoStr) || 0,
        prazo: prazo || undefined,
        descricao: descricao.trim() || undefined,
        colorHex,
        bancoId: bancoId === "nenhum" ? undefined : bancoId,
      });
      toast.success("Meta criada. Cada passo conta. 🎯");
      onClose();
      return;
    }
    if (isEdit && baseMeta) {
      const novoAcumulado = parseBRLInput(acumuladoStr) || 0;
      if (novoAcumulado > objetivo) {
        toast.warning("Heads up: o valor acumulado ficou maior que o objetivo. Salvei mesmo assim.");
      }
      updateMeta(baseMeta.id, {
        nome: nome.trim(),
        valorObjetivo: objetivo,
        valorAtual: novoAcumulado,
        prazo: prazo || undefined,
        descricao: descricao.trim() || undefined,
        colorHex,
        bancoId: bancoId === "nenhum" ? undefined : bancoId,
      });
      toast.success("Pronto, sua meta foi atualizada.");
      onClose();
    }
  }

  function handleAddValor() {
    if (!baseMeta) return;
    const v = parseBRLInput(valorStr);
    if (!v) {
      toast.error("Informe um valor.");
      return;
    }
    addMovimentacaoMeta({
      metaId: baseMeta.id,
      valor: v,
      bancoId: movBanco === "nenhum" ? undefined : movBanco,
    });
    toast.success("Boa, valor adicionado. 🚀");
    onClose();
  }

  function handleRemoverValor() {
    if (!baseMeta) return;
    const v = parseBRLInput(valorStr);
    if (!v) {
      toast.error("Informe um valor.");
      return;
    }
    const novo = Math.max(0, baseMeta.valorAtual - v);
    updateMeta(baseMeta.id, { valorAtual: novo });
    toast.success("Valor ajustado.");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isCreate && "Criar meta financeira"}
            {isEdit && "Editar meta"}
            {isAdd && "Adicionar à meta"}
            {isRemove && "Ajustar valor"}
          </DialogTitle>
          <DialogDescription>
            {isCreate && "Defina um objetivo e acompanhe o progresso."}
            {isEdit && "Atualize qualquer informação da sua meta."}
            {isAdd && baseMeta?.nome}
            {isRemove && `Remover valor de ${baseMeta?.nome}`}
          </DialogDescription>
        </DialogHeader>

        {(isCreate || isEdit) && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Nome</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Viagem"
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Valor objetivo</Label>
                <Input
                  inputMode="decimal"
                  value={objetivoStr}
                  onChange={(e) => setObjetivoStr(e.target.value)}
                  placeholder="0,00"
                  className="num mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {isEdit ? "Valor acumulado" : "Já guardado"}
                </Label>
                <Input
                  inputMode="decimal"
                  value={acumuladoStr}
                  onChange={(e) => setAcumuladoStr(e.target.value)}
                  placeholder="0,00"
                  className="num mt-1 h-11 bg-card-elevated"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Prazo (opcional)</Label>
                <Input
                  type="date"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Banco vinculado</Label>
                <Select value={bancoId} onValueChange={setBancoId}>
                  <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Nenhum</SelectItem>
                    {bancos.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Descrição</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Opcional"
                className="mt-1 min-h-[60px] bg-card-elevated"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Cor</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {META_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorHex(c)}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-all",
                      colorHex === c ? "border-foreground scale-110" : "border-transparent",
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {(isAdd || isRemove) && baseMeta && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-card-elevated p-3">
              <p className="text-xs text-muted-foreground">Acumulado atual</p>
              <p className="num text-xl font-bold">{formatBRL(baseMeta.valorAtual)}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Valor</Label>
              <Input
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
                className="num mt-1 h-11 bg-card-elevated"
                autoFocus
              />
            </div>
            {isAdd && (
              <div>
                <Label className="text-xs text-muted-foreground">Banco de origem</Label>
                <Select value={movBanco} onValueChange={setMovBanco}>
                  <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Não vincular</SelectItem>
                    {bancos.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {(isCreate || isEdit) && (
            <Button onClick={handleCreateOrEdit}>
              {isCreate ? "Criar meta" : "Salvar alterações"}
            </Button>
          )}
          {isAdd && <Button onClick={handleAddValor}>Adicionar</Button>}
          {isRemove && <Button onClick={handleRemoverValor}>Remover valor</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
