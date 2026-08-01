import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCookieConsent, type ConsentPreferences } from "@/lib/cookie-consent";

/** Textos locais (PT/EN) — evita depender de novos namespaces de i18n. */
const COPY = {
  pt: {
    title: "Você controla seus dados",
    description:
      "Usamos cookies necessários para o funcionamento do Gasto Inteligente. Com sua autorização, também usamos cookies de análise para entender o uso da plataforma e cookies de marketing para medir nossas campanhas. Você pode alterar sua escolha a qualquer momento.",
    acceptAll: "Aceitar todos",
    rejectOptional: "Recusar opcionais",
    customize: "Personalizar",
    savePrefs: "Salvar preferências",
    close: "Fechar",
    necessary: "Necessários",
    necessaryDesc:
      "Autenticação, segurança, sessão e preferências essenciais. Sempre ativos e não podem ser desativados.",
    alwaysOn: "Sempre ativos",
    analytics: "Analytics",
    analyticsDesc:
      "Google Analytics — mede o uso da plataforma de forma agregada (analytics_storage).",
    marketing: "Marketing",
    marketingDesc:
      "Preparado para Google Ads — mede campanhas (ad_storage, ad_user_data, ad_personalization).",
    privacy: "Política de Privacidade",
    lgpd: "LGPD",
    prefsLink: "Preferências de cookies",
  },
  en: {
    title: "You control your data",
    description:
      "We use necessary cookies to run Gasto Inteligente. With your permission, we also use analytics cookies to understand platform usage and marketing cookies to measure our campaigns. You can change your choice at any time.",
    acceptAll: "Accept all",
    rejectOptional: "Reject optional",
    customize: "Customize",
    savePrefs: "Save preferences",
    close: "Close",
    necessary: "Necessary",
    necessaryDesc:
      "Authentication, security, session and essential preferences. Always on and cannot be disabled.",
    alwaysOn: "Always on",
    analytics: "Analytics",
    analyticsDesc: "Google Analytics — aggregated platform usage (analytics_storage).",
    marketing: "Marketing",
    marketingDesc:
      "Prepared for Google Ads — campaign measurement (ad_storage, ad_user_data, ad_personalization).",
    privacy: "Privacy Policy",
    lgpd: "LGPD",
    prefsLink: "Cookie preferences",
  },
} as const;

function useCopy() {
  const { i18n } = useTranslation();
  return i18n.language?.startsWith("en") ? COPY.en : COPY.pt;
}

/** Link discreto para reabrir o painel de preferências. */
export function CookiePreferencesLink({ className }: { className?: string }) {
  const { openPanel } = useCookieConsent();
  const copy = useCopy();
  return (
    <button
      type="button"
      onClick={openPanel}
      className={
        className ??
        "inline-flex min-h-[44px] items-center transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      }
    >
      {copy.prefsLink}
    </button>
  );
}

export function CookieConsentBanner() {
  const { preferences, ready, panelOpen, openPanel, closePanel, acceptAll, rejectOptional, save } =
    useCookieConsent();
  const copy = useCopy();
  const titleId = useId();
  const descId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<ConsentPreferences>({ analytics: false, marketing: false });

  const hasChoice = preferences !== null;
  const showBanner = ready && (!hasChoice || panelOpen);

  useEffect(() => {
    if (!panelOpen) return;
    setDraft(preferences ?? { analytics: false, marketing: false });
  }, [panelOpen, preferences]);

  // Foco inicial + Escape (só fecha quando já existe uma escolha salva).
  useEffect(() => {
    if (!showBanner) return;
    const node = containerRef.current;
    node?.querySelector<HTMLElement>("button, [href], input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasChoice) closePanel();
      if (e.key !== "Tab" || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showBanner, hasChoice, closePanel]);

  if (!showBanner) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-3 sm:p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-3xl rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4 sm:p-5"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {copy.title}
        </h2>
        <p id={descId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {copy.description}
        </p>

        {panelOpen && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{copy.necessary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{copy.necessaryDesc}</p>
                </div>
                <div className="flex min-h-[44px] items-center gap-2">
                  <span className="text-xs text-muted-foreground">{copy.alwaysOn}</span>
                  <Switch checked disabled aria-label={copy.necessary} />
                </div>
              </div>
            </div>

            {(
              [
                ["analytics", copy.analytics, copy.analyticsDesc],
                ["marketing", copy.marketing, copy.marketingDesc],
              ] as const
            ).map(([key, label, desc]) => (
              <div key={key} className="rounded-xl border border-border/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <div className="flex min-h-[44px] items-center">
                    <Switch
                      checked={draft[key]}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                      aria-label={label}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <Link to="/privacidade" className="min-h-[44px] items-center underline sm:min-h-0">
              {copy.privacy}
            </Link>
            <Link to="/lgpd" className="min-h-[44px] items-center underline sm:min-h-0">
              {copy.lgpd}
            </Link>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {panelOpen ? (
              <Button className="min-h-[44px]" onClick={() => save(draft)}>
                {copy.savePrefs}
              </Button>
            ) : (
              <Button variant="outline" className="min-h-[44px]" onClick={openPanel}>
                {copy.customize}
              </Button>
            )}
            <Button variant="outline" className="min-h-[44px]" onClick={rejectOptional}>
              {copy.rejectOptional}
            </Button>
            <Button className="min-h-[44px]" onClick={acceptAll}>
              {copy.acceptAll}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
