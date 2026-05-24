/**
 * Orquestrador de sincronização da fila offline de receitas.
 */

import { useEffect, useState, useCallback } from "react";
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

let syncing = false;

export async function syncAllIncomesForUser(userId: string): Promise<{
  synced: number;
  failed: number;
}> {
  if (syncing || !userId) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await listIncomes(userId);
    for (const item of items) {
      if (item.status === "synced") continue;
      const claimed = await claimForSync(item.local_id);
      if (!claimed) continue;
      try {
        const res = await addReceitaAwait(item.input, userId, item.local_id);
        if (res.ok) {
          await removeIncome(item.local_id);
          synced += 1;
        } else {
          const norm = normalizeOfflineError(res.error ?? "Falha ao sincronizar");
          await updateIncome(item.local_id, {
            status: "failed",
            attempts: item.attempts + 1,
            error_message: norm.friendly,
            technical_error: norm.technical,
          });
          failed += 1;
        }
      } catch (err) {
        const norm = normalizeOfflineError(err);
        await updateIncome(item.local_id, {
          status: "failed",
          attempts: item.attempts + 1,
          error_message: norm.friendly,
          technical_error: norm.technical,
        });
        failed += 1;
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

export function useOfflineIncomeQueue(userId: string | null | undefined) {
  const [items, setItems] = useState<OfflineIncome[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const list = await listIncomes(userId);
    setItems(list);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const unsub = subscribe(() => {
      void refresh();
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const onOnline = () => {
      void syncAllIncomesForUser(userId).then(() => void refresh());
    };
    window.addEventListener("online", onOnline);
    if (navigator.onLine !== false) {
      void syncAllIncomesForUser(userId).then(() => void refresh());
    }
    return () => window.removeEventListener("online", onOnline);
  }, [userId, refresh]);

  const syncNow = useCallback(async () => {
    if (!userId) return { synced: 0, failed: 0 };
    const res = await syncAllIncomesForUser(userId);
    await refresh();
    return res;
  }, [userId, refresh]);

  return { items, pending: items.length, syncNow, refresh };
}
