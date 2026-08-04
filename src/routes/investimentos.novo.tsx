import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { InvestimentoForm } from "@/components/investimentos/InvestimentoForm";

export const Route = createFileRoute("/investimentos/novo")({
  head: () => ({ meta: [{ title: "Novo investimento — Gasto Inteligente" }] }),
  component: NovoInvestimentoPage,
});

function NovoInvestimentoPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/investimentos" });
    }
  };

  return (
    <MobileShell wide>
      <header className="pt-2 pb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ml-2">
          <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app" })}>
          <Home className="h-4 w-4" />
        </Button>
      </header>
      <h1 className="text-2xl font-bold tracking-tight mb-1">Novo investimento</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Cadastre as informações do ativo. Apenas Nome é obrigatório.
      </p>
      <InvestimentoForm userId={user?.id} editing={null} onCancel={back} onSaved={back} />
    </MobileShell>
  );
}
