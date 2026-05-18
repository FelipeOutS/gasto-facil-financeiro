import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success(t("login.welcomeBack"));
    void navigate({ to: "/" });
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
