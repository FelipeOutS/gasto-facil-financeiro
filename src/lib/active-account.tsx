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
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { setActiveUserId, hydrateUser } from "@/lib/store";
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

  // Carrega lista de conexões aceitas para o usuário logado.
  useEffect(() => {
    if (!viewerId) {
      setConnections([]);
      setActiveOwnerIdState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("connected_accounts")
        .select("owner_user_id,invited_email,nickname,access_level,status")
        .eq("viewer_user_id", viewerId)
        .eq("status", "accepted");

      if (cancelled) return;
      if (error || !data) {
        setConnections([]);
      } else {
        const list: ConnectedAccountAccess[] = data
          .filter((r) => !!r.owner_user_id)
          .map((r) => ({
            ownerId: r.owner_user_id as string,
            email: r.invited_email as string,
            nickname: (r.nickname as string | null) ?? null,
            accessLevel: r.access_level as AccessLevel,
          }));
        setConnections(list);

        // Restaura escolha salva (se ainda for válida) ou volta para a própria
        const stored = readStored(viewerId);
        const valid = stored && list.some((c) => c.ownerId === stored) ? stored : null;
        applySwitch(valid ?? viewerId, false);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  function applySwitch(ownerId: string, persist: boolean) {
    setActiveOwnerIdState(ownerId);
    setActiveUserId(ownerId);
    // Só re-hidrata quando estamos trocando para uma conta CONECTADA
    // (diferente da própria). Se for a conta do próprio usuário, o
    // auth-context já hidratou — chamar hydrateUser aqui zera o status
    // para "loading" e faz todas as páginas piscarem PageSkeleton.
    if (viewerId && ownerId !== viewerId) {
      void hydrateUser(ownerId);
    }
    if (persist && viewerId) writeStored(viewerId, ownerId === viewerId ? null : ownerId);
    // O store já emite/atualiza componentes via subscribe; hydrateUser repovoa caches.
  }

  const switchTo = useCallback(
    async (ownerId: string | null) => {
      if (!viewerId) return;
      const target = ownerId ?? viewerId;
      if (target !== viewerId && !connections.some((c) => c.ownerId === target)) return;
      applySwitch(target, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerId, connections],
  );

  const isOwnAccount = !viewerId || activeOwnerId === viewerId || activeOwnerId === null;
  const activeConnection = useMemo(
    () => (isOwnAccount ? null : (connections.find((c) => c.ownerId === activeOwnerId) ?? null)),
    [isOwnAccount, connections, activeOwnerId],
  );
  const accessLevel: AccessLevel | null = activeConnection?.accessLevel ?? null;

  const canCreate = isOwnAccount || accessLevel === "view_create" || accessLevel === "admin";
  const canAdmin = isOwnAccount || accessLevel === "admin";

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
