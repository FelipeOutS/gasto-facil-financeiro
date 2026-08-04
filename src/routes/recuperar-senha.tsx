import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "@/i18n";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { traduzirErroAuth } from "@/lib/auth-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/recuperar-senha")({
  head: () => {
    const t = i18n.getFixedT(null, "auth");
    return {
      meta: [{ title: t("metaTitleRecover") }, { name: "robots", content: "noindex,follow" }],
    };
  },
  component: RecoverPage,
});

function RecoverPage() {
  return (
    <GuestOnly>
      <RecoverForm />
    </GuestOnly>
  );
}

function RecoverForm() {
  const { t } = useTranslation("auth");
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await resetPassword(email.trim());
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    setSent(true);
    toast.success(t("recover.toast"));
  }

  return (
    <AuthShell
      title={t("recover.title")}
      subtitle={t("recover.subtitle")}
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          {t("signup.backToLogin")}
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground animate-rise">
          {t("recover.sent")} <strong className="text-foreground">{email}</strong>
          {t("recover.sentTail")}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("recover.email")}</Label>
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
          <Button
            type="submit"
            size="lg"
            className="card-press h-12 w-full rounded-2xl text-base font-semibold"
            disabled={submitting}
          >
            {submitting ? t("recover.submitting") : t("recover.submit")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
