import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, Target } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { MetaForm } from "@/components/metas/MetaForm";
import { getBancos, useBootstrap, useStore } from "@/lib/store";
import { PageSkeleton } from "@/components/PageSkeleton";

export const Route = createFileRoute("/metas/nova")({
  head: () => ({ meta: [{ title: "Nova meta — Gasto Inteligente" }] }),
  component: NovaMetaPage,
});

function NovaMetaPage() {
  const navigate = useNavigate();
  const ready = useBootstrap();
  const bancos = useStore(() => getBancos());

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
            <Target className="h-4 w-4" />
          </span>
          Nova meta
        </h1>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {!ready ? (
          <PageSkeleton />
        ) : (
          <MetaForm
            mode={{ kind: "create" }}
            bancos={bancos}
            fullWidthActions
            onClose={() => navigate({ to: "/metas" })}
          />
        )}
      </div>
    </MobileShell>
  );
}
