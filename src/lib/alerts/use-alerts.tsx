// Hook central da Central de Alertas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCartoes,
  getCategorias,
  getContasAPagar,
  getGastos,
  getLimites,
  statusContaEfetivo,
  useStore,
} from "@/lib/store";
import { useRecorrencias } from "@/lib/recorrencias";
import { listarContasReceber } from "@/lib/contas-receber";
import { listarAtivos } from "@/lib/investimentos";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { generateAlertDrafts } from "./generator";
import { listAlerts, markAlertStatus, markAllAsRead, sortAlerts, syncDrafts } from "./service";
import type { AlertStatus, UserAlert } from "./types";

export function useAlerts() {
  const { user } = useAuth();
  const plan = usePlan();
  const recorrencias = useRecorrencias();
  const contasAPagar = useStore(() => getContasAPagar());
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const lastSyncRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    try {
      const list = await listAlerts(user.id);
      setAlerts(sortAlerts(list));
    } catch (e) {
      console.warn("[alerts] list error", e);
    }
  }, [user?.id]);

  const sync = useCallback(async () => {
    if (!user?.id) return;
    setSyncing(true);
    try {
      // Coleta dados externos em paralelo (best-effort)
      const [contasReceber, ativos] = await Promise.all([
        listarContasReceber(user.id).catch(() => []),
        listarAtivos(user.id).catch(() => []),
      ]);

      const drafts = generateAlertDrafts({
        gastos: getGastos(),
        categorias: getCategorias(),
        limites: getLimites(),
        contas: contasAPagar,
        cartoes: getCartoes(),
        recorrencias,
        contasReceber,
        investimentos: ativos,
        planoStatus: plan.status,
        trialDaysLeft: plan.trialDaysLeft,
      });

      const list = await syncDrafts(user.id, drafts);
      setAlerts(sortAlerts(list));
      lastSyncRef.current = Date.now();
    } catch (e) {
      console.warn("[alerts] sync error", e);
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [user?.id, recorrencias, plan.status, plan.trialDaysLeft, contasAPagar]);

  useEffect(() => {
    if (!user?.id) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    // primeiro carrega o que já existe (rápido) e em seguida sincroniza
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listAlerts(user.id);
        if (!cancelled) setAlerts(sortAlerts(list));
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) sync();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Re-sync ao trocar de aba/voltar para o app
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && Date.now() - lastSyncRef.current > 60_000) {
        sync();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sync]);

  const setStatus = useCallback(
    async (id: string, status: AlertStatus) => {
      // otimista
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status,
                read_at: status === "read" ? new Date().toISOString() : a.read_at,
                resolved_at: status === "resolved" ? new Date().toISOString() : a.resolved_at,
                ignored_at: status === "ignored" ? new Date().toISOString() : a.ignored_at,
              }
            : a,
        ),
      );
      try {
        await markAlertStatus(id, status);
      } catch (e) {
        console.warn("[alerts] markStatus error", e);
        refresh();
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    setAlerts((prev) => prev.map((a) => (a.status === "unread" ? { ...a, status: "read" } : a)));
    try {
      await markAllAsRead(user.id);
    } catch {
      refresh();
    }
  }, [user?.id, refresh]);

  const remove = useCallback(
    async (id: string) => {
      // Soft-delete: marca como "ignored" para que o syncDrafts respeite
      // a deduplicação (user_id, dedupe_key, period_key) e não recrie o alerta
      // depois do F5. A lista visível esconde alertas ignored/resolved.
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "ignored", ignored_at: new Date().toISOString() } : a,
        ),
      );
      try {
        await markAlertStatus(id, "ignored");
      } catch {
        refresh();
      }
    },
    [refresh],
  );

  /** Lista visível no app (esconde resolved/ignored). */
  const visible = useMemo(() => {
    const contasPagas = new Set(
      contasAPagar.filter((c) => statusContaEfetivo(c) === "pago").map((c) => c.id),
    );
    return alerts.filter((a) => {
      if (a.status === "resolved" || a.status === "ignored") return false;
      if (a.related_entity_type === "conta_a_pagar" && a.related_entity_id) {
        return !contasPagas.has(a.related_entity_id);
      }
      return true;
    });
  }, [alerts, contasAPagar]);

  const unreadCount = useMemo(() => visible.filter((a) => a.status === "unread").length, [visible]);

  const top = useMemo(() => visible.slice(0, 3), [visible]);

  return {
    alerts,
    visible,
    top,
    unreadCount,
    loading,
    syncing,
    setStatus,
    markAllRead,
    remove,
    sync,
    refresh,
  };
}
