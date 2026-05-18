import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordChecklist } from "@/components/PasswordChecklist";
import { senhaForte, traduzirErroAuth } from "@/lib/auth-messages";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Redefinir senha — Gasto Inteligente" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
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
      toast.error("Faltam alguns requisitos para sua senha ficar segura.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem. Confere aí 👀");
      return;
    }
    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success("Senha atualizada! Pronto para continuar. ✅");
    void navigate({ to: "/" });
  }

  return (
    <AuthShell
      title="Nova senha"
      subtitle={
        ready
          ? "Crie uma senha forte e fácil de lembrar pra você."
          : "Abra esta página pelo link enviado no seu e-mail."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="password">Nova senha</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Crie uma senha forte"
          />
          {password.length > 0 && <PasswordChecklist senha={password} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repita a senha"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
          disabled={submitting || !ready}
        >
          {submitting ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </AuthShell>
  );
}
