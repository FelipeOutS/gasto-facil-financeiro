import { useEffect, useState, useCallback, useRef } from "react";
import {
  type OfflineIncome,
  claimForSync,
  listIncomes,
  deleteIncomeSilent,
  subscribe,
  updateIncome,
} from "./offline-income-queue";
import { addReceitaAwait } from "@/lib/store";
import { normalizeOfflineError } from "./offline-error-messages";
import { recordHistoryEvent } from "./offline-sync-history";
import { withSyncAttempt } from "./sync-attempt";

const running = new Map<string, Promise<{ synced: number; failed: number }>>();
/** actorId is the authenticated creator, never the currently displayed owner. */
export function syncAllIncomesForUser(
  actorId: string,
): Promise<{ synced: number; failed: number }> {
  if (!actorId || (typeof navigator !== "undefined" && navigator.onLine === false))
    return Promise.resolve({ synced: 0, failed: 0 });
  const existing = running.get(actorId);
  if (existing) return existing;
  const task = (async () => {
    let synced = 0,
      failed = 0;
    for (const candidate of await listIncomes(actorId, actorId, true)) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      try {
        await withSyncAttempt("gf:income:" + candidate.local_id, async (signal) => {
          const item = await claimForSync(candidate.local_id, candidate.user_id, actorId);
          if (!item || signal.aborted) return;
          try {
            const result = await addReceitaAwait(
              item.input,
              item.user_id,
              item.local_id,
              actorId,
              signal,
            );
            if (signal.aborted) return; // leave the lease recoverable after a timeout
            if (!result.ok) throw new Error(result.error || "Falha ao sincronizar");
            await deleteIncomeSilent(item.local_id, item.user_id, item.attempts, actorId);
            synced++;
            void recordHistoryEvent({
              user_id: item.user_id,
              type: "income",
              action: "synced",
              title: item.descricao,
              amount: item.valor,
            });
          } catch (error) {
            if (signal.aborted) return;
            const norm = normalizeOfflineError(error);
            await updateIncome(
              item.local_id,
              { status: "failed", error_message: norm.friendly, technical_error: norm.technical },
              item.user_id,
              item.attempts,
              actorId,
            );
            failed++;
            void recordHistoryEvent({
              user_id: item.user_id,
              type: "income",
              action: "failed",
              title: item.descricao,
              amount: item.valor,
              error_message: norm.friendly,
              technical_error: norm.technical,
            });
          }
        });
      } catch {
        failed++;
      } // timeout/IDB failure preserves the item
    }
    return { synced, failed };
  })().finally(() => running.delete(actorId));
  running.set(actorId, task);
  return task;
}

export function useOfflineIncomeQueue(ownerId: string | null | undefined, actorId = ownerId) {
  const [items, setItems] = useState<OfflineIncome[]>([]);
  const identity = ownerId + ":" + actorId;
  const current = useRef(identity);
  const readRevision = useRef(0);
  if (current.current !== identity) {
    current.current = identity;
    readRevision.current++;
  }
  const refresh = useCallback(async () => {
    const request = ++readRevision.current;
    if (!ownerId || !actorId) {
      setItems([]);
      return;
    }
    const list = await listIncomes(ownerId, actorId);
    if (current.current === identity && request === readRevision.current) setItems(list);
  }, [ownerId, actorId, identity]);
  useEffect(() => {
    void refresh().catch(() => undefined);
    return subscribe(() => {
      void refresh().catch(() => undefined);
    });
  }, [refresh]);
  useEffect(() => {
    if (!actorId || typeof window === "undefined") return;
    const trigger = () => {
      void syncAllIncomesForUser(actorId)
        .then(refresh)
        .catch(() => undefined);
    };
    trigger();
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    const timer = window.setInterval(trigger, 30000);
    return () => {
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      window.clearInterval(timer);
    };
  }, [actorId, refresh]);
  const syncNow = useCallback(async () => {
    if (!actorId) return { synced: 0, failed: 0 };
    const result = await syncAllIncomesForUser(actorId);
    await refresh();
    return result;
  }, [actorId, refresh]);
  const visible = items.filter(
    (item) => item.user_id === ownerId && (item.actor_id ?? item.user_id) === actorId,
  );
  return { items: visible, pending: visible.length, syncNow, refresh };
}
