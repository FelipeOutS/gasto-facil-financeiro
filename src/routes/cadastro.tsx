import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordChecklist } from "@/components/PasswordChecklist";
import { senhaForte, traduzirErroAuth } from "@/lib/auth-messages";

export const Route = createFileRoute("/cadastro")({
  head: () => ({ meta: [{ title: "Criar conta — Gasto Inteligente" }] }),
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
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const senhaOk = useMemo(() => senhaForte(password), [password]);
  const confereSenha = confirm.length > 0 && password === confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!senhaOk) {
      toast.error("Faltam alguns requisitos para sua senha ficar segura.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem. Confere aí 👀");
      return;
    }
    setSubmitting(true);
    const { error } = await signUp(nome.trim(), email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    toast.success("Tudo certo! Sua conta foi criada. 🎉");
    void navigate({ to: "/" });
  }

  return (
    <AuthShell
      title="Criar sua conta"
      subtitle="Leva menos de 1 minuto para começar a organizar seu dinheiro."
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          Já tenho uma conta
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como podemos te chamar?"
          />
        </div>
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
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Crie uma senha forte"
          />
          {(password.length > 0 || touched) && <PasswordChecklist senha={password} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repita a senha"
            aria-invalid={confirm.length > 0 && !confereSenha}
          />
          {confirm.length > 0 && !confereSenha && (
            <p className="text-xs text-destructive animate-fade-in">As senhas não coincidem.</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full rounded-2xl text-base font-semibold transition-transform active:scale-[0.98]"
          disabled={submitting}
        >
          {submitting ? "Criando…" : "Criar conta"}
        </Button>
      </form>
    </AuthShell>
  );
}
