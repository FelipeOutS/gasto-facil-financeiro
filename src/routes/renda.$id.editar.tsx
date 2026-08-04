import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Pencil } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ReceitaForm } from "@/components/renda/ReceitaForm";
import { useAuth } from "@/lib/auth-context";
import { type TipoCadastro } from "@/lib/profile-utils";
import { makeRevenueT, revenueSuffix } from "@/lib/revenue-vocab";
import { getReceitas, useBootstrap, useStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/renda/$id/editar")({
  head: () => ({ meta: [{ title: "Editar receita — Gasto Inteligente" }] }),
  component: EditarReceitaPage,
});

function EditarReceitaPage() {
  const { id } = Route.useParams();
  const { t: tBase } = useTranslation("renda");
  const { profile } = useAuth();
  const t = useMemo(
    () => makeRevenueT(tBase, revenueSuffix(profile?.tipo_cadastro as TipoCadastro)),
    [tBase, profile?.tipo_cadastro],
  );
  const navigate = useNavigate();
  const ready = useBootstrap();
  const receitas = useStore(() => getReceitas());
  const receita = receitas.find((r) => r.id === id) ?? null;

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/renda" });
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
            {t("back")}
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
          {t("dialog.editTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("dialog.editDescription")}</p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !receita ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("notFound.title")}</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/renda" })}>
              {t("back")}
            </Button>
          </div>
        ) : (
          <ReceitaForm
            key={receita.id}
            mode="edit"
            receita={receita}
            onDone={back}
            onCancel={back}
          />
        )}
      </div>
    </MobileShell>
  );
}
