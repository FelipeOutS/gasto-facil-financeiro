import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Fingerprint, KeyRound } from "lucide-react";
import i18n from "@/i18n";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { traduzirErroAuth } from "@/lib/auth-messages";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { supabase } from "@/integrations/supabase/client";
import {
  enableLoginBio,
  getLoginBioEmail,
  isLoginBioBridgeAvailable,
  isLoginBioEnabled,
  runLoginBiometric,
} from "@/lib/biometric-login";

export const Route = createFileRoute("/login")({
  head: () => {
    const t = i18n.getFixedT(null, "auth");
    return { meta: [{ title: t("metaTitleLogin") }] };
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <GuestOnly>
      <LoginForm />
    </GuestOnly>
  );
}

function LoginForm() {
  const { t } = useTranslation("auth");
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Estado da biometria de login.
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioMode, setBioMode] = useState(false); // exibe painel "Entrar com digital"
  const [bioRunning, setBioRunning] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  // Prompt para ativar biometria após login com sucesso.
  const [askEnableBio, setAskEnableBio] = useState(false);
  const [enablingBio, setEnablingBio] = useState(false);

  useEffect(() => {
    const av = isLoginBioBridgeAvailable();
    const en = isLoginBioEnabled();
    setBioAvailable(av);
    setBioEnabled(en);
    if (av && en) {
      setBioMode(true);
      const savedEmail = getLoginBioEmail();
      if (savedEmail) setEmail(savedEmail);
    }
  }, []);

  async function handleBiometric() {
    if (bioRunning) return;
    setBioError(null);
    setBioRunning(true);
    const result = await runLoginBiometric();
    setBioRunning(false);
    if (result.success !== true) {
      setBioError(result.error || "Não foi possível validar a biometria.");
      return;
    }
    // Biometria aprovada. Tenta usar a sessão Supabase já persistida
    // (refresh token gerenciado pelo SDK).
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        toast.success(t("login.welcomeBack"));
        void navigate({ to: "/" });
        return;
      }
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        toast.success(t("login.welcomeBack"));
        void navigate({ to: "/" });
        return;
      }
    } catch (e) {
      console.log("[LoginBio] falha ao recuperar sessão:", e);
    }
    // Sem sessão recuperável — pede senha.
    setBioError("Sua sessão expirou. Entre com sua senha desta vez para reativar a biometria.");
    setBioMode(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    // Se bridge disponível e ainda não ativada, oferece ativar.
    if (bioAvailable && !bioEnabled) {
      setAskEnableBio(true);
      return;
    }
    toast.success(t("login.welcomeBack"));
    void navigate({ to: "/" });
  }

  async function handleAcceptEnableBio() {
    setEnablingBio(true);
    try {
      await enableLoginBio(email.trim());
      toast.success("Biometria de entrada ativada neste dispositivo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível ativar a biometria.");
    } finally {
      setEnablingBio(false);
      setAskEnableBio(false);
      void navigate({ to: "/" });
    }
  }

  function handleDeclineEnableBio() {
    setAskEnableBio(false);
    void navigate({ to: "/" });
  }

  // === Painel de pós-login: oferecer ativar biometria ===
  if (askEnableBio) {
    return (
      <AuthShell
        title="Ativar entrada por biometria?"
        subtitle="Use a digital deste aparelho nas próximas vezes em que abrir o app."
      >
        <div className="flex flex-col items-center gap-5">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-border/60">
            <Fingerprint className="h-10 w-10" />
          </span>
          <p className="text-center text-sm text-muted-foreground">
            Sua senha não será salva. A biometria apenas autoriza o uso da sua sessão já segura.
          </p>
          <div className="flex w-full flex-col gap-2">
            <Button
              onClick={handleAcceptEnableBio}
              disabled={enablingBio}
              className="h-12 w-full rounded-xl text-base font-semibold"
            >
              <Fingerprint className="h-4 w-4" />
              {enablingBio ? "Validando…" : "Ativar biometria"}
            </Button>
            <Button
              variant="outline"
              onClick={handleDeclineEnableBio}
              disabled={enablingBio}
              className="h-12 w-full rounded-xl text-base font-semibold"
            >
              Agora não
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  // === Painel de biometria (substitui o formulário) ===
  if (bioMode) {
    return (
      <AuthShell
        title="Entrar com biometria"
        subtitle="Use a digital deste aparelho para continuar."
      >
        <div className="flex flex-col items-center gap-6">
          <span className="grid h-24 w-24 place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-border/60">
            <Fingerprint className="h-12 w-12" />
          </span>
          {email && (
            <p className="text-sm text-muted-foreground">
              Entrando como <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
          {bioError && (
            <p className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
              {bioError}
            </p>
          )}
          <div className="flex w-full flex-col gap-2">
            <Button
              onClick={handleBiometric}
              disabled={bioRunning}
              className="h-12 w-full rounded-xl text-base font-semibold"
            >
              <Fingerprint className="h-4 w-4" />
              {bioRunning ? "Aguardando biometria…" : "Usar digital"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setBioMode(false);
                setBioError(null);
              }}
              className="h-12 w-full rounded-xl text-base font-semibold"
            >
              <KeyRound className="h-4 w-4" />
              Entrar com senha
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <div className="flex flex-col items-center gap-2">
          <span className="text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link to="/cadastro" className="font-semibold text-primary hover:underline">
              {t("login.create")}
            </Link>
          </span>
        </div>
      }
    >
      <div className="mb-5 flex justify-center sm:hidden">
        <LanguageSwitcher align="center" className="h-9 rounded-full px-4" />
      </div>
      {bioAvailable && bioEnabled && (
        <div className="mb-5">
          <Button
            variant="outline"
            onClick={() => {
              setBioMode(true);
              setBioError(null);
            }}
            className="h-12 w-full rounded-xl text-base font-semibold"
          >
            <Fingerprint className="h-4 w-4" />
            Entrar com biometria
          </Button>
        </div>
      )}
      <div className="mb-5 animate-fade-in">
        <GoogleAuthButton label={t("login.googleLabel")} separatorText={t("login.separator")} />
      </div>
      <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("login.email")}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="h-12 rounded-xl border-border/70 bg-background px-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("login.password")}
            </Label>
            <Link
              to="/recuperar-senha"
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("login.forgot")}
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("passwordPlaceholderShort")}
            className="h-12 rounded-xl border-border/70 bg-background px-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          {t("login.remember")}
        </label>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-xl text-base font-semibold shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
          disabled={submitting}
        >
          {submitting ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
