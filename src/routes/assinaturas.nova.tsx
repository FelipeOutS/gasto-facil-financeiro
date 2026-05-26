import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, Plus } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { RecorrenciaForm } from "@/components/assinaturas/RecorrenciaForm";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/assinaturas/nova")({
  head: () => ({ meta: [{ title: "Nova assinatura — Gasto Inteligente" }] }),
  component: NovaAssinaturaPage,
});

function NovaAssinaturaPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/assinaturas" });
    }
  };

  return (
    <MobileShell wide>
      <header className="pt-2 animate-rise">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground/80 transition hover:bg-card-elevated"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/app" })}
            aria-label="Ir para o início"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground/70 transition hover:bg-card-elevated"
          >
            <Home className="h-4 w-4" />
          </button>
        </div>
        <h1 className="flex items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
            <Plus className="h-4 w-4" />
          </span>
          Nova assinatura
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre uma despesa recorrente para acompanhar cobranças futuras.
        </p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        <RecorrenciaForm
          editing={null}
          userId={userId}
          fullWidthActions
          onSaved={() => navigate({ to: "/assinaturas" })}
          onCancel={back}
        />
      </div>
    </MobileShell>
  );
}
