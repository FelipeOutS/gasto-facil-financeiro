import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AuthShell, GuestOnly } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth-context";
import { traduzirErroAuth } from "@/lib/auth-messages";
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
      toast.error(traduzirErroAuth(error.message));
      return;
    }
    setSent(true);
    toast.success("Enviamos as instruções para seu e-mail. ✉️");
  }

  return (
    <AuthShell
      title="Esqueceu a senha?"
      subtitle="Sem stress. Mande seu e-mail que a gente te ajuda a recuperar."
      footer={
        <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground animate-rise">
          Pronto! Dá uma olhada na caixa de entrada de{" "}
          <strong className="text-foreground">{email}</strong>. O link expira em alguns minutos —
          se não achar, confere o spam.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail da conta</Label>
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
            className="card-press h-12 w-full rounded-2xl text-base font-semibold"
            disabled={submitting}
          >
            {submitting ? "Enviando…" : "Enviar instruções"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
