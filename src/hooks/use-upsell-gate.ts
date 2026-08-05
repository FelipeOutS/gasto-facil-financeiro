import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUpsellStatus, markUpsellShown, recordUpsellActivity } from "@/lib/upsell.functions";

/** Rotas de jornada crítica: nenhuma comunicação automática pode aparecer. */
export const CRITICAL_ROUTE_PATTERNS: RegExp[] = [
  /^\/(login|cadastro|confirmar|recuperar-senha)/,
  /^\/onboarding/,
  /^\/adicionar/,
  /^\/gastos\/.+\/editar/,
  /^\/renda/,
  /^\/receitas\/.+\/editar/,
  /^\/import/,
  /^\/exportar/,
  /^\/checkout/,
  /^\/meu-plano/,
  /^\/pagamento/,
  /^\/mercado-pago/,
  /^\/admin/,
  /\/nova?$/,
  /\/novo$/,
  /\/editar$/,
];

export function isCriticalPath(pathname: string): boolean {
  return CRITICAL_ROUTE_PATTERNS.some((re) => re.test(pathname));
}

const SESSION_KEY = "upsell_message_shown";

export function sessionMessageAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSessionMessageShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* storage é apenas otimização de sessão; a verdade está no banco */
  }
}

/** Registra a sessão autenticada uma única vez por aba (server-side). */
export function useUpsellActivityTracker() {
  const record = useServerFn(recordUpsellActivity);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    try {
      if (sessionStorage.getItem("upsell_session_recorded") === "1") return;
      sessionStorage.setItem("upsell_session_recorded", "1");
    } catch {
      /* ignore */
    }
    void record({}).catch(() => {});
  }, [record]);
}

interface GateOptions {
  channel: "banner" | "modal";
  /** Modal crítico aberto na tela, formulário em edição, etc. */
  blocked?: boolean;
  delayMs?: number;
}

/**
 * SERVIDOR CONFIRMA ELEGIBILIDADE → TELA NÃO CRÍTICA →
 * NENHUMA OUTRA MENSAGEM NA SESSÃO → AGUARDA 5s → EXIBE.
 * O timer é cancelado a qualquer mudança de rota, bloqueio, offline ou perda de elegibilidade.
 */
export function useUpsellGate({ channel, blocked = false, delayMs = 5000 }: GateOptions) {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getUpsellStatus);
  const markShown = useServerFn(markUpsellShown);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [visible, setVisible] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const { data: status, isLoading } = useQuery({
    queryKey: ["upsell-status"],
    queryFn: () => fetchStatus(),
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const serverAllows = !isLoading && status?.eligible === true && status?.channel === channel;

  useEffect(() => {
    if (!serverAllows || blocked || !online || isCriticalPath(pathname)) {
      setVisible(false);
      return;
    }
    if (sessionMessageAlreadyShown()) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      if (sessionMessageAlreadyShown()) return;
      markSessionMessageShown();
      setVisible(true);
      void markShown({ data: { type: channel } }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["upsell-status"] });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [serverAllows, blocked, online, pathname, channel, delayMs, markShown, queryClient]);

  return { visible, hide: () => setVisible(false), status };
}
