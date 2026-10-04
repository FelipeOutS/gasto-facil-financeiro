import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, ChevronLeft, Home } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { CartaoForm } from "@/components/CartaoForm";
import { getCartoes, useBootstrap, useStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import i18n from "@/i18n";

export const Route = createFileRoute("/cartoes/$id/editar")({
  head: () => ({
    meta: [{ title: i18n.t("cartoes:form.editTitle") + " — Gasto Inteligente" }],
  }),
  component: EditarCartaoPage,
});

function EditarCartaoPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation("cartoes");
  const navigate = useNavigate();
  const ready = useBootstrap();
  const cartoes = useStore(() => getCartoes());
  const cartao = cartoes.find((c) => c.id === id) ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/cartoes/$id", params: { id } });
    }
  };

  useEffect(() => {
    if (ready && !cartao) {
      navigate({ to: "/cartoes", replace: true });
    }
  }, [ready, cartao, navigate]);

  return (
    <MobileShell wide className="flex flex-1 flex-col lg:block">
      <header className="flex items-center gap-1 py-1 lg:block lg:pt-2">
        <button
          type="button"
          onClick={back}
          aria-label={t("form.back", { defaultValue: "Voltar" })}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-bold leading-tight tracking-tight lg:hidden">{t("form.editTitle")}</h1>
        <div className="mb-2 hidden items-center gap-2 lg:flex">
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
        <h1 className="hidden items-center gap-2 text-[22px] font-bold leading-tight tracking-tight lg:flex">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
            <CreditCard className="h-4 w-4" />
          </span>
          {t("form.editTitle")}
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground lg:block">{t("form.subtitle")}</p>
      </header>

      <div className="-mx-3 mt-2 flex flex-1 flex-col bg-card sm:mx-0 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:shadow-card lg:mt-4 lg:flex-none">
        {!ready || !cartao ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <CartaoForm
            editing={cartao}
            pageLayout
            onCancel={back}
            onSaved={() => navigate({ to: "/cartoes/$id", params: { id } })}
          />
        )}
      </div>
    </MobileShell>
  );
}
