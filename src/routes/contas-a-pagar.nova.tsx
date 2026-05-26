import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Plus } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ContaPagarForm } from "@/components/contas/ContaPagarForm";

export const Route = createFileRoute("/contas-a-pagar/nova")({
  head: () => ({ meta: [{ title: "Nova conta a pagar — Gasto Inteligente" }] }),
  component: NovaContaPage,
});

function NovaContaPage() {
  const { t } = useTranslation("contas-a-pagar");
  const navigate = useNavigate();

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
            <Plus className="h-4 w-4" />
          </span>
          {t("form.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("form.newDesc")}</p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        <ContaPagarForm
          fullWidthActions
          onSaved={() => navigate({ to: "/contas-a-pagar" })}
          onCancel={back}
        />
      </div>
    </MobileShell>
  );
}
