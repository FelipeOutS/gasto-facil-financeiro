import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, RefreshCw, Lock, ArrowRight, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { usePlan } from "@/lib/use-plan";
import { findPremiumRule, premiumDescription } from "@/lib/premium-routes";
import { getMonthlySmartSummary } from "@/lib/finance-ai.functions";
import { cn } from "@/lib/utils";

type Props = {
  mes: number;
  ano: number;
  className?: string;
};

export function SmartMonthSummaryCard({ mes, ano, className }: Props) {
  const { t, i18n } = useTranslation("dashboard");
  const plan = usePlan();
  const navigate = useNavigate();
  const fetchSummary = useServerFn(getMonthlySmartSummary);
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);

  const allowed = !plan.loading && plan.can("gasto_ai");
  const rule = findPremiumRule("/gasto-ai");

  async function load() {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const lang = i18n.language?.toLowerCase().startsWith("en") ? "en" : "pt";
      const res = await fetchSummary({ data: { mes, ano, lang } });
      if (res?.error) {
        setError(res.error.message || t("smartSummary.errorFallback"));
      } else {
        setReply(res.reply);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("smartSummary.errorFallback");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Carrega automaticamente ao montar / quando o mês muda
  useEffect(() => {
    if (!allowed) return;
    setReply(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, mes, ano]);

  function handlePerguntar() {
    if (!allowed) {
      setLockOpen(true);
      return;
    }
    void navigate({
      to: "/gasto-ai",
      search: { q: t("smartSummary.suggestion") } as Record<string, unknown>,
    });
  }

  return (
    <section
      className={cn(
        "relative flex w-full flex-col overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-amber-100/10 p-3.5 shadow-card sm:p-4",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
              {t("smartSummary.eyebrow")}
            </p>
            <h2 className="mt-0.5 text-sm font-bold tracking-tight sm:text-base">
              {t("smartSummary.title")}
            </h2>
          </div>
        </div>
        {allowed && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={t("smartSummary.regenerate")}
            title={t("smartSummary.regenerate")}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        )}
      </div>

      <div className="relative mt-3">
        {!allowed ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/60 p-4">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 text-primary" />
              <p className="text-sm text-foreground/80">
                <Trans
                  i18nKey="smartSummary.locked"
                  t={t}
                  components={[
                    <strong key="0" />,
                    <span key="1" />,
                    <strong key="2" />,
                    <span key="3" />,
                    <strong key="4" />,
                  ]}
                />
              </p>
            </div>
            <Button
              onClick={() => setLockOpen(true)}
              className="w-full rounded-2xl bg-brand-grad sm:w-auto"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t("smartSummary.unlock")}
            </Button>
          </div>
        ) : loading && !reply ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("smartSummary.analyzing")}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-sm font-medium text-foreground/90">
              {t("smartSummary.unavailableTitle", {
                defaultValue: "Resumo temporariamente indisponível",
              })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("smartSummary.unavailableBody", {
                defaultValue: "Aguarde alguns instantes e tente novamente.",
              })}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              {t("smartSummary.retry")}
            </button>
          </div>
        ) : reply ? (
          <div className="ai-markdown text-sm leading-relaxed text-foreground/90">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("smartSummary.empty")}</p>
        )}
      </div>

      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-muted-foreground">{t("smartSummary.tagline")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePerguntar}
          className="rounded-full border-primary/30 bg-card/70 text-foreground hover:bg-accent"
        >
          {t("smartSummary.askAi")}
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>

      {rule && (
        <PremiumLockModal
          open={lockOpen}
          onOpenChange={setLockOpen}
          title={rule.title}
          description={premiumDescription(rule)}
        />
      )}
    </section>
  );
}
