import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  Fingerprint,
  Home,
  Languages,
  Lock,
  LogOut,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { disableAppLock, enableAppLock, useAppLock } from "@/lib/app-lock";

import {
  clearLoginBio,
  enableLoginBio,
  isLoginBioBridgeAvailable,
  isLoginBioEnabled,
} from "@/lib/biometric-login";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { UserAvatar } from "@/components/UserAvatar";
import { NAV_GROUPS, type NavLeaf } from "@/lib/nav-groups";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { PLAN_LABEL } from "@/lib/plans";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { OfflineHistoryTrigger } from "@/components/offline/OfflineHistoryDialog";
import { cn } from "@/lib/utils";

const ROUTE_RULE = Object.fromEntries(PREMIUM_ROUTE_RULES.map((r) => [r.path, r]));

export const Route = createFileRoute("/app_/mais")({
  head: () => ({ meta: [{ title: "Mais opções — Gasto Inteligente" }] }),
  component: AppMaisPage,
});

const PERSONAL_ITEMS: NavLeaf[] = [
  { to: "/app/perfil", labelKey: "perfilMobile", descKey: "perfilMobile", icon: UserRound },
  { to: "/app/idioma", labelKey: "idioma", descKey: "idioma", icon: Languages },
];

function AppMaisPage() {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const { plan, can, isTrialActive, trialDaysLeft, isAdminMaster } = usePlan();
  const [signingOut, setSigningOut] = useState(false);
  const appLock = useAppLock();
  const [togglingLock, setTogglingLock] = useState(false);
  const [loginBioAvailable, setLoginBioAvailable] = useState(false);
  const [loginBioEnabled, setLoginBioEnabled] = useState(false);
  const [togglingLoginBio, setTogglingLoginBio] = useState(false);

  useEffect(() => {
    setLoginBioAvailable(isLoginBioBridgeAvailable());
    setLoginBioEnabled(isLoginBioEnabled());
  }, []);

  async function handleToggleLoginBio() {
    if (togglingLoginBio) return;
    setTogglingLoginBio(true);
    try {
      if (loginBioEnabled) {
        clearLoginBio();
        setLoginBioEnabled(false);
        toast.success("Entrada por biometria desativada neste dispositivo.");
      } else {
        await enableLoginBio(user?.email ?? "");
        setLoginBioEnabled(true);
        toast.success("Entrada por biometria ativada neste dispositivo.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a biometria.");
    } finally {
      setTogglingLoginBio(false);
    }
  }

  async function handleToggleAppLock() {
    if (togglingLock) return;
    setTogglingLock(true);
    try {
      if (appLock.enabled) {
        disableAppLock();
        appLock.refreshEnabled();
        toast.success("Biometria do app desativada neste dispositivo.");
      } else {
        await enableAppLock();
        appLock.refreshEnabled();
        toast.success("Biometria do app ativada neste dispositivo.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a biometria.");
    } finally {
      setTogglingLock(false);
    }
  }

  const groups = useMemo(
    () => NAV_GROUPS.filter((g) => !g.adminMasterOnly || isAdminMaster),
    [isAdminMaster],
  );

  const displayName =
    profile?.nome ||
    profile?.responsavel_nome ||
    profile?.nome_fantasia ||
    user?.email?.split("@")[0] ||
    t("header.fallbackUser");

  function getRule(item: NavLeaf) {
    return (
      ROUTE_RULE[item.to] ??
      (item.feature
        ? {
            feature: item.feature,
            title: `${t(`items.${item.labelKey}`)} ${t("more.premiumSuffix")}`,
            path: item.to,
          }
        : null)
    );
  }

  function isLocked(item: NavLeaf) {
    if (isAdminMaster) return false;
    const rule = getRule(item);
    return rule ? !can(rule.feature) : false;
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Sair da conta encerra a sessão real. A preferência biométrica pode
      // permanecer localmente, mas só volta a funcionar após novo login.
      // "Bloquear aplicativo" é a ação local que mantém a sessão aberta.
      try {
        await signOut();
      } catch {
        /* segue para login mesmo em erro */
      }
    } finally {
      void navigate({ to: "/login", replace: true });
    }
  }

  function renderCard(item: NavLeaf) {
    const Icon = item.icon;
    const locked = isLocked(item);
    return (
      <Link
        key={item.to}
        to={locked ? "/meu-plano" : item.to}
        preload="intent"
        preloadDelay={0}
        className={cn(
          "group flex min-h-[68px] items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-card transition-colors active:scale-[0.99]",
          locked ? "opacity-75" : "hover:bg-card-elevated",
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card-elevated text-foreground ring-1 ring-border/60">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{t(`items.${item.labelKey}`)}</span>
            {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </span>
          {item.descKey && (
            <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
              {t(`descriptions.${item.descKey}`)}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  return (
    <MobileShell>
      <header className="flex items-start gap-3 pt-3">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground active:scale-95"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("more.title")}</h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{t("more.description")}</p>
        </div>
      </header>

      <section className="mt-5 rounded-3xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <UserAvatar url={profile?.avatar_url} name={displayName} email={user?.email} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-card-elevated px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("more.currentPlan")}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold">{PLAN_LABEL[plan]}</p>
          </div>
          {isTrialActive && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[10px] font-semibold text-warning">
              <Sparkles className="h-3 w-3" />
              {t("more.trial", { days: trialDaysLeft })}
            </span>
          )}
        </div>
      </section>

      {appLock.bridgeAvailable && (
        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <Fingerprint className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Bloqueio por biometria</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {appLock.enabled
                  ? "Ativada neste dispositivo. Pediremos sua biometria ao abrir o app."
                  : "Use a biometria do aparelho para desbloquear o app sem digitar a senha."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleAppLock}
              disabled={togglingLock}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-60",
                appLock.enabled
                  ? "border border-destructive/30 bg-destructive/10 text-destructive"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {togglingLock ? "Aguarde…" : appLock.enabled ? "Desativar" : "Ativar"}
            </button>
          </div>
        </section>
      )}

      {loginBioAvailable && (
        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <Fingerprint className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Entrada por biometria</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {loginBioEnabled
                  ? "Ativada. Você poderá entrar com a digital sem digitar a senha."
                  : "Entre no app com a digital deste aparelho, sem precisar digitar a senha."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleLoginBio}
              disabled={togglingLoginBio}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-60",
                loginBioEnabled
                  ? "border border-destructive/30 bg-destructive/10 text-destructive"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {togglingLoginBio ? "Aguarde…" : loginBioEnabled ? "Desativar" : "Ativar"}
            </button>
          </div>
        </section>
      )}

      {/* Dashboard + pessoal */}
      <section className="mt-5 space-y-2">
        <Link
          to="/app"
          preload="intent"
          preloadDelay={0}
          className="flex min-h-[68px] items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card active:scale-[0.99]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
            <Home className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("items.dashboard")}</span>
            <span className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {t("header.tagline")}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
        {PERSONAL_ITEMS.map(renderCard)}
        <OfflineHistoryTrigger userId={user?.id ?? null} />
      </section>

      {/* Grupos */}
      {groups.map((group) => (
        <section key={group.id} className="mt-6">
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t(group.labelKey)}
          </h2>
          <div className="space-y-2">{group.items.map(renderCard)}</div>
        </section>
      ))}

      {appLock.bridgeAvailable && (
        <button
          type="button"
          onClick={() => {
            appLock.lockNow();
            void navigate({ to: "/" });
          }}
          className="mt-6 flex min-h-[58px] w-full items-center justify-center gap-2 rounded-3xl border border-border bg-card p-4 text-sm font-semibold active:scale-[0.99]"
        >
          <Lock className="h-4 w-4" />
          Bloquear aplicativo
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            (volta com biometria)
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-3 flex min-h-[58px] w-full items-center justify-center gap-2 rounded-3xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-semibold text-destructive active:scale-[0.99] disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" />
        {t("more.signOut")}
        <span className="ml-2 text-[10px] font-normal text-destructive/70">(encerra a sessão)</span>
      </button>
    </MobileShell>
  );
}
