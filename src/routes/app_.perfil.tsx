import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  Languages,
  LogOut,
  Pencil,
  RotateCcw,
  Settings2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/app_/perfil")({
  head: () => ({ meta: [{ title: "Perfil — Gasto Inteligente" }] }),
  component: AppPerfilPage,
});

function AppPerfilPage() {
  const { t } = useTranslation("account");
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const displayName =
    profile?.nome ||
    profile?.responsavel_nome ||
    profile?.nome_fantasia ||
    user?.email?.split("@")[0] ||
    t("defaultUser");

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await signOut();
    void navigate({ to: "/login", replace: true });
  }

  const shortcuts = [
    { to: "/conta", label: t("profileShortcuts.account"), icon: UserRound },
    { to: "/perfil", label: t("actions.edit"), icon: Pencil },
    { to: "/meu-plano", label: t("actions.myPlan"), icon: Sparkles },
    { to: "/categorias", label: t("profileShortcuts.settings"), icon: Settings2 },
    { to: "/app/idioma", label: t("language.title"), icon: Languages },
    { to: "/onboarding", label: t("actions.redoOnboarding"), icon: RotateCcw },
  ] as const;

  return (
    <MobileShell>
      <header className="flex items-start gap-3 pt-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground active:scale-95"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("profileShortcuts.title")}</h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {t("profileShortcuts.description")}
          </p>
        </div>
      </header>

      <section className="mt-5 rounded-3xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <UserAvatar url={profile?.avatar_url} name={displayName} email={user?.email} size={62} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-3">
        {shortcuts.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            preload="intent"
            preloadDelay={0}
            className="flex min-h-[64px] items-center gap-3 rounded-3xl border border-border bg-card p-4 shadow-card active:scale-[0.99]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="mt-1 flex min-h-[58px] items-center justify-center gap-2 rounded-3xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-semibold text-destructive active:scale-[0.99] disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {t("actions.logout")}
        </button>
      </section>
    </MobileShell>
  );
}
