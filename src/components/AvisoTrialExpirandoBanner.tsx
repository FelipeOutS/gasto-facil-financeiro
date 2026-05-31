import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, X } from "lucide-react";
import { usePlan } from "@/lib/use-plan";

/**
 * Banner que avisa o usuário quando o período de teste (trial)
 * está próximo do fim (<=7 dias). Lê o estado canônico via `usePlan()`
 * — não duplica regras de plano.
 *
 * Regras de exibição:
 *  - usePlan().isTrialActive === true (existe trial vigente)
 *  - trialDaysLeft <= 7 e >= 0
 *  - usuário não é Admin Master (usePlan() já zera campos de trial nesse caso)
 *  - banner ainda não foi dispensado nesta janela (chave LS por data de expiração)
 *
 * Dispensar grava no localStorage com a `trialEndsAt` como sufixo,
 * para que o banner volte a aparecer se o usuário renovar o trial no futuro.
 */
const STORAGE_PREFIX = "gi.trial-banner-dismissed-v1:";

export function AvisoTrialExpirandoBanner() {
  const { t, i18n: i18nInst } = useTranslation("dashboard");
  const { isTrialActive, trialDaysLeft, trialEndsAt, isAdminMaster, loading } = usePlan();
  const [dismissed, setDismissed] = useState(false);

  const storageKey = trialEndsAt ? `${STORAGE_PREFIX}${trialEndsAt}` : null;

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  if (loading) return null;
  if (isAdminMaster) return null;
  if (!isTrialActive) return null;
  if (trialDaysLeft < 0 || trialDaysLeft > 7) return null;
  if (dismissed) return null;

  const dismiss = () => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, "1");
      } catch {
        /* ignore */
      }
    }
    setDismissed(true);
  };

  const formattedDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString(i18nInst.language || "pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4 shadow-sm backdrop-blur-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-400/15 blur-3xl"
      />
      <div className="relative flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
          <Clock className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {t("trialBanner.title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("trialBanner.subtitle", { count: trialDaysLeft })}
            {formattedDate ? ` ${t("trialBanner.expiresOn", { date: formattedDate })}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/meu-plano"
              className="inline-flex h-10 min-w-11 items-center justify-center rounded-xl bg-amber-500 px-4 text-sm font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-400"
            >
              {t("trialBanner.cta")}
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-10 min-w-11 items-center justify-center rounded-xl border border-border/60 bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            >
              {t("trialBanner.remindLater")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("trialBanner.close")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
