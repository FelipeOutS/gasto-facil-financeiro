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
    return {
      meta: [{ title: t("metaTitleReset") }, { name: "robots", content: "noindex,follow" }],
    };
  },
  component: ResetPasswordPage,
});

type LinkStatus = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const senhaOk = useMemo(() => senhaForte(password), [password]);
  const senhasIguais = password.length > 0 && password === confirm;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const finish = (ok: boolean) => {
      if (cancelled) return;
      setStatus(ok ? "ready" : "invalid");
    };

    // 1) Listener para PASSWORD_RECOVERY (Supabase emite após detectar token no hash)
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && sess)) {
        finish(true);
      }
    });

    void (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(hash);

        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");
        const hashType = hashParams.get("type");
        const errorCode = hashParams.get("error") || url.searchParams.get("error");
        const code = url.searchParams.get("code");

        if (errorCode) {
          finish(false);
          return;
        }

        // Fluxo PKCE: link traz ?code=...
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            finish(false);
            return;
          }
          // Limpa o code da URL
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search + window.location.hash);
          finish(true);
          return;
        }

        // Fluxo implicit: link traz #access_token & #refresh_token
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) {
            finish(false);
            return;
          }
          // Limpa o hash
          window.history.replaceState({}, "", url.pathname + url.search);
          finish(true);
          return;
        }

        // Verifica se já existe sessão (ex.: aberto pelo próprio app autenticado)
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          finish(true);
          return;
        }

        // Se veio type=recovery mas sem tokens válidos → link inválido
        if (hashType === "recovery") {
          finish(false);
          return;
        }

        finish(false);
      } catch {
        finish(false);
      }
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const disabledReason = useMemo(() => {
    if (status === "checking") return t("reset.checking");
    if (status === "invalid") return t("reset.linkInvalid");
    if (!password) return t("reset.fillNewPassword");
    if (!senhaOk) return t("passwordWeakToast");
    if (!confirm) return t("reset.fillConfirm");
    if (!senhasIguais) return t("reset.mismatch");
    return null;
  }, [status, password, senhaOk, confirm, senhasIguais, t]);

  const canSubmit = !submitting && status === "ready" && senhaOk && senhasIguais;

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
    toast.success(t("reset.toast"));
    // Encerra a sessão temporária de recuperação para forçar novo login.
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    void navigate({ to: "/login" });
  }

  const subtitle =
    status === "ready"
      ? t("reset.subtitleReady")
      : status === "invalid"
        ? t("reset.linkInvalid")
        : t("reset.subtitleWait");

  return (
    <AuthShell title={t("reset.title")} subtitle={subtitle}>
      {status === "invalid" ? (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {t("reset.linkInvalid")}
          </div>
          <Button
            type="button"
            size="lg"
            className="h-12 w-full rounded-2xl text-base font-semibold"
            onClick={() => void navigate({ to: "/recuperar-senha" })}
          >
            {t("reset.requestNew")}
          </Button>
        </div>
      ) : (
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
            {confirm.length > 0 && !senhasIguais && (
              <p className="text-xs text-destructive">{t("reset.mismatch")}</p>
            )}
          </div>
          {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            title={disabledReason ?? undefined}
          >
            {submitting ? t("reset.submitting") : t("reset.submit")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
