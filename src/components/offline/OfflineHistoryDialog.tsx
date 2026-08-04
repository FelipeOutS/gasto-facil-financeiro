import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function actionIcon(action: OfflineHistoryAction): ReactNode {
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

type Filter = "all" | "expense" | "income" | "failed";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
};

export function OfflineHistoryDialog({ open, onOpenChange, userId }: Props) {
  const [events, setEvents] = useState<OfflineHistoryEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const refresh = useCallback(async () => {
    if (!userId) {
      setEvents([]);
      return;
    }
    const list = await listHistory(userId);
    setEvents(list);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const unsub = subscribeHistory(() => void refresh());
    return unsub;
  }, [open, refresh]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "expense":
        return events.filter((e) => e.type === "expense");
      case "income":
        return events.filter((e) => e.type === "income");
      case "failed":
        return events.filter((e) => e.action === "failed");
      default:
        return events;
    }
  }, [events, filter]);

  async function handleClear() {
    if (!userId) return;
    await clearHistoryForUser(userId);
    toast.success("Histórico limpo.");
    setConfirmOpen(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Histórico offline</DialogTitle>
            <DialogDescription>
              Gastos e receitas criados sem internet, sincronizados, editados, removidos ou com
              falha.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">Todos</TabsTrigger>
              <TabsTrigger value="expense">Gastos</TabsTrigger>
              <TabsTrigger value="income">Receitas</TabsTrigger>
              <TabsTrigger value="failed">Falhas</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {events.length === 0
                  ? "Nenhuma sincronização offline registrada ainda."
                  : "Nenhum evento para este filtro."}
              </p>
            ) : (
              filtered.map((ev) => (
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

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={events.length === 0}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Limpar histórico
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  );
}

/** Botão pronto para usar em listas de Configurações. */
export function OfflineHistoryTrigger({ userId }: { userId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-card active:scale-[0.99]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <History className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Histórico offline</span>
          <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            Consulte gastos e receitas criados sem internet, sincronizados, editados, removidos ou
            com falha.
          </span>
        </span>
      </button>
      <OfflineHistoryDialog open={open} onOpenChange={setOpen} userId={userId} />
    </>
  );
}
