import { useMemo, useState } from "react";
import {
  FileText,
  FileSpreadsheet,
  ImageIcon,
  Trash2,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateBR } from "@/lib/format";
import {
  getExtratosImportados,
  getItensDoBatch,
  getItensEditadosDoBatch,
  revertExtratoImportado,
  deleteExtratoImportado,
  useStore,
} from "@/lib/store";
import type { ExtratoImportado } from "@/lib/types";

function iconForOrigem(o: ExtratoImportado["tipoOrigem"]) {
  if (o === "pdf") return <FileText className="h-4 w-4" />;
  if (o === "csv") return <FileSpreadsheet className="h-4 w-4" />;
  return <ImageIcon className="h-4 w-4" />;
}

function statusBadge(status: ExtratoImportado["status"]) {
  if (status === "revertido") {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <XCircle className="h-3 w-3" /> Revertido
      </Badge>
    );
  }
  if (status === "erro") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Erro
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Importado
    </Badge>
  );
}

export function ExtratosImportadosDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  useStore(() => 0);
  const extratos = getExtratosImportados();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const selected = useMemo(
    () => extratos.find((e) => e.id === selectedId) ?? null,
    [extratos, selectedId],
  );

  const itensDoSelecionado = useMemo(() => {
    if (!selectedId) return null;
    return getItensDoBatch(selectedId);
  }, [selectedId, extratos]);

  const editadosDoSelecionado = useMemo(() => {
    if (!selectedId) return null;
    return getItensEditadosDoBatch(selectedId);
  }, [selectedId, extratos]);

  const handleClose = (v: boolean) => {
    if (!v) {
      setSelectedId(null);
      setConfirmRevertId(null);
      setConfirmDeleteId(null);
    }
    onOpenChange(v);
  };

  const handleRevert = async (batchId: string) => {
    setWorking(true);
    try {
      const ok = await revertExtratoImportado(batchId);
      if (ok) {
        toast.success("Importação revertida. Dashboard, Gastos, Minha renda e Guardado foram recalculados.");
      } else {
        toast.error("Não foi possível reverter essa importação. Tente novamente.");
      }
    } finally {
      setWorking(false);
      setConfirmRevertId(null);
    }
  };

  const handleDelete = async (batchId: string) => {
    setWorking(true);
    try {
      const ok = await deleteExtratoImportado(batchId);
      if (ok) {
        toast.success("Registro removido do histórico.");
        if (selectedId === batchId) setSelectedId(null);
      } else {
        toast.error("Não foi possível remover esse registro.");
      }
    } finally {
      setWorking(false);
      setConfirmDeleteId(null);
    }
  };

  const confirmRevertExtrato = confirmRevertId
    ? extratos.find((e) => e.id === confirmRevertId)
    : null;
  const confirmRevertEditados = confirmRevertId
    ? getItensEditadosDoBatch(confirmRevertId)
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg">
              {selected ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Voltar"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  Detalhes da importação
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5" />
                  Extratos importados
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {selected
                ? "Veja os itens dessa importação e, se precisar, reverta o lote."
                : "Histórico das importações de extrato bancário."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!selected && (
              <>
                {extratos.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Nenhuma importação de extrato bancário até agora.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {extratos.map((e) => {
                      const periodo =
                        e.periodoInicio && e.periodoFim
                          ? `${formatDateBR(e.periodoInicio)} – ${formatDateBR(e.periodoFim)}`
                          : "Período não identificado";
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(e.id)}
                            className={cn(
                              "w-full flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/40 text-left transition-colors",
                              e.status === "revertido" && "opacity-60",
                            )}
                          >
                            <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground shrink-0">
                              {iconForOrigem(e.tipoOrigem)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">
                                  {e.nomeArquivo || `Extrato ${e.tipoOrigem.toUpperCase()}`}
                                </span>
                                {statusBadge(e.status)}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {formatDateBR(e.dataImportacao)} • {periodo} •{" "}
                                {e.qtdMovimentacoes} movim.
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {selected && itensDoSelecionado && (
              <div className="space-y-5">
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">
                      {selected.nomeArquivo || `Extrato ${selected.tipoOrigem.toUpperCase()}`}
                    </span>
                    {statusBadge(selected.status)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Importado em {formatDateBR(selected.dataImportacao)}
                    {selected.periodoInicio && selected.periodoFim
                      ? ` • Período: ${formatDateBR(selected.periodoInicio)} – ${formatDateBR(selected.periodoFim)}`
                      : ""}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
                    <Stat label="Receitas" value={formatBRL(selected.totalReceitas)} positive />
                    <Stat label="Despesas" value={formatBRL(selected.totalDespesas)} negative />
                    <Stat label="Transferências" value={formatBRL(selected.totalTransferencias)} />
                    <Stat label="Movim." value={String(selected.qtdMovimentacoes)} />
                  </div>

                  {editadosDoSelecionado && editadosDoSelecionado.total > 0 && selected.status !== "revertido" && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>{editadosDoSelecionado.total}</strong> item(ns) desse lote
                        foram editados depois da importação. Reverter vai apagar esses
                        itens mesmo assim.
                      </div>
                    </div>
                  )}
                </div>

                <ItemList title="Despesas" items={itensDoSelecionado.gastos.map(g => ({
                  id: g.id, descricao: g.descricao, valor: g.valor, data: g.data,
                }))} tone="negative" />
                <ItemList title="Receitas" items={itensDoSelecionado.receitas.map(r => ({
                  id: r.id, descricao: r.descricao, valor: r.valor, data: r.data,
                }))} tone="positive" />
                <ItemList title="Transferências internas" items={itensDoSelecionado.transferencias.map(t => ({
                  id: t.id, descricao: t.descricao, valor: t.valor, data: t.data,
                }))} tone="neutral" />
              </div>
            )}
          </div>

          {selected && (
            <div className="border-t px-6 py-4 flex flex-wrap items-center justify-end gap-2 shrink-0">
              {selected.status === "revertido" ? (
                <Button
                  variant="outline"
                  onClick={() => setConfirmDeleteId(selected.id)}
                  disabled={working}
                >
                  <Trash2 className="h-4 w-4" />
                  Remover do histórico
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmRevertId(selected.id)}
                  disabled={working}
                >
                  {working ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Reverter importação
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmRevertId}
        onOpenChange={(v) => !v && setConfirmRevertId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverter importação?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai apagar <strong>todos</strong> os{" "}
              {confirmRevertExtrato?.qtdMovimentacoes ?? 0} lançamentos
              criados nessa importação (despesas, receitas, transferências e
              reservas) e atualizar Dashboard, Gastos, Minha renda e Guardado.
              {confirmRevertEditados && confirmRevertEditados.total > 0 && (
                <span className="block mt-3 text-amber-600 font-medium">
                  ⚠ {confirmRevertEditados.total} item(ns) foram editados depois
                  da importação e também serão apagados.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRevertId) handleRevert(confirmRevertId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? "Revertendo..." : "Sim, reverter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(v) => !v && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover do histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta importação já foi revertida. Remover apenas apaga o
              registro do histórico — não afeta nenhum lançamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteId) handleDelete(confirmDeleteId);
              }}
            >
              {working ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Stat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-semibold mt-0.5",
          positive && "text-emerald-600",
          negative && "text-rose-600",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ItemList({
  title,
  items,
  tone,
}: {
  title: string;
  items: Array<{ id: string; descricao: string; valor: number; data: string }>;
  tone: "positive" | "negative" | "neutral";
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">
        {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </h4>
      <ScrollArea className="max-h-56 rounded-lg border bg-background/40">
        <ul className="divide-y">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate">{it.descricao}</div>
                <div className="text-xs text-muted-foreground">{formatDateBR(it.data)}</div>
              </div>
              <div
                className={cn(
                  "font-medium",
                  tone === "positive" && "text-emerald-600",
                  tone === "negative" && "text-rose-600",
                )}
              >
                {formatBRL(it.valor)}
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
