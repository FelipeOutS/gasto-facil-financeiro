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
            <CreditCard className="h-4 w-4" />
          </span>
          {t("form.editTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("form.subtitle")}</p>
      </header>

      <div className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {!ready || !cartao ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <CartaoForm
            editing={cartao}
            onCancel={back}
            onSaved={() => navigate({ to: "/cartoes/$id", params: { id } })}
          />
        )}
      </div>
    </MobileShell>
  );
}
