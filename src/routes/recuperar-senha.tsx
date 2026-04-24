import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/recuperar-senha")({
  head: () => ({ meta: [{ title: "Recuperar senha — Gasto Fácil" }] }),
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
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Enviamos um e-mail com instruções");
  }

  return (
    <AuthShell
      title="Esqueci minha senha"
      subtitle="Informe seu e-mail e enviaremos as instruções de redefinição."
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          Voltar ao login
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Verifique sua caixa de entrada em <strong className="text-foreground">{email}</strong>.
          O link expira em alguns minutos.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-2xl text-base font-semibold"
            disabled={submitting}
          >
            {submitting ? "Enviando…" : "Enviar recuperação"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
