import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ChevronLeft, Home, Pencil } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { RecorrenciaForm } from "@/components/assinaturas/RecorrenciaForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useBootstrap } from "@/lib/store";
import { hydrateRecorrencias, useRecorrencias } from "@/lib/recorrencias";

export const Route = createFileRoute("/assinaturas/$id/editar")({
  head: () => ({ meta: [{ title: "Editar assinatura — Gasto Inteligente" }] }),
  component: EditarAssinaturaPage,
});

function EditarAssinaturaPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const ready = useBootstrap();
  const recs = useRecorrencias();
  const rec = recs.find((r) => r.id === id) ?? null;

  useEffect(() => {
    if (userId && ready) {
      void hydrateRecorrencias(userId);
    }
  }, [userId, ready]);

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
            <Pencil className="h-4 w-4" />
          </span>
          Editar assinatura
        </h1>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !rec ? (
          <div className="py-8 text-center">
            <p className="text-base font-semibold">Assinatura não encontrada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Essa assinatura pode ter sido removida ou não está mais disponível.
            </p>
            <Button className="mt-4 min-h-11" onClick={() => navigate({ to: "/assinaturas" })}>
              Voltar para assinaturas
            </Button>
          </div>
        ) : (
          <RecorrenciaForm
            key={rec.id}
            editing={rec}
            userId={userId}
            fullWidthActions
            onSaved={() => navigate({ to: "/assinaturas" })}
            onCancel={back}
          />
        )}
      </div>
    </MobileShell>
  );
}
