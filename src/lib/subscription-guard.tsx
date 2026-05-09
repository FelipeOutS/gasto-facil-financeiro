/**
 * Guard central de assinatura.
 *
 * Regra: usuários sem assinatura ativa NÃO podem criar/editar/excluir/importar
 * dados financeiros. Admin Master tem sempre acesso total.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/use-plan";
import { isAdminMasterEmail, planAllowsFeature, type FeatureKey } from "@/lib/plans";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import { supabase } from "@/integrations/supabase/client";
import { setStoreCanWrite } from "@/lib/store";
import { getCurrentUserSubscription } from "@/server/subscription.functions";
import { useActiveAccount } from "@/lib/active-account";

/** Status que liberam ações financeiras. */
const ACTIVE_STATUSES = new Set(
  [
    "ativo",
    "active",
    "paid",
    "approved",
    "authorized",
    "trialing",
    "teste",
  ].map((s) => s.toLowerCase()),
);

export function isStatusActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_STATUSES.has(String(status).trim().toLowerCase());
}

/**
 * Verificação no servidor (defensiva contra burla do front).
 * Lê o e-mail do usuário e a linha em user_plans para decidir.
 */
export async function ensureCanWriteFinancialData(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) return { ok: false, reason: "Você precisa estar logado." };

  if (isAdminMasterEmail(user.email)) return { ok: true };
  const subscription = await getCurrentUserSubscription();
  if (!subscription.active || subscription.plan === "free" || subscription.plan === "sem_assinatura") {
    console.info("[ensureCanWriteFinancialData] bloqueado", subscription.debug);
    return { ok: false, reason: "Você precisa de uma assinatura ativa para usar este recurso." };
  }
  return { ok: true };
}

/* ===========================================================
 * Contexto/modal de bloqueio
 * =========================================================== */

type GuardCtx = {
  /** Usuário tem permissão para criar/editar dados financeiros? */
  canWrite: boolean;
  /** Verifica se o plano atual libera uma feature específica. */
  canUseFeature: (feature: FeatureKey) => boolean;
  /** Abre o modal "precisa de assinatura". */
  requireSubscription: (msg?: string) => void;
  /**
   * Wrapper para handlers: se permitido, executa; senão abre modal e bloqueia.
   * Use em onClick / onSubmit / etc.
   */
  guard: <T extends (...args: never[]) => unknown>(fn: T) => T;
};

const Ctx = createContext<GuardCtx | null>(null);

export function SubscriptionGuardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isAdminMaster, status, storedPlan, plan, isTrialActive, loading: planLoading } = usePlan();
  const { hasFullAccess, loading: rolesLoading } = useRoles();
  const { isOwnAccount, canCreate: connCanCreate, canAdmin: connCanAdmin, accessLevel } = useActiveAccount();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isAdmin = isAdminMaster || hasFullAccess;

  const subscriptionAllows = useMemo(() => {
    if (isAdmin) return true;
    if (!user) return false;
    if (planLoading || rolesLoading) return false;
    if (isTrialActive) return true;
    if (storedPlan === "sem_assinatura" || storedPlan === "free") return false;
    return isStatusActive(status);
  }, [isAdmin, user, storedPlan, status, isTrialActive, planLoading, rolesLoading]);

  // Em conta própria: depende só da assinatura.
  // Em conta conectada: depende do nível de acesso (não da assinatura do viewer).
  const canWrite = isOwnAccount ? subscriptionAllows : connCanCreate;

  // Sincroniza a flag central usada pelo store (defesa contra burla do front).
  useEffect(() => {
    setStoreCanWrite(canWrite);
  }, [canWrite]);

  const requireSubscription = useCallback((msg?: string) => {
    if (!isOwnAccount) {
      // Em conta conectada o problema não é assinatura, é permissão.
      const lvlMsg =
        accessLevel === "view"
          ? "Esta conta foi compartilhada com você apenas para visualização."
          : accessLevel === "view_create"
            ? "Você pode visualizar e lançar nesta conta, mas não editar/excluir registros existentes."
            : "Sem permissão suficiente para esta ação.";
      toast.error(lvlMsg);
      return;
    }
    setMessage(msg ?? "Para adicionar gastos, escolha um plano ativo.");
    setOpen(true);
  }, [isOwnAccount, accessLevel]);

  const guard = useCallback(
    <T extends (...args: never[]) => unknown>(fn: T): T => {
      const wrapped = ((...args: Parameters<T>) => {
        if (canWrite) return fn(...args);
        requireSubscription();
        return undefined;
      }) as T;
      return wrapped;
    },
    [canWrite, requireSubscription],
  );

  const canUseFeature = useCallback(
    (feature: FeatureKey) => {
      if (isAdmin) return true;
      if (!canWrite) return false;
      return planAllowsFeature(plan, feature);
    },
    [isAdmin, canWrite, plan],
  );

  return (
    <Ctx.Provider value={{ canWrite, canUseFeature, requireSubscription, guard }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-primary/20 ring-1 ring-primary/20">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center">Assinatura necessária</DialogTitle>
            <DialogDescription className="text-center">
              {message ?? "Para adicionar gastos, escolha um plano ativo."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button asChild className="w-full rounded-2xl">
              <Link to="/meu-plano" onClick={() => setOpen(false)}>
                Ver planos <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="w-full rounded-2xl"
              onClick={() => setOpen(false)}
            >
              Agora não
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useSubscriptionGuard(): GuardCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback seguro para casos isolados (ex: testes). Bloqueia tudo.
    return {
      canWrite: false,
      canUseFeature: () => false,
      requireSubscription: () => {
        toast.error("Você precisa de uma assinatura ativa para usar este recurso.");
      },
      guard: ((fn: unknown) => fn) as GuardCtx["guard"],
    };
  }
  return ctx;
}
