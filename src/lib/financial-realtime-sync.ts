import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  financialSessionGuard,
  refreshFinancialCore,
  refreshGastos,
  refreshReceitas,
} from "./store";

type Entity = "gastos" | "receitas";
const DEBOUNCE_MS = 350;

/** Uma instância por sessão/conta, pertencente ao ActiveAccountProvider. */
export function startFinancialRealtimeSync(actorId: string, ownerId: string): () => void {
  const isCurrent = financialSessionGuard(ownerId);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<Entity>();
  let channel: ReturnType<typeof supabase.channel> | undefined;
  const active = () => !stopped && isCurrent();
  const visible = () => document.visibilityState !== "hidden";
  const arm = () => {
    if (!active() || running || timer || !visible() || navigator.onLine === false) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, DEBOUNCE_MS);
  };
  const schedule = (...entities: Entity[]) => {
    if (!active()) return;
    entities.forEach((entity) => pending.add(entity));
    arm();
  };
  async function flush() {
    if (!active() || !visible() || navigator.onLine === false || running) return;
    const expenses = pending.delete("gastos");
    const incomes = pending.delete("receitas");
    running = true;
    try {
      if (expenses && incomes) await refreshFinancialCore({ afterPending: true });
      else if (expenses) await refreshGastos({ afterPending: true });
      else if (incomes) await refreshReceitas({ afterPending: true });
    } finally {
      running = false;
      // Eventos recebidos durante o SELECT exigem uma leitura posterior, não são perdidos.
      if (pending.size) arm();
    }
  }
  const foreground = () => {
    if (visible()) schedule("gastos", "receitas");
  };
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("focus", foreground);
  window.addEventListener("pageshow", foreground);
  window.addEventListener("online", foreground);
  try {
    channel = supabase.channel(`financial:${actorId}:${ownerId}`);
    for (const table of ["gastos", "receitas"] as const) {
      for (const event of ["INSERT", "UPDATE"] as const) {
        channel.on(
          "postgres_changes",
          {
            event,
            schema: "public",
            table,
            filter: `user_id=eq.${ownerId}`,
          },
          () => schedule(table),
        );
      }
    }
    channel.subscribe((status) => {
      // Reconsulta também ao reconectar, cobrindo a janela sem websocket.
      if (status === "SUBSCRIBED") foreground();
    });
  } catch {
    // Realtime indisponível não desativa os listeners de recuperação.
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    pending.clear();
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("focus", foreground);
    window.removeEventListener("pageshow", foreground);
    window.removeEventListener("online", foreground);
    if (channel) void supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function useFinancialRealtimeSync(actorId: string | null, ownerId: string | null) {
  useEffect(() => {
    if (!actorId || !ownerId) return;
    return startFinancialRealtimeSync(actorId, ownerId);
  }, [actorId, ownerId]);
}
