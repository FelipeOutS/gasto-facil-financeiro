/**
 * Provider de "conta ativa" — permite ao usuário trocar entre a própria conta
 * e contas conectadas (com convite aceito) que ele tem permissão para
 * acompanhar.
 *
 * Como funciona:
 * - Lê em `connected_accounts` todas as conexões ACEITAS onde
 *   viewer_user_id = usuário atual.
 * - Mantém `activeOwnerId` (id do dono da conta sendo visualizada).
 * - Quando muda, chama `setActiveUserId` no store + invalida o react-query
 *   para que TODAS as telas recarreguem com os dados da conta selecionada.
 * - Persiste a escolha em `localStorage` por usuário.
 *
 * As políticas de RLS no banco já garantem que o viewer só consegue ler/criar
 * o que o nível de acesso permite. O front usa `accessLevel` para esconder
 * botões e mostrar avisos amigáveis.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  setActiveUserId,
  hydrateUser,
  getHydrationStatus,
  migrateLegacyDataToUser,
} from "@/lib/store";
import type { AccessLevel } from "@/lib/connected-accounts";

export type ConnectedAccountAccess = {
  ownerId: string;
  email: string;
  nickname: string | null;
  accessLevel: AccessLevel;
};

type Ctx = {
  /** UUID da conta sendo exibida (a do dono cujos dados estão à vista). */
  activeOwnerId: string | null;
  /** True quando exibindo a própria conta do usuário logado. */
  isOwnAccount: boolean;
  /** Nível de acesso na conta ativa (null se for a própria conta). */
  accessLevel: AccessLevel | null;
  /** Lista de contas conectadas aceitas (sem incluir a própria). */
  connections: ConnectedAccountAccess[];
  /** Detalhes da conta ativa quando não for a própria. */
  activeConnection: ConnectedAccountAccess | null;
  /** Troca para uma conta conectada (ou volta para a própria com `null`). */
  switchTo: (ownerId: string | null) => Promise<void>;
  loading: boolean;
  /** Pode criar registros (próprio dono OU view_create OU admin). */
  canCreate: boolean;
  /** Pode editar/excluir registros (próprio dono OU admin). */
  canAdmin: boolean;
};

const ActiveAccountCtx = createContext<Ctx | null>(null);

const STORAGE_PREFIX = "gf:active-account:";

function readStored(viewerId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_PREFIX + viewerId);
  } catch {
    return null;
  }
}

function writeStored(viewerId: string, ownerId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (ownerId && ownerId !== viewerId) {
      localStorage.setItem(STORAGE_PREFIX + viewerId, ownerId);
    } else {
      localStorage.removeItem(STORAGE_PREFIX + viewerId);
    }
  } catch {
    /* ignore */
  }
}

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;

  const [connections, setConnections] = useState<ConnectedAccountAccess[]>([]);
  const [activeOwnerId, setActiveOwnerIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const revision = useRef(0);
  const applySwitch = useCallback(
    async (ownerId: string, persist: boolean) => {
      const request = ++revision.current;
      setActiveOwnerIdState(ownerId);
      setActiveUserId(ownerId);
      setLoading(true);
      if (persist && viewerId) writeStored(viewerId, ownerId);
      try {
        await hydrateUser(ownerId);
      } finally {
        if (revision.current === request) setLoading(false);
      }
    },
    [viewerId],
  );

  useEffect(() => {
    let cancelled = false;
    const initialization = ++revision.current;
    setConnections([]);
    setActiveOwnerIdState(null);
    setActiveUserId(null);
    if (!viewerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    void (async () => {
      let list: ConnectedAccountAccess[] = [];
      try {
        const { data, error } = await supabase
          .from("connected_accounts")
          .select("owner_user_id,invited_email,nickname,access_level,status")
          .eq("viewer_user_id", viewerId)
          .eq("status", "accepted")
          .abortSignal(controller.signal);
        if (!error && data)
          list = data
            .filter((r) => !!r.owner_user_id)
            .map((r) => ({
              ownerId: r.owner_user_id!,
              email: r.invited_email,
              nickname: r.nickname ?? null,
              accessLevel: r.access_level as AccessLevel,
            }));
      } catch {
        /* use own account if connections cannot be loaded */
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
      setConnections(list);
      const stored = readStored(viewerId);
      const target = stored && list.some((c) => c.ownerId === stored) ? stored : viewerId;
      // Legacy import belongs only to the authenticated owner, never a connected account.
      let migrationTimer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          migrateLegacyDataToUser(viewerId),
          new Promise<void>((resolve) => {
            migrationTimer = setTimeout(resolve, 10000);
          }),
        ]);
      } finally {
        clearTimeout(migrationTimer!);
      }
      if (!cancelled && revision.current === initialization) await applySwitch(target, false);
    })().catch(() => {
      if (!cancelled && revision.current === initialization) void applySwitch(viewerId, false);
    });
    return () => {
      cancelled = true;
      ++revision.current;
      controller.abort();
      clearTimeout(timer);
    };
  }, [viewerId, applySwitch]);

  const switchTo = useCallback(
    async (ownerId: string | null) => {
      if (!viewerId) return;
      const target = ownerId ?? viewerId;
      if (target !== viewerId && !connections.some((c) => c.ownerId === target)) return;
      await applySwitch(target, true);
    },
    [viewerId, connections, applySwitch],
  );

  useEffect(() => {
    if (!activeOwnerId) return;
    const retry = () => {
      if (navigator.onLine !== false && getHydrationStatus() === "error")
        void applySwitch(activeOwnerId, false);
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    const timer = window.setInterval(retry, 30000);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      window.clearInterval(timer);
    };
  }, [activeOwnerId, applySwitch]);

  const isOwnAccount = !viewerId || activeOwnerId === viewerId || activeOwnerId === null;
  const activeConnection = useMemo(
    () => (isOwnAccount ? null : (connections.find((c) => c.ownerId === activeOwnerId) ?? null)),
    [isOwnAccount, connections, activeOwnerId],
  );
  const accessLevel: AccessLevel | null = activeConnection?.accessLevel ?? null;

  const canCreate =
    !!viewerId &&
    !!activeOwnerId &&
    !loading &&
    (isOwnAccount || accessLevel === "view_create" || accessLevel === "admin");
  const canAdmin =
    !!viewerId && !!activeOwnerId && !loading && (isOwnAccount || accessLevel === "admin");

  const value: Ctx = {
    activeOwnerId,
    isOwnAccount,
    accessLevel,
    connections,
    activeConnection,
    switchTo,
    loading,
    canCreate,
    canAdmin,
  };

  return <ActiveAccountCtx.Provider value={value}>{children}</ActiveAccountCtx.Provider>;
}

export function useActiveAccount(): Ctx {
  const ctx = useContext(ActiveAccountCtx);
  if (!ctx) {
    return {
      activeOwnerId: null,
      isOwnAccount: true,
      accessLevel: null,
      connections: [],
      activeConnection: null,
      switchTo: async () => undefined,
      loading: false,
      canCreate: true,
      canAdmin: true,
    };
  }
  return ctx;
}

/** Atalho: o id que deve ser usado em queries Supabase (= dono ativo). */
export function useActiveOwnerId(): string | null {
  return useActiveAccount().activeOwnerId;
}
