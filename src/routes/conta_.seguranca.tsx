import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { PasswordChecklist } from "@/components/PasswordChecklist";
import { useAuth } from "@/lib/auth-context";
import { senhaForte, traduzirErroAuth } from "@/lib/auth-messages";

export const Route = createFileRoute("/conta/seguranca")({
  head: () => {
    const t = i18n.getFixedT(null, "account");
    return {
      meta: [
        { title: t("security.metaTitle") },
        { name: "robots", content: "noindex,follow" },
      ],
    };
  },
  component: SegurancaPage,
});

function SegurancaPage() {
  const { t } = useTranslation("account");
  const { updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const senhaOk = useMemo(() => senhaForte(password), [password]);
  const senhasIguais = password.length > 0 && password === confirm;
  const canSubmit = !submitting && senhaOk && senhasIguais;

  const disabledReason = useMemo(() => {
    if (!password) return t("security.fillNewPassword");
    if (!senhaOk) return t("security.passwordWeak");
    if (!confirm) return t("security.fillConfirm");
    if (!senhasIguais) return t("security.mismatch");
    return null;
  }, [password, senhaOk, confirm, senhasIguais, t]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      if (disabledReason) toast.error(disabledReason);
      return;
    }
    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success(t("security.success"));
    setPassword("");
    setConfirm("");
    // Por segurança, desconecta e pede novo login.
    setTimeout(() => {
      void (async () => {
        await signOut();
        void navigate({ to: "/login" });
      })();
    }, 800);
  }

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/conta"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{t("security.title")}</h1>
      </header>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("security.changePassword")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("security.currentNotShown")}
            </p>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("security.newPassword")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("security.newPasswordPlaceholder")}
          />
          {password.length > 0 && <PasswordChecklist senha={password} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t("security.confirmPassword")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("security.confirmPasswordPlaceholder")}
          />
          {confirm.length > 0 && !senhasIguais && (
            <p className="text-xs text-destructive">{t("security.mismatch")}</p>
          )}
        </div>
        {disabledReason && (
          <p className="text-xs text-muted-foreground">{disabledReason}</p>
        )}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          title={disabledReason ?? undefined}
        >
          {submitting ? t("security.saving") : t("security.save")}
        </Button>
      </form>
    </MobileShell>
  );
}
