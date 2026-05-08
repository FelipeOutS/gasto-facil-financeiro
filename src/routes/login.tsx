import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { traduzirErroAuth } from "@/lib/auth-messages";

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
        <div className="space-y-2">
          <Link to="/cadastro" className="block font-medium hover:underline">
            Criar conta
          </Link>
          <Link
            to="/recuperar-senha"
            className="block text-muted-foreground hover:text-foreground hover:underline"
          >
            Esqueci minha senha
          </Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
          disabled={submitting}
        >
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
