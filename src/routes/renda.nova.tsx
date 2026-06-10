import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Plus } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ReceitaForm, type ReceitaFormPreset } from "@/components/renda/ReceitaForm";
import { useAuth } from "@/lib/auth-context";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import { type TipoCadastro } from "@/lib/profile-utils";
import { makeRevenueT, revenueSuffix } from "@/lib/revenue-vocab";
import type { TipoReceita } from "@/lib/types";

type NovaSearch = {
  tipo?: TipoReceita;
  recorrente?: boolean;
  descricao?: string;
};

export const Route = createFileRoute("/renda/nova")({
  head: () => ({ meta: [{ title: "Nova receita — Gasto Inteligente" }] }),
  validateSearch: (s: Record<string, unknown>): NovaSearch => ({
    tipo: typeof s.tipo === "string" ? (s.tipo as TipoReceita) : undefined,
    recorrente:
      s.recorrente === true || s.recorrente === "1" || s.recorrente === "true"
        ? true
        : s.recorrente === false || s.recorrente === "0" || s.recorrente === "false"
          ? false
          : undefined,
    descricao: typeof s.descricao === "string" ? s.descricao : undefined,
  }),
  component: NovaReceitaPage,
});

function NovaReceitaPage() {
  const { t: tBase } = useTranslation("renda");
  const { profile } = useAuth();
  const t = useMemo(
    () => makeRevenueT(tBase, revenueSuffix(profile?.tipo_cadastro as TipoCadastro)),
    [tBase, profile?.tipo_cadastro],
  );
  const navigate = useNavigate();
  const search = Route.useSearch();

  const preset: ReceitaFormPreset = {
    tipo: search.tipo,
    recorrente: search.recorrente,
    descricao: search.descricao,
  };

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
            <Plus className="h-4 w-4" />
          </span>
          {t("dialog.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("dialog.newDescription")}</p>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        <ReceitaForm
          mode="create"
          preset={preset}
          onDone={() => navigate({ to: "/renda" })}
          onCancel={back}
        />
      </div>
    </MobileShell>
  );
}
