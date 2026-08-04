import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, Minus } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { MetaForm } from "@/components/metas/MetaForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getBancos, getMetas, useBootstrap, useStore } from "@/lib/store";

export const Route = createFileRoute("/metas/$id/remover")({
  head: () => ({ meta: [{ title: "Remover valor da meta — Gasto Inteligente" }] }),
  component: RemoverMetaPage,
});

function RemoverMetaPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const ready = useBootstrap();
  const metas = useStore(() => getMetas());
  const bancos = useStore(() => getBancos());
  const meta = metas.find((m) => m.id === id) ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/metas" });
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
            <Minus className="h-4 w-4" />
          </span>
          Ajustar valor
        </h1>
        {meta && <p className="mt-1 text-sm text-muted-foreground">{meta.nome}</p>}
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : !meta ? (
          <div className="py-8 text-center">
            <p className="text-base font-semibold">Meta não encontrada</p>
            <Button className="mt-4 min-h-11" onClick={() => navigate({ to: "/metas" })}>
              Voltar para metas
            </Button>
          </div>
        ) : (
          <MetaForm
            key={meta.id}
            mode={{ kind: "remove", meta }}
            bancos={bancos}
            fullWidthActions
            onClose={() => navigate({ to: "/metas" })}
          />
        )}
      </div>
    </MobileShell>
  );
}
