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
  Image as ImageIcon,
  Check,
  Flame,
} from "lucide-react";
import {
  MetaCover,
  getMetaCoverKey,
  META_COVER_OPTIONS,
  CUSTOM_COVER_PREFIX,
  isCustomCoverKey,
  type MetaCoverKey,
} from "@/components/MetaCover";
import { supabase } from "@/integrations/supabase/client";
import { Upload } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  addMeta,
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
import { Money } from "@/components/Money";
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
  head: () => ({ meta: [{ title: "Metas financeiras — Gasto Inteligente" }] }),
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

  if (!ready) return <PageSkeleton />;

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

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated animate-rise">
        <p className="text-xs font-medium text-muted-foreground">Total acumulado em metas</p>
        <Money value={totalAcumulado} className="num mt-1 block text-4xl font-extrabold tracking-tight" />
        <p className="mt-1 text-xs text-muted-foreground">
          {metas.length} {metas.length === 1 ? "meta criada" : "metas criadas"}
        </p>
      </section>

      <Button
        size="lg"
        className="card-press mt-4 h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95"
        onClick={() => setDialog({ kind: "create" })}
      >
        <Plus className="mr-1 h-5 w-5" />
        Nova meta
      </Button>

      <section className="mt-5 space-y-3">
        {ordenadas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center animate-rise">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft animate-pop">
              <Target className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Escolha uma meta e acompanhe cada passo até chegar lá.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Viagem, reserva, troca de carro — qualquer objetivo que valha a pena.
            </p>
            <Button
              size="sm"
              className="card-press rounded-full mt-4"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              Criar primeira meta
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 stagger md:grid-cols-2 xl:grid-cols-3">
            {ordenadas.map((m) => (
              <MetaCard
                key={m.id}
                meta={m}
                onAdd={() => setDialog({ kind: "add", meta: m })}
                onRemove={() => setDialog({ kind: "remove", meta: m })}
                onEdit={() => setDialog({ kind: "edit", meta: m })}
                onChangeImage={() => setDialog({ kind: "edit", meta: m })}
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
  onChangeImage,
  onDelete,
}: {
  meta: Meta;
  onAdd: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onChangeImage: () => void;
  onDelete: () => void;
}) {
  const status = statusMeta(meta);
  const pct = meta.valorObjetivo > 0 ? Math.min(100, (meta.valorAtual / meta.valorObjetivo) * 100) : 0;
  const restante = Math.max(0, meta.valorObjetivo - meta.valorAtual);
  const isDone = status === "concluida";
  const isAlmostDone = pct >= 80 && !isDone;

  // imagemKey persistida tem prioridade; caso contrário, derivamos pelo nome.
  const coverKey = (meta.imagemKey as MetaCoverKey | undefined) ?? getMetaCoverKey(meta.nome, meta.descricao);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-border bg-card transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-elevated",
        isDone && "ring-2",
      )}
      style={{
        boxShadow: isDone ? `0 0 0 1px ${meta.colorHex} inset, 0 12px 30px -16px ${meta.colorHex}` : undefined,
      }}
    >
      {/* Cover com imagem real */}
      <div className="relative h-36 w-full overflow-hidden">
        <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.04]">
          <MetaCover coverKey={coverKey} alt={meta.nome} className="h-full w-full" />
        </div>
        {/* Overlay para legibilidade do título sobre foto real */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/55 to-transparent" />

        {/* Badges no topo */}
        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-success-foreground shadow-md animate-pop">
                <Trophy className="h-3 w-3" /> Concluída
              </span>
            )}
            {isAlmostDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
                <Flame className="h-3 w-3" /> Quase lá
              </span>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
                aria-label="Mais ações"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar meta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onChangeImage}>
                <ImageIcon className="mr-2 h-4 w-4" />
                Trocar imagem
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAdd}>
                <Plus className="mr-2 h-4 w-4" />
                Atualizar valor
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

        {/* Título sobre o cover */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
          <p className="line-clamp-1 text-base font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
            {meta.nome}
          </p>
          <p className="line-clamp-1 text-[11px] text-white/85 drop-shadow">
            {STATUS_LABEL[status]}
            {meta.prazo ? ` · até ${formatDateBR(meta.prazo)}` : ""}
          </p>
        </div>
      </div>

      {/* Corpo */}
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <Money value={meta.valorAtual} className="num text-2xl font-extrabold tracking-tight" />
          <p className="num text-xs text-muted-foreground">de {formatBRL(meta.valorObjetivo)}</p>
        </div>

        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
          <div
            className="h-full rounded-full origin-left animate-fill"
            style={{
              width: `${pct}%`,
              background: isDone
                ? `linear-gradient(90deg, ${meta.colorHex}, color-mix(in oklab, ${meta.colorHex} 60%, white))`
                : meta.colorHex,
              transition: "width 600ms cubic-bezier(0.22, 0.61, 0.36, 1)",
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="num font-semibold" style={{ color: meta.colorHex }}>{pct.toFixed(0)}%</span>
          <span className="num text-muted-foreground">faltam {formatBRL(restante)}</span>
        </div>

        {isDone ? (
          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success animate-pop">
            <Sparkles className="h-3.5 w-3.5" />
            Meta batida! Você chegou lá. 🏆
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="card-press mt-3 h-9 w-full rounded-xl"
            onClick={onAdd}
          >
            <Plus className="mr-1 h-4 w-4" />
            Atualizar valor
          </Button>
        )}
      </div>
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
  const [imagemKey, setImagemKey] = useState<string>("objetivo");
  /** Indica se o usuário escolheu manualmente — caso contrário, mantemos auto-match. */
  const [imagemManual, setImagemManual] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleUploadCover(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx. 5MB).");
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Faça login novamente.");
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("metas-covers")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast.error("Falha ao enviar a imagem.");
        return;
      }
      setImagemKey(`${CUSTOM_COVER_PREFIX}${path}`);
      setImagemManual(true);
      toast.success("Imagem enviada.");
    } finally {
      setUploading(false);
    }
  }

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
      setImagemKey("objetivo");
      setImagemManual(false);
    } else if (baseMeta) {
      setNome(baseMeta.nome);
      setObjetivoStr(formatBRL(baseMeta.valorObjetivo).replace("R$", "").trim());
      setAcumuladoStr(formatBRL(baseMeta.valorAtual).replace("R$", "").trim());
      setPrazo(baseMeta.prazo ?? "");
      setDescricao(baseMeta.descricao ?? "");
      setColorHex(baseMeta.colorHex);
      setBancoId(baseMeta.bancoId ?? "nenhum");
      const persistida = baseMeta.imagemKey as MetaCoverKey | undefined;
      setImagemKey(persistida ?? getMetaCoverKey(baseMeta.nome, baseMeta.descricao));
      setImagemManual(!!persistida);
    }
    // Pré-preenche com o valor acumulado atual no modo "atualizar valor"
    if (isAdd && baseMeta) {
      setValorStr(formatBRL(baseMeta.valorAtual).replace("R$", "").trim());
    } else {
      setValorStr("");
    }
    
  }, [open, isCreate, isAdd, baseMeta]);

  // Auto-match: enquanto o usuário não tiver escolhido manualmente,
  // recalculamos a sugestão a partir do nome/descrição.
  useEffect(() => {
    if (!open || imagemManual) return;
    if (!isCreate && !isEdit) return;
    setImagemKey(getMetaCoverKey(nome, descricao));
  }, [nome, descricao, imagemManual, open, isCreate, isEdit]);

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
        imagemKey,
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
        imagemKey,
      });
      toast.success("Pronto, sua meta foi atualizada.");
      onClose();
    }
  }

  function handleAddValor() {
    if (!baseMeta) return;
    const trimmed = valorStr.trim();
    if (trimmed === "") {
      toast.error("Informe o valor acumulado atual.");
      return;
    }
    const v = parseBRLInput(valorStr);
    // permite 0,00 para resetar; bloqueia negativo
    if (v < 0 || Number.isNaN(v)) {
      toast.error("O valor não pode ser negativo.");
      return;
    }
    updateMeta(baseMeta.id, { valorAtual: v });
    if (baseMeta.valorObjetivo > 0 && v > baseMeta.valorObjetivo) {
      toast.success("Você passou da meta. Melhor ainda. 🏆");
    } else {
      toast.success("Meta atualizada. Agora tá certinho.");
    }
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
            {isAdd && "Atualizar valor da meta"}
            {isRemove && "Ajustar valor"}
          </DialogTitle>
          <DialogDescription>
            {isCreate && "Defina um objetivo e acompanhe o progresso."}
            {isEdit && "Atualize qualquer informação da sua meta."}
            {isAdd && "Informe quanto você já juntou até agora para esta meta."}
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
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Imagem da meta</Label>
                {imagemManual && (
                  <button
                    type="button"
                    onClick={() => {
                      setImagemManual(false);
                      setImagemKey(getMetaCoverKey(nome, descricao));
                    }}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Usar sugestão automática
                  </button>
                )}
              </div>
              <div className="mt-2 overflow-hidden rounded-2xl border border-border">
                <MetaCover coverKey={imagemKey} className="h-28 w-full" />
              </div>

              <label
                className={cn(
                  "mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card-elevated/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Enviando..." : "Enviar imagem própria (até 5MB)"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadCover(f);
                    e.target.value = "";
                  }}
                />
              </label>

              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ou escolha uma sugestão
              </p>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                {META_COVER_OPTIONS.map((opt) => {
                  const active = imagemKey === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setImagemKey(opt.key);
                        setImagemManual(true);
                      }}
                      className={cn(
                        "group relative aspect-square overflow-hidden rounded-xl border-2 transition-all",
                        active
                          ? "border-foreground scale-[1.03] shadow-md"
                          : "border-transparent hover:border-border",
                      )}
                      title={opt.label}
                      aria-label={opt.label}
                    >
                      <MetaCover coverKey={opt.key} className="h-full w-full" />
                      {active && (
                        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background shadow">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {isCustomCoverKey(imagemKey)
                  ? "Imagem própria enviada."
                  : imagemManual
                    ? "Imagem escolhida manualmente."
                    : "Sugerida automaticamente pelo nome da meta."}
              </p>
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
              <p className="num mt-1 text-xs text-muted-foreground">
                Objetivo: {formatBRL(baseMeta.valorObjetivo)}
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                {isAdd ? "Valor acumulado atual" : "Valor a remover"}
              </Label>
              <Input
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
                className="num mt-1 h-11 bg-card-elevated"
                autoFocus
              />
              {isAdd && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Quanto você já juntou até agora? Esse valor substitui o acumulado atual.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {(isCreate || isEdit) && (
            <Button onClick={handleCreateOrEdit}>
              {isCreate ? "Criar meta" : "Salvar alterações"}
            </Button>
          )}
          {isAdd && <Button onClick={handleAddValor}>Salvar valor</Button>}
          {isRemove && <Button onClick={handleRemoverValor}>Remover valor</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
