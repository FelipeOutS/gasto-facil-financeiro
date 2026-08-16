import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  revertExtratoImportadoSeguro,
  deleteExtratoImportado,
  useStore,
} from "@/lib/store";
import type { ExtratoImportado } from "@/lib/types";

function iconForOrigem(o: ExtratoImportado["tipoOrigem"]) {
  if (o === "pdf") return <FileText className="h-4 w-4" />;
  if (o === "csv") return <FileSpreadsheet className="h-4 w-4" />;
  return <ImageIcon className="h-4 w-4" />;
}

function StatusBadge({ status }: { status: ExtratoImportado["status"] }) {
  const { t } = useTranslation("extratos-importados");
  if (status === "revertido") {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <XCircle className="h-3 w-3" /> {t("status.revertido")}
      </Badge>
    );
  }
  if (status === "parcial") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
        <AlertTriangle className="h-3 w-3" /> {t("status.parcial")}
      </Badge>
    );
  }
  if (status === "erro") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> {t("status.erro")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> {t("status.importado")}
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
  const { t } = useTranslation("extratos-importados");
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
      const res = await revertExtratoImportadoSeguro(batchId);
      if (!res.ok) {
        toast.error(t("toast.revertFail"));
        return;
      }
      if (res.mantidos > 0) {
        toast.success(
          t("toast.revertedPartial", { removed: res.removidos, kept: res.mantidos }),
        );
      } else {
        toast.success(t("toast.reverted"));
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
        toast.success(t("toast.removed"));
        if (selectedId === batchId) setSelectedId(null);
      } else {
        toast.error(t("toast.removeFail"));
      }
    } finally {
      setWorking(false);
      setConfirmDeleteId(null);
    }
  };

  const confirmRevertExtrato = confirmRevertId
    ? extratos.find((e) => e.id === confirmRevertId)
    : null;
  const confirmRevertEditados = confirmRevertId ? getItensEditadosDoBatch(confirmRevertId) : null;

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
                    aria-label={t("back")}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  {t("details")}
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5" />
                  {t("title")}
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {selected ? t("descDetails") : t("descList")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!selected && (
              <>
                {extratos.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    {t("empty")}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {extratos.map((e) => {
                      const periodo =
                        e.periodoInicio && e.periodoFim
                          ? `${formatDateBR(e.periodoInicio)} – ${formatDateBR(e.periodoFim)}`
                          : t("noPeriod");
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
                                  {e.nomeArquivo ||
                                    t("extratoLabel", { tipo: e.tipoOrigem.toUpperCase() })}
                                </span>
                                <StatusBadge status={e.status} />
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {formatDateBR(e.dataImportacao)} • {periodo} •{" "}
                                {t("movim", { count: e.qtdMovimentacoes })}
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
                      {selected.nomeArquivo ||
                        t("extratoLabel", { tipo: selected.tipoOrigem.toUpperCase() })}
                    </span>
                    <StatusBadge status={selected.status} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("importedOn", { date: formatDateBR(selected.dataImportacao) })}
                    {selected.periodoInicio && selected.periodoFim
                      ? t("periodSuffix", {
                          from: formatDateBR(selected.periodoInicio),
                          to: formatDateBR(selected.periodoFim),
                        })
                      : ""}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
                    <Stat
                      label={t("stats.receitas")}
                      value={formatBRL(selected.totalReceitas)}
                      positive
                    />
                    <Stat
                      label={t("stats.despesas")}
                      value={formatBRL(selected.totalDespesas)}
                      negative
                    />
                    <Stat
                      label={t("stats.transferencias")}
                      value={formatBRL(selected.totalTransferencias)}
                    />
                    <Stat label={t("stats.movim")} value={String(selected.qtdMovimentacoes)} />
                  </div>

                  {editadosDoSelecionado &&
                    editadosDoSelecionado.total > 0 &&
                    selected.status !== "revertido" && (
                      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <Trans
                            i18nKey="editedWarn"
                            ns="extratos-importados"
                            count={editadosDoSelecionado.total}
                            values={{ count: editadosDoSelecionado.total }}
                            components={{ 0: <strong /> }}
                          />
                        </div>
                      </div>
                    )}
                </div>

                <ItemList
                  title={t("lists.despesas")}
                  items={itensDoSelecionado.gastos.map((g) => ({
                    id: g.id,
                    descricao: g.descricao,
                    valor: g.valor,
                    data: g.data,
                  }))}
                  tone="negative"
                />
                <ItemList
                  title={t("lists.receitas")}
                  items={itensDoSelecionado.receitas.map((r) => ({
                    id: r.id,
                    descricao: r.descricao,
                    valor: r.valor,
                    data: r.data,
                  }))}
                  tone="positive"
                />
                <ItemList
                  title={t("lists.transferencias")}
                  items={itensDoSelecionado.transferencias.map((tr) => ({
                    id: tr.id,
                    descricao: tr.descricao,
                    valor: tr.valor,
                    data: tr.data,
                  }))}
                  tone="neutral"
                />
              </div>
            )}
          </div>

          {selected && (
            <div className="border-t px-6 py-4 flex flex-wrap items-center justify-end gap-2 shrink-0">
              {selected.status === "revertido" || selected.status === "parcial" ? (
                <Button
                  variant="outline"
                  onClick={() => setConfirmDeleteId(selected.id)}
                  disabled={working}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("actions.remove")}
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
                  {t("actions.revert")}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRevertId} onOpenChange={(v) => !v && setConfirmRevertId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmRevert.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <Trans
                  i18nKey="confirmRevert.body"
                  ns="extratos-importados"
                  values={{ count: confirmRevertExtrato?.qtdMovimentacoes ?? 0 }}
                  components={{ 0: <strong /> }}
                />
                {confirmRevertEditados && confirmRevertEditados.total > 0 && (
                  <span className="block mt-3 text-amber-600 font-medium">
                    {t("confirmRevert.editedNote", { count: confirmRevertEditados.total })}
                  </span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>{t("confirmRevert.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRevertId) handleRevert(confirmRevertId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? t("confirmRevert.doing") : t("confirmRevert.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(v) => !v && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDelete.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>{t("confirmDelete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteId) handleDelete(confirmDeleteId);
              }}
            >
              {working ? t("confirmDelete.doing") : t("confirmDelete.confirm")}
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
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
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
