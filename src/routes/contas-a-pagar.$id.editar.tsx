import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Pencil } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ContaPagarForm } from "@/components/contas/ContaPagarForm";
import { getContasAPagar, useBootstrap, useStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/contas-a-pagar/$id/editar")({
  head: () => ({ meta: [{ title: "Editar conta a pagar — Gasto Inteligente" }] }),
  component: EditarContaPage,
});

function EditarContaPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation("contas-a-pagar");
  const navigate = useNavigate();
  const ready = useBootstrap();
  const contas = useStore(() => getContasAPagar());
  const conta = contas.find((c) => c.id === id) ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/contas-a-pagar" });
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
            {t("header.back")}
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
          {t("form.editTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("form.editDesc")}</p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !conta ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Conta a pagar não encontrada.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/contas-a-pagar" })}>
              {t("header.back")}
            </Button>
          </div>
        ) : (
          <ContaPagarForm
            key={conta.id}
            conta={conta}
            fullWidthActions
            onSaved={back}
            onCancel={back}
          />
        )}
      </div>
    </MobileShell>
  );
}
