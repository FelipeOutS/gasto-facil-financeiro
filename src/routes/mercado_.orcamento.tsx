import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Home,
  WalletCards,
  Save,
  History as HistoryIcon,
  ShoppingCart,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { PremiumInlineLink } from "@/components/mercado/PremiumInlineLink";
import { cn } from "@/lib/utils";
import {
  setOrcamentoMercado,
  useMercadoOrcamento,
  useResumoOrcamentoMercado,
  getCurrentMonthKey,
  type MercadoBudgetStatus,
} from "@/lib/mercado/orcamento-store";

export const Route = createFileRoute("/mercado_/orcamento")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:budget.metaTitle", { lng: i18n.language }) }],
  }),
  component: OrcamentoPage,
});

function OrcamentoPage() {
  const { t, i18n: i18next } = useTranslation("mercado");
  const navigate = useNavigate();
  const orcamento = useMercadoOrcamento();
  const resumo = useResumoOrcamentoMercado();

  const [valor, setValor] = useState<string>(
    orcamento.valorMensal > 0 ? String(orcamento.valorMensal) : "",
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = Number(valor.replace(",", "."));
    setOrcamentoMercado({
      valorMensal: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
      mesReferencia: orcamento.mesReferencia || getCurrentMonthKey(),
    });
    setSavedAt(Date.now());
  }

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18next.language || "pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    [i18next.language],
  );

  const monthLabel = useMemo(() => {
    const [y, m] = resumo.mesReferencia.split("-").map(Number);
    if (!y || !m) return resumo.mesReferencia;
    const d = new Date(y, m - 1, 1);
    return new Intl.DateTimeFormat(i18next.language || "pt-BR", {
      month: "long",
      year: "numeric",
    }).format(d);
  }, [resumo.mesReferencia, i18next.language]);

  const statusTone = getStatusTone(resumo.status);
  const progressPct = Math.min(100, Math.max(0, resumo.percentualUsado));

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("budget.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("budget.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <WalletCards className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("budget.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("budget.subtitle")}
          </p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5 lg:col-span-1"
        >
          <h2 className="text-base font-semibold md:text-lg">{t("budget.form.title")}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t("budget.form.monthHint", { month: monthLabel })}
          </p>

          <label className="mt-4 block text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("budget.form.amountLabel")}
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated px-3 focus-within:ring-2 focus-within:ring-brand">
            <span className="text-sm font-semibold text-muted-foreground">R$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={t("budget.form.amountPlaceholder")}
              className="min-h-11 min-w-0 flex-1 bg-transparent py-2 text-base tabular-nums outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <button
            type="submit"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <Save className="h-4 w-4" />
            {t("budget.form.save")}
          </button>

          {savedAt && (
            <p className="mt-2 text-[12px] text-success">{t("budget.form.saved")}</p>
          )}
        </form>

        {/* Summary */}
        <article className="rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold md:text-lg">{t("budget.summary.title")}</h2>
              <p className="mt-0.5 text-[12px] capitalize text-muted-foreground">{monthLabel}</p>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
                statusTone.badge,
              )}
            >
              {t(`budget.status.${resumo.status}`)}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label={t("budget.summary.limit")} value={<Money value={resumo.orcamento} />} />
            <SummaryTile label={t("budget.summary.spent")} value={<Money value={resumo.gastoMes} />} />
            <SummaryTile
              label={t("budget.summary.remaining")}
              value={<Money value={resumo.saldoRestante} />}
              tone={
                resumo.hasBudget
                  ? resumo.saldoRestante < 0
                    ? "destructive"
                    : "success"
                  : undefined
              }
            />
            <SummaryTile
              label={t("budget.summary.used")}
              value={resumo.hasBudget ? `${resumo.percentualUsado}%` : "—"}
              tone={statusTone.text}
            />
          </div>

          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-card-elevated ring-1 ring-border/60">
              <div
                className={cn("h-full transition-all", statusTone.bar)}
                style={{ width: `${progressPct}%` }}
                aria-hidden
              />
            </div>
          </div>

          <p
            className={cn(
              "mt-3 rounded-2xl border p-3 text-[13px] leading-snug",
              statusTone.message,
            )}
          >
            {t(`budget.message.${resumo.status}`)}
          </p>
        </article>
      </section>

      {/* History */}
      <section className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold md:text-lg">{t("budget.history.title")}</h2>
          <PremiumInlineLink
            feature="mercado_avancado"
            to="/mercado/historico"
            className="text-[12px] font-semibold text-brand hover:underline"
            modalTitle={t("premiumInline.avancado.title")}
            modalDescription={t("premiumInline.avancado.description")}
          >
            {t("budget.history.seeAll")}
          </PremiumInlineLink>
        </div>

        {resumo.comprasDoMes.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-dashed border-border bg-card p-6 text-center shadow-card">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
              <ShoppingCart className="h-6 w-6" />
            </span>
            <h3 className="mt-3 text-base font-semibold">{t("budget.history.emptyTitle")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t("budget.history.emptyDesc")}
            </p>
            <Link
              to="/mercado/listas"
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
            >
              {t("budget.history.cta")}
            </Link>
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {resumo.comprasDoMes.slice(0, 9).map((h) => {
              const hasBudget = typeof h.orcamento === "number" && h.orcamento > 0;
              const over = hasBudget && h.economiaOuEstouro < 0;
              const diffAbs = Math.abs(h.economiaOuEstouro);
              return (
                <li
                  key={h.id}
                  className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-3 shadow-card"
                >
                  <div className="flex items-start gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
                      <HistoryIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{h.nome || "—"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {dateFormatter.format(new Date(h.concluidaEm))}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums">
                      <Money value={h.totalEstimado} />
                    </p>
                  </div>
                  {hasBudget && (
                    <p
                      className={cn(
                        "text-[11px] font-semibold",
                        over ? "text-destructive" : "text-success",
                      )}
                    >
                      {over
                        ? t("historico.card.overBy", {
                            value: diffAbs.toLocaleString(undefined, {
                              style: "currency",
                              currency: "BRL",
                            }),
                          })
                        : t("historico.card.savedBy", {
                            value: diffAbs.toLocaleString(undefined, {
                              style: "currency",
                              currency: "BRL",
                            }),
                          })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </MobileShell>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "success" | "warning" | "destructive" | string;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-base font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

function getStatusTone(status: MercadoBudgetStatus): {
  badge: string;
  bar: string;
  text: "success" | "warning" | "destructive" | "muted";
  message: string;
} {
  switch (status) {
    case "dentro":
      return {
        badge: "bg-success/15 text-success ring-1 ring-success/30",
        bar: "bg-success",
        text: "success",
        message: "border-success/30 bg-success/10 text-success",
      };
    case "atencao":
      return {
        badge: "bg-warning/15 text-warning ring-1 ring-warning/30",
        bar: "bg-warning",
        text: "warning",
        message: "border-warning/30 bg-warning/10 text-warning",
      };
    case "excedido":
      return {
        badge: "bg-destructive/15 text-destructive ring-1 ring-destructive/30",
        bar: "bg-destructive",
        text: "destructive",
        message: "border-destructive/30 bg-destructive/10 text-destructive",
      };
    default:
      return {
        badge: "bg-card-elevated text-muted-foreground ring-1 ring-border/60",
        bar: "bg-muted-foreground/40",
        text: "muted",
        message: "border-border bg-card-elevated text-muted-foreground",
      };
  }
}
