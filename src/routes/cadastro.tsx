import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MailCheck, RefreshCw } from "lucide-react";
import i18n from "@/i18n";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordChecklist } from "@/components/PasswordChecklist";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { senhaForte, traduzirErroAuth } from "@/lib/auth-messages";

export const Route = createFileRoute("/cadastro")({
  head: () => {
    const t = i18n.getFixedT(null, "auth");
    return { meta: [{ title: t("metaTitleSignup") }] };
  },
  component: CadastroPage,
});

function CadastroPage() {
  return (
    <GuestOnly>
      <CadastroForm />
    </GuestOnly>
  );
}

function CadastroForm() {
  const { t } = useTranslation("auth");
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  const senhaOk = useMemo(() => senhaForte(password), [password]);
  const confereSenha = confirm.length > 0 && password === confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!senhaOk) {
      toast.error(t("passwordWeakToast"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("passwordMismatchToast"));
      return;
    }
    setSubmitting(true);
    const { error } = await signUp(nome.trim(), email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    setEnviado(true);
  }

  async function reenviar() {
    if (!email) return;
    setReenviando(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: (await import("@/lib/public-url")).buildPublicUrl("/") },
    });
    setReenviando(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success(t("signup.resent"));
  }

  if (enviado) {
    return (
      <AuthShell
        title={t("signup.checkEmail")}
        subtitle={t("signup.checkEmailSubtitle")}
        footer={
          <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
            {t("signup.backToLogin")}
          </Link>
        }
      >
        <div className="space-y-5 animate-fade-in">
          <div className="rounded-2xl border border-border bg-card-elevated p-5 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-brand">
              <MailCheck className="h-7 w-7" />
            </div>
            <p className="mt-4 text-sm text-foreground">
              {t("signup.sentTo")}
            </p>
            <p className="mt-1 break-all text-base font-semibold">{email}</p>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              {t("signup.checkInbox")}{" "}
              <strong className="text-foreground">
                {t("signup.checkSpam")}
              </strong>
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-2xl text-base font-semibold"
            onClick={reenviar}
            disabled={reenviando}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${reenviando ? "animate-spin" : ""}`} />
            {reenviando ? t("signup.resending") : t("signup.resend")}
          </Button>

          <Button
            type="button"
            className="h-12 w-full rounded-2xl text-base font-semibold"
            onClick={() => void navigate({ to: "/login" })}
          >
            {t("signup.alreadyConfirmed")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          {t("signup.haveAccount")}
        </Link>
      }
    >
      <div className="mb-5 animate-fade-in">
        <GoogleAuthButton label={t("signup.googleLabel")} separatorText={t("signup.separator")} />
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="nome">{t("signup.name")}</Label>
          <Input
            id="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("signup.namePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("signup.email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("signup.password")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("signup.passwordPlaceholder")}
          />
          {(password.length > 0 || touched) && <PasswordChecklist senha={password} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t("signup.confirm")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("signup.confirmPlaceholder")}
            aria-invalid={confirm.length > 0 && !confereSenha}
          />
          {confirm.length > 0 && !confereSenha && (
            <p className="text-xs text-destructive animate-fade-in">{t("signup.mismatch")}</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
          disabled={submitting}
        >
          {submitting ? t("signup.submitting") : t("signup.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
