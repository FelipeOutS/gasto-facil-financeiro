import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Home, MapPin, Clock, Info } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";

export const Route = createFileRoute("/mercado_/meus-mercados")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:meusMercados.metaTitle", { lng: i18n.language }) }],
  }),
  component: MeusMercadosPage,
});

function MeusMercadosPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("meusMercados.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("meusMercados.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <MapPin className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("meusMercados.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("meusMercados.comingSoon.subtitle")}
          </p>
        </div>
      </header>

      <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-card md:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
            <Clock className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-brand-on-soft">
              {t("hub.status.soon")}
            </span>
            <h2 className="mt-2 text-lg font-semibold md:text-xl">
              {t("meusMercados.comingSoon.title")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground md:text-[15px]">
              {t("meusMercados.comingSoon.description")}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-border/60 bg-card-elevated p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <p className="text-sm leading-snug text-foreground md:text-[15px]">
            {t("meusMercados.comingSoon.manualHint")}
          </p>
        </div>
      </section>

      <div className="mt-6 flex justify-center">
        <Link
          to="/mercado"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-card-elevated active:scale-[0.99]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("meusMercados.comingSoon.backToHub")}
        </Link>
      </div>
    </MobileShell>
  );
}
