import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "@/i18n";
import { AuthShell } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordChecklist } from "@/components/PasswordChecklist";
import { senhaForte, traduzirErroAuth } from "@/lib/auth-messages";

export const Route = createFileRoute("/reset-password")({
  head: () => {
    const t = i18n.getFixedT(null, "auth");
    return { meta: [{ title: t("metaTitleReset") }, { name: "robots", content: "noindex,follow" }] };
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const senhaOk = useMemo(() => senhaForte(password), [password]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!senhaOk) {
      toast.error(t("passwordWeakToast"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("passwordMismatchToast"));
      return;
    }
    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success(t("reset.toast"));
    void navigate({ to: "/" });
  }

  return (
    <AuthShell
      title={t("reset.title")}
      subtitle={ready ? t("reset.subtitleReady") : t("reset.subtitleWait")}
    >
      <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("reset.newPassword")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("signup.passwordPlaceholder")}
          />
          {password.length > 0 && <PasswordChecklist senha={password} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t("reset.confirm")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("signup.confirmPlaceholder")}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
          disabled={submitting || !ready}
        >
          {submitting ? t("reset.submitting") : t("reset.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
