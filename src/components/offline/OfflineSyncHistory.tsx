import { useEffect, useState, useCallback } from "react";
import {
  History,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Pencil,
  CloudOff,
  TrendingUp,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/lib/auth-context";
import {
  listHistory,
  clearHistoryForUser,
  subscribeHistory,
  type OfflineHistoryEvent,
  type OfflineHistoryAction,
} from "@/lib/offline/offline-sync-history";
import { formatBRL } from "@/lib/format";

const ACTION_LABEL: Record<OfflineHistoryAction, string> = {
  created_offline: "Criado offline",
  edited: "Editado",
  synced: "Sincronizado",
  failed: "Falhou",
  removed: "Removido",
};

function actionIcon(action: OfflineHistoryAction) {
  switch (action) {
    case "synced":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    case "removed":
      return <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />;
    case "edited":
      return <Pencil className="h-3.5 w-3.5 text-muted-foreground" />;
    case "created_offline":
    default:
      return <CloudOff className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatDateTime(ts: number) {
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export function OfflineSyncHistory() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [events, setEvents] = useState<OfflineHistoryEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setEvents([]);
      return;
    }
    const list = await listHistory(userId);
    setEvents(list);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const unsub = subscribeHistory(() => void refresh());
    return unsub;
  }, [refresh]);

  async function handleClear() {
    if (!userId) return;
    await clearHistoryForUser(userId);
    toast.success("Histórico limpo.");
    setConfirmOpen(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" />
          <span>Últimas atividades offline</span>
        </div>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            Limpar histórico
          </Button>
        )}
      </div>

      <div className="max-h-[55vh] space-y-2 overflow-y-auto">
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma sincronização offline registrada ainda.
          </p>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {ev.type === "income" ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <CreditCard className="h-3.5 w-3.5" />
                    )}
                    <span>{ev.type === "income" ? "Receita" : "Gasto"}</span>
                    <span>·</span>
                    <span>{formatDateTime(ev.created_at)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="num">{formatBRL(ev.amount)}</span>
                  </p>
                  {ev.error_message && (
                    <p className="mt-1 text-[11px] text-destructive">{ev.error_message}</p>
                  )}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {actionIcon(ev.action)}
                  {ACTION_LABEL[ev.action]}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar histórico offline?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação apaga apenas o registro local de atividades offline. Não afeta gastos ou
              receitas já salvos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear}>Limpar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
