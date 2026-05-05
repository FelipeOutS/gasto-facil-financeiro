import { useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import { usePlan } from "@/lib/use-plan";
import { Wallet } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { fetchOnboarding } from "@/lib/onboarding/service";
import { findPremiumRule, premiumDescription } from "@/lib/premium-routes";
import { planAllowsFeature } from "@/lib/plans";
import { PremiumLockModal } from "@/components/PremiumLockModal";

/**
 * Rotas que NÃO exigem assinatura ativa.
 * Tudo o que não estiver aqui só carrega para usuários com plano ativo
 * (ou Admin Master).
 */
const SUBSCRIPTION_ALLOWLIST = new Set<string>([
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/reset-password",
  "/confirmar",
  "/onboarding",
  "/meu-plano",
  "/conta",
  "/perfil",
  "/admin",
]);

function isSubscriptionAllowed(pathname: string) {
  // Dashboard ("/") é acessível em modo limitado para usuários sem plano:
  // a página renderiza, mas as ações financeiras ficam bloqueadas via
  // SubscriptionGuard / canWrite e abrem o modal premium ao serem usadas.
  if (pathname === "/") return true;
  if (SUBSCRIPTION_ALLOWLIST.has(pathname)) return true;
  // Aceita /meu-plano/checkout, /admin/qualquer-coisa, etc.
  for (const p of SUBSCRIPTION_ALLOWLIST) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  // Garante carregamento de roles e auto-claim do primeiro owner
  // assim que o usuário entra em qualquer rota protegida.
  const { hasFullAccess, loading: rolesLoading } = useRoles();
  const plan = usePlan();
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isAdmin = plan.isAdminMaster || hasFullAccess;
  const hasActiveAccess =
    isAdmin ||
    plan.status === "ativo" ||
    plan.status === "teste" ||
    (plan.status === "cancelado" && !!plan.accessUntil);

  const premiumRule = findPremiumRule(pathname);
  const featureAllowed = premiumRule
    ? isAdmin || (hasActiveAccess && planAllowsFeature(plan.plan, premiumRule.feature))
    : true;

  // Bloqueio de acesso por assinatura: usuário logado, sem plano ativo,
  // tentando acessar rota fora da allowlist => manda para /meu-plano.
  useEffect(() => {
    if (loading || !session) return;
    if (plan.loading || rolesLoading) return;
    if (isAdmin) return;
    if (hasActiveAccess) return;
    if (isSubscriptionAllowed(pathname)) return;
    void navigate({ to: "/meu-plano" });
  }, [
    loading,
    session,
    plan.loading,
    rolesLoading,
    isAdmin,
    hasActiveAccess,
    pathname,
    navigate,
  ]);

  useEffect(() => {
    if (!loading && !session && !redirecting) {
      setRedirecting(true);
      void navigate({ to: "/login" });
    }
  }, [loading, session, redirecting, navigate]);

  // Redireciona para onboarding na primeira entrada
  useEffect(() => {
    if (loading || !session) return;
    if (onboardingChecked) return;
    const skip = ["/onboarding", "/login", "/cadastro", "/recuperar-senha", "/reset-password", "/confirmar"];
    if (skip.includes(pathname)) {
      setOnboardingChecked(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ob = await fetchOnboarding(session.user.id);
        if (cancelled) return;
        if (!ob.onboarding_completed) {
          void navigate({ to: "/onboarding" });
        }
      } finally {
        if (!cancelled) setOnboardingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, session, pathname, navigate, onboardingChecked]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card animate-pop">
            <Wallet className="h-6 w-6 text-foreground" />
          </span>
          <p className="text-sm text-muted-foreground">Preparando tudo…</p>
        </div>
      </div>
    );
  }

  // Bloqueio: usuário sem plano ativo em rota protegida espera o redirect.
  const subscriptionAllowed = isSubscriptionAllowed(pathname);
  if (!subscriptionAllowed && !plan.loading && !rolesLoading && !hasActiveAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center animate-fade-in">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-card">
            <Wallet className="h-6 w-6 text-foreground" />
          </span>
          <p className="text-sm text-muted-foreground">
            Você precisa de um plano ativo para usar esta página. Redirecionando para Meu plano…
          </p>
        </div>
      </div>
    );
  }

  // Bloqueio por feature: tem assinatura ativa, mas o plano não inclui
  // este recurso específico. Não renderiza o conteúdo da rota; mostra o
  // modal padrão de bloqueio premium (mesmo visual de Investimentos).
  if (premiumRule && !plan.loading && !rolesLoading && !featureAllowed) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="max-w-sm text-center animate-fade-in opacity-70">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-card">
              <Wallet className="h-6 w-6 text-foreground" />
            </span>
            <p className="text-sm text-muted-foreground">
              {premiumRule.title}
            </p>
          </div>
        </div>
        <PremiumLockModal
          open
          onOpenChange={(v) => {
            if (!v) void navigate({ to: "/meu-plano" });
          }}
          title={premiumRule.title}
          description={premiumDescription(premiumRule)}
          showContinue={false}
        />
      </>
    );
  }

  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: "/" });
    }
  }, [loading, session, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground animate-fade-in">Só um instante…</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-col animate-fade-in">
        <Link to="/" className="mx-auto flex items-center justify-center" aria-label="Gasto Inteligente">
          <BrandMark className="h-16 w-auto" />
        </Link>

        <div className="mt-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        <div className="mt-6">{children}</div>

        {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
