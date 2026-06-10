import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Home, ListPlus } from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { addLista, type ListaTipo } from "@/lib/mercado/listas-store";

export const Route = createFileRoute("/mercado_/listas_/nova")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:nova.metaTitle", { lng: i18n.language }) }],
  }),
  component: NovaListaPage,
});

const TIPOS: ListaTipo[] = ["compraMes", "reposicao", "churrasco", "farmacia", "outros"];

function NovaListaPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [tipo, setTipo] = useState<ListaTipo>("compraMes");
  const [observation, setObservation] = useState("");
  const [estimate, setEstimate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleBack() {
    void navigate({ to: "/mercado/listas", replace: true });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("nova.errors.nameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const estimateValue = estimate
        ? Number(estimate.replace(",", "."))
        : undefined;
      addLista({
        name: trimmed,
        tipo,
        observation: observation.trim() || undefined,
        estimate:
          typeof estimateValue === "number" && Number.isFinite(estimateValue)
            ? estimateValue
            : undefined,
      });
      toast.success(t("nova.success"));
      void navigate({ to: "/mercado/listas" });
    } catch {
      toast.error(t("nova.errors.generic"));
      setSubmitting(false);
    }
  }

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("nova.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("nova.home")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-2xl font-bold tracking-tight md:text-3xl">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
              <ListPlus className="h-5 w-5" />
            </span>
            {t("nova.title")}
          </h1>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground md:text-base">
            {t("nova.subtitle")}
          </p>
        </div>
      </header>
      <form
        onSubmit={handleSubmit}
        className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-6"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Name */}
          <div className="md:col-span-2">
            <label
              htmlFor="lista-name"
              className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("nova.fields.name.label")}
            </label>
            <input
              id="lista-name"
              type="text"
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("nova.fields.name.placeholder")}
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none ring-0 transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>

          {/* Tipo */}
          <div className="md:col-span-2">
            <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("nova.fields.tipo.label")}
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIPOS.map((opt) => {
                const active = tipo === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setTipo(opt)}
                    className={cn(
                      "rounded-full border px-3.5 py-2 text-sm font-medium transition-all active:scale-95",
                      active
                        ? "border-transparent bg-brand-grad text-primary-foreground shadow-elevated"
                        : "border-border bg-card-elevated text-foreground/80 hover:text-foreground",
                    )}
                    aria-pressed={active}
                  >
                    {t(`nova.fields.tipo.options.${opt}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Estimate */}
          <div>
            <label
              htmlFor="lista-estimate"
              className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("nova.fields.estimate.label")}
            </label>
            <input
              id="lista-estimate"
              type="text"
              inputMode="decimal"
              maxLength={12}
              value={estimate}
              onChange={(e) =>
                setEstimate(e.target.value.replace(/[^\d.,]/g, ""))
              }
              placeholder={t("nova.fields.estimate.placeholder")}
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("nova.fields.estimate.hint")}
            </p>
          </div>

          {/* Observation */}
          <div>
            <label
              htmlFor="lista-observation"
              className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("nova.fields.observation.label")}
            </label>
            <input
              id="lista-observation"
              type="text"
              maxLength={140}
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder={t("nova.fields.observation.placeholder")}
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center justify-center rounded-2xl border border-border bg-card-elevated px-5 py-3 text-sm font-semibold text-foreground/80 transition-colors hover:text-foreground active:scale-[0.98]"
          >
            {t("nova.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ListPlus className="h-4 w-4" />
            {t("nova.submit")}
          </button>
        </div>
      </form>
    </MobileShell>
  )
}
