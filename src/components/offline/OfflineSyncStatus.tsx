import { useState } from "react";
import { CloudOff, RefreshCw, Trash2, AlertCircle } from "lucide-react";
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
import { removeExpense } from "@/lib/offline/offline-expense-queue";
import { formatBRL } from "@/lib/format";

export function OfflineSyncStatus({ className }: { className?: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { items, pending, syncNow } = useOfflineExpenseQueue(userId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma pendência.
              </p>
            ) : (
              items.map((it) => (
                <div
                  key={it.local_id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.data} · <span className="num">{formatBRL(it.valor)}</span>
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide">
                      {it.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3 w-3" /> falhou
                        </span>
                      ) : it.status === "syncing" ? (
                        <span className="text-muted-foreground">enviando…</span>
                      ) : (
                        <span className="text-muted-foreground">pendente</span>
                      )}
                    </p>
                    {it.error_message && (
                      <p className="mt-1 text-[11px] text-destructive">{it.error_message}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemove(it.local_id)}
                    aria-label="Remover pendência"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
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
    </>
  );
}
