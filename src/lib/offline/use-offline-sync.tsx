/**
 * Orquestrador de sincronização da fila offline de gastos.
 *
 * - Escuta o evento `online` e dispara sincronização.
 * - Hook React `useOfflineExpenseQueue(userId)` retorna a lista reativa.
 * - `syncAllForUser(userId)` percorre a fila e tenta enviar cada item.
 */

import { useEffect, useState, useCallback } from "react";
import {
  type OfflineExpense,
  claimForSync,
  listExpenses,
  deleteExpenseSilent,
  subscribe,
  updateExpense,
} from "./offline-expense-queue";
import { addGastoAwait } from "@/lib/store";
import { normalizeOfflineError } from "./offline-error-messages";
import { recordHistoryEvent } from "./offline-sync-history";

let syncing = false;

export async function syncAllForUser(userId: string): Promise<{
  synced: number;
  failed: number;
}> {
  if (syncing || !userId) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await listExpenses(userId);
    for (const item of items) {
      if (item.status === "synced") continue;
      const claimed = await claimForSync(item.local_id);
      if (!claimed) continue;
      try {
        const res = await addGastoAwait(item.input, userId, item.local_id);
        if (res.ok) {
          // Remove tanto em sucesso quanto em duplicate (idempotente).
          await deleteExpenseSilent(item.local_id);
          synced += 1;
          void recordHistoryEvent({
            user_id: userId,
            type: "expense",
            action: "synced",
            title: item.descricao,
            amount: item.valor,
          });
        } else {
          const norm = normalizeOfflineError(res.error ?? "Falha ao sincronizar");
          await updateExpense(item.local_id, {
            status: "failed",
            attempts: item.attempts + 1,
            error_message: norm.friendly,
            technical_error: norm.technical,
          });
          failed += 1;
          void recordHistoryEvent({
            user_id: userId,
            type: "expense",
            action: "failed",
            title: item.descricao,
            amount: item.valor,
            error_message: norm.friendly,
            technical_error: norm.technical,
          });
        }
      } catch (err) {
        const norm = normalizeOfflineError(err);
        await updateExpense(item.local_id, {
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

/**
 * Hook que mantém a fila offline do usuário ativa em estado reativo
 * e dispara sincronização quando a conexão volta.
 */
export function useOfflineExpenseQueue(userId: string | null | undefined) {
  const [items, setItems] = useState<OfflineExpense[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const list = await listExpenses(userId);
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
      void syncAllForUser(userId).then(() => void refresh());
    };
    window.addEventListener("online", onOnline);
    // Tentativa inicial: se já estamos online ao montar e houver pendências,
    // tentar sincronizar uma vez.
    if (navigator.onLine !== false) {
      void syncAllForUser(userId).then(() => void refresh());
    }
    return () => window.removeEventListener("online", onOnline);
  }, [userId, refresh]);

  const syncNow = useCallback(async () => {
    if (!userId) return { synced: 0, failed: 0 };
    const res = await syncAllForUser(userId);
    await refresh();
    return res;
  }, [userId, refresh]);

  return { items, pending: items.length, syncNow, refresh };
}
