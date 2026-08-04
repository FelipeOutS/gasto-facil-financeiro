import { useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRoles } from "@/lib/use-roles";
import { usePlan } from "@/lib/use-plan";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BrandLoader } from "@/components/BrandLoader";
import { fetchOnboarding } from "@/lib/onboarding/service";
import { findPremiumRule, premiumDescription, routeLockI18nKey } from "@/lib/premium-routes";
import { useTranslation } from "react-i18next";
import { planAllowsFeature } from "@/lib/plans";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import {
  isLoginBioBridgeAvailable,
  isLoginBioEnabled,
  isLoginBioInProgress,
  isLoginBioUnlockRequired,
} from "@/lib/biometric-login";

const AUTH_REDIRECT_KEY_PREFIX = "gi:auth-redirect:";

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
  "/app/idioma",
  "/app/mais",
  "/app/perfil",
  "/meu-plano",
  "/conta",
  "/perfil",
  "/admin",
  "/categorias",

  "/manual",
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
  const { t } = useTranslation("common");

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
  const requiresBioUnlock = !!session && pathname !== "/login" && isLoginBioUnlockRequired();

  useEffect(() => {
    if (loading || !requiresBioUnlock) return;
    console.log(
      "[AndroidBiometricLogin] AuthGate aguardando desbloqueio biométrico antes da rota protegida",
    );
    void navigate({ to: "/login", replace: true });
  }, [loading, requiresBioUnlock, navigate]);

  // Bloqueio de acesso por assinatura: usuário logado, sem plano ativo,
  // tentando acessar rota fora da allowlist => manda para /meu-plano.
  useEffect(() => {
    if (loading || !session) return;
    if (plan.loading || rolesLoading) return;
    if (isAdmin) return;
    if (hasActiveAccess) return;
    if (isSubscriptionAllowed(pathname)) return;
    void navigate({ to: "/meu-plano" });
  }, [loading, session, plan.loading, rolesLoading, isAdmin, hasActiveAccess, pathname, navigate]);

  useEffect(() => {
    if (!loading && !session && !redirecting) {
      if (isLoginBioInProgress()) {
        console.log("[AndroidBiometricLogin] AuthGate aguardando restauração da sessão biométrica");
        return;
      }
      if (isLoginBioBridgeAvailable() && isLoginBioEnabled()) {
        console.log("[AndroidBiometricLogin] AuthGate liberando tela de biometria");
      }
      setRedirecting(true);
      try {
        if (pathname !== "/login") {
          window.sessionStorage.setItem(AUTH_REDIRECT_KEY_PREFIX + "after-login", pathname);
        }
      } catch {
        /* ignore */
      }
      void navigate({ to: "/login", replace: true });
    }
  }, [loading, session, redirecting, navigate, pathname]);

  // Redireciona para onboarding na primeira entrada
  useEffect(() => {
    if (loading || !session) return;
    if (onboardingChecked) return;
    const skip = [
      "/onboarding",
      "/login",
      "/cadastro",
      "/recuperar-senha",
      "/reset-password",
      "/confirmar",
    ];
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
    return <BrandLoader />;
  }

  if (requiresBioUnlock) {
    return <BrandLoader message="Validando biometria…" />;
  }

  // Bloqueio: usuário sem plano ativo em rota protegida espera o redirect.
  const subscriptionAllowed = isSubscriptionAllowed(pathname);
  if (!subscriptionAllowed && !plan.loading && !rolesLoading && !hasActiveAccess) {
    return (
      <BrandLoader message="Você precisa de um plano ativo para usar esta página. Redirecionando para Meu plano…" />
    );
  }

  // Bloqueio por feature: tem assinatura ativa, mas o plano não inclui
  // este recurso específico. Não renderiza o conteúdo da rota; mostra o
  // modal padrão de bloqueio premium (mesmo visual de Investimentos).
  if (premiumRule && !plan.loading && !rolesLoading && !featureAllowed) {
    const i18nKey = routeLockI18nKey(premiumRule.feature);
    const lockTitle = i18nKey
      ? t(`premium.routeLocks.${i18nKey}.title`, { defaultValue: premiumRule.title })
      : premiumRule.title;
    const lockDescription = i18nKey
      ? t(`premium.routeLocks.${i18nKey}.description`, {
          defaultValue: premiumDescription(premiumRule),
        })
      : premiumDescription(premiumRule);
    return (
      <>
        <BrandLoader message={lockTitle} className="opacity-70" />
        <PremiumLockModal
          open
          onOpenChange={(v) => {
            if (!v) void navigate({ to: "/meu-plano" });
          }}
          title={lockTitle}
          description={lockDescription}
          feature={premiumRule.feature}
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
    if (!loading && session && !isLoginBioUnlockRequired() && !isLoginBioInProgress()) {
      void navigate({ to: "/app" });
    }
  }, [loading, session, navigate]);

  if (loading) {
    return <BrandLoader message="Só um instante…" />;
  }

  return <>{children}</>;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  background,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Quando informado, substitui o fundo padrão (gradiente + orbs) por um
   * slot customizado renderizado atrás do card. Usado p.ex. pela tela de
   * login para aplicar o fundo estrelado.
   */
  background?: ReactNode;
}) {
  return (
    <div
      className={
        "relative w-full overflow-x-hidden px-4 py-8 sm:px-6 sm:py-12 " +
        (background
          ? "bg-[#05070c]"
          : "bg-background bg-gradient-to-br from-slate-50 via-white to-blue-50/40 dark:from-slate-950 dark:via-background dark:to-slate-900")
      }
      style={{
        minHeight: "100vh",

        ...(typeof CSS !== "undefined" && CSS.supports?.("min-height: 100dvh")
          ? { minHeight: "100dvh" }
          : {}),
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        paddingTop: "max(2rem, env(safe-area-inset-top))",
      }}
    >
      {background ?? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-blue-300/20 blur-3xl dark:bg-blue-500/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-500/10"
          />
        </>
      )}

      <div className="relative mx-auto flex w-full max-w-md flex-col animate-fade-in">
        <Link
          to="/"
          className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para o início
        </Link>

        <div className="rounded-3xl border border-border/60 bg-card/95 px-6 py-8 shadow-xl shadow-slate-900/5 backdrop-blur-sm sm:px-9 sm:py-10 dark:shadow-black/30">
          <Link
            to="/"
            className="mx-auto flex items-center justify-center"
            aria-label="Gasto Inteligente"
          >
            <BrandMark variant="login" className="h-14 w-auto" />
          </Link>

          <div className="mt-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[1.6rem]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>

          <div className="mt-7">{children}</div>

          {footer && (
            <div className="mt-6 border-t border-border/60 pt-5 text-center text-sm">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
