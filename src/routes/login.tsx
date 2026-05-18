import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
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
  head: () => ({ meta: [{ title: "Entrar — Gasto Inteligente" }] }),
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
    toast.success("Que bom te ver de novo! 👋");
    void navigate({ to: "/" });
  }

  return (
    <AuthShell
      title="Bem-vindo de volta"
      subtitle="Seus gastos, metas e o que você guardou — tudo num lugar só."
      footer={
        <div className="flex flex-col items-center gap-2">
          <span className="text-muted-foreground">
            Ainda não tem conta?{" "}
            <Link to="/cadastro" className="font-semibold text-primary hover:underline">
              Criar conta
            </Link>
          </span>
        </div>
      }
    >
      <div className="mb-5 animate-fade-in">
        <GoogleAuthButton label="Entrar com Google" separatorText="ou entre com e-mail" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            E-mail
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            className="h-12 rounded-xl border-border/70 bg-background px-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Senha
            </Label>
            <Link
              to="/recuperar-senha"
              className="text-xs font-medium text-primary hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-12 rounded-xl border-border/70 bg-background px-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          Manter-me conectado
        </label>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-xl text-base font-semibold shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
          disabled={submitting}
        >
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
