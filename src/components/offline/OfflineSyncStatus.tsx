import { useState } from "react";
import { CloudOff, RefreshCw, Trash2, AlertCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import { useOfflineExpenseQueue } from "@/lib/offline/use-offline-sync";
import { removeExpense, type OfflineExpense } from "@/lib/offline/offline-expense-queue";
import { formatBRL } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditOfflineExpenseDialog } from "./EditOfflineExpenseDialog";
import { OfflineSyncHistory } from "./OfflineSyncHistory";

export function OfflineSyncStatus({ className }: { className?: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { items, pending, syncNow } = useOfflineExpenseQueue(userId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<OfflineExpense | null>(null);

  if (!userId || pending === 0) return null;

  async function handleSync() {
    setBusy(true);
    try {
      const res = await syncNow();
      if (res.synced > 0) {
        toast.success(`${res.synced} gasto(s) sincronizado(s).`);
      }
      if (res.failed > 0) {
        toast.error(`${res.failed} gasto(s) ainda pendente(s).`);
      }
      if (res.synced === 0 && res.failed === 0) {
        toast("Nenhum gasto para sincronizar agora.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(localId: string) {
    await removeExpense(localId);
    toast.success("Pendência removida.");
  }

  function handleEdit(it: OfflineExpense) {
    if (it.status === "syncing") {
      toast.error("Este gasto está sincronizando. Aguarde finalizar.");
      return;
    }
    setEditing(it);
  }

  return (
    <>
      <div
        className={
          "flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground " +
          (className ?? "")
        }
      >
        <div className="flex items-center gap-2">
          <CloudOff className="h-4 w-4" />
          <span>
            {pending} gasto{pending > 1 ? "s" : ""} aguardando sincronização
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSync}
            disabled={busy}
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={"mr-1 h-3 w-3 " + (busy ? "animate-spin" : "")} />
            Sincronizar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(true)}
            className="h-7 px-2 text-xs"
          >
            Ver
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gastos pendentes</DialogTitle>
            <DialogDescription>
              Estes gastos foram salvos offline e serão enviados quando a internet voltar.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="pending" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pending">Pendências</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="pending">
              <div className="max-h-[55vh] space-y-2 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhuma pendência.
                  </p>
                ) : (
                  items.map((it) => {
                    const isSyncing = it.status === "syncing";
                    const canEdit = it.status === "pending" || it.status === "failed";
                    return (
                      <div
                        key={it.local_id}
                        className="rounded-xl border border-border bg-card p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{it.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {it.data} · <span className="num">{formatBRL(it.valor)}</span>
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-wide">
                            {it.status === "failed" ? (
                              <span className="inline-flex items-center gap-1 text-destructive">
                                <AlertCircle className="h-3 w-3" /> falhou
                              </span>
                            ) : isSyncing ? (
                              <span className="text-muted-foreground">enviando…</span>
                            ) : (
                              <span className="text-muted-foreground">pendente</span>
                            )}
                          </p>
                          {it.error_message && (
                            <p className="mt-1 text-[11px] text-destructive">{it.error_message}</p>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canEdit}
                            onClick={() => handleEdit(it)}
                            className="h-7 px-2 text-xs"
                          >
                            <Pencil className="mr-1 h-3 w-3" /> Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isSyncing || busy}
                            onClick={handleSync}
                            className="h-7 px-2 text-xs"
                          >
                            <RefreshCw className={"mr-1 h-3 w-3 " + (busy ? "animate-spin" : "")} />
                            Sincronizar agora
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isSyncing}
                            onClick={() => handleRemove(it.local_id)}
                            aria-label="Remover pendência"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="mr-1 h-3 w-3" /> Remover
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </TabsContent>
            <TabsContent value="history">
              <OfflineSyncHistory />
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button onClick={handleSync} disabled={busy}>
              <RefreshCw className={"mr-2 h-4 w-4 " + (busy ? "animate-spin" : "")} />
              Sincronizar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditOfflineExpenseDialog
        item={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </>
  );
}
