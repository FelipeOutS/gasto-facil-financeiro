import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Pencil } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { EditGastoForm } from "@/components/EditGastoDialog";
import { getGastos, useBootstrap, useStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/gastos/$id/editar")({
  head: () => ({ meta: [{ title: "Editar gasto — Gasto Inteligente" }] }),
  component: EditarGastoPage,
});

function EditarGastoPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation("gastos");
  const navigate = useNavigate();
  const ready = useBootstrap();
  const gastos = useStore(() => getGastos());
  const gasto = gastos.find((g) => g.id === id) ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/gastos" });
    }
  };

  useEffect(() => {
    if (ready && !gasto) {
      navigate({ to: "/gastos", replace: true });
    }
  }, [ready, gasto, navigate]);

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
          {t("form.editar.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("form.editar.desc")}</p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {!ready || !gasto ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <EditGastoForm key={gasto.id} gasto={gasto} onDone={back} onCancel={back} />
        )}
      </div>
    </MobileShell>
  );
}
