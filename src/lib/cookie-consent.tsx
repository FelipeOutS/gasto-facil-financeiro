import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Consentimento de cookies (LGPD) + Google Consent Mode v2 — modo BÁSICO.
 *
 * Regras invioláveis desta implementação:
 * - o GTM (gtm.js) NÃO é injetado antes de uma escolha explícita do visitante;
 * - nenhum dado é enviado ao Google antes da autorização;
 * - o GTM só é carregado quando Analytics OU Marketing estiverem concedidos;
 * - nenhum dado pessoal ou financeiro entra no cookie ou no dataLayer.
 */

export const CONSENT_COOKIE_NAME = "gi_cookie_consent_v1";
export const CONSENT_COOKIE_MAX_AGE_DAYS = 180;
export const GTM_CONTAINER_ID = "GTM-MCF5CMWP";

const GTM_SCRIPT_ID = "gi-gtm-script";

export type ConsentPreferences = {
  analytics: boolean;
  marketing: boolean;
};

type ConsentContextValue = {
  /** null = visitante ainda não escolheu (ou ainda não hidratou). */
  preferences: ConsentPreferences | null;
  /** true depois da hidratação — evita divergência SSR/cliente. */
  ready: boolean;
  /** Painel de personalização aberto. */
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  acceptAll: () => void;
  rejectOptional: () => void;
  save: (prefs: ConsentPreferences) => void;
  revoke: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

/* ------------------------------------------------------------------ cookie */

function isSecureContextHost() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Serializa apenas booleanos: "a1m0". Nenhum dado pessoal. */
export function serializePreferences(prefs: ConsentPreferences): string {
  return `a${prefs.analytics ? 1 : 0}m${prefs.marketing ? 1 : 0}`;
}

export function parsePreferences(raw: string | null): ConsentPreferences | null {
  if (!raw) return null;
  const m = /^a([01])m([01])$/.exec(raw.trim());
  if (!m) return null;
  return { analytics: m[1] === "1", marketing: m[2] === "1" };
}

function writeConsentCookie(prefs: ConsentPreferences) {
  if (typeof document === "undefined") return;
  const parts = [
    `${CONSENT_COOKIE_NAME}=${encodeURIComponent(serializePreferences(prefs))}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${CONSENT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}`,
  ];
  if (isSecureContextHost()) parts.push("Secure");
  document.cookie = parts.join("; ");
}

function deleteConsentCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

/** Remove cookies não essenciais conhecidos (Google Analytics/Ads). */
function clearKnownNonEssentialCookies() {
  if (typeof document === "undefined") return;
  const host = window.location.hostname;
  const domains = [undefined, host, `.${host}`, `.${host.split(".").slice(-3).join(".")}`];
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter((n) => /^(_ga|_gid|_gat|_gcl|__gads|_gac)/.test(n));
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}

/* ------------------------------------------------------- consent mode / gtm */

type DataLayerWindow = Window & { dataLayer?: unknown[] };

function pushDataLayer(args: unknown[]) {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(arguments.length ? args : args);
}

/** gtag() no formato exigido pelo Consent Mode (arguments-like). */
function gtag(...args: unknown[]) {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(args);
}

/** Estados negados por padrão — aplicados ANTES de qualquer tag. */
export function applyConsentState(prefs: ConsentPreferences) {
  if (typeof window === "undefined") return;
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    security_storage: "granted",
    functionality_storage: "granted",
    personalization_storage: "denied",
    wait_for_update: 500,
  });
  gtag("consent", "update", {
    analytics_storage: prefs.analytics ? "granted" : "denied",
    ad_storage: prefs.marketing ? "granted" : "denied",
    ad_user_data: prefs.marketing ? "granted" : "denied",
    ad_personalization: prefs.marketing ? "granted" : "denied",
    security_storage: "granted",
  });
}

function loadGtmOnce() {
  if (typeof document === "undefined") return;
  if (document.getElementById(GTM_SCRIPT_ID)) return;
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.id = GTM_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_CONTAINER_ID}`;
  document.head.appendChild(script);
}

/** Aplica consentimento e carrega o GTM apenas se alguma categoria opcional foi concedida. */
export function applyConsentAndMaybeLoadGtm(prefs: ConsentPreferences) {
  applyConsentState(prefs);
  if (prefs.analytics || prefs.marketing) loadGtmOnce();
}

/* ------------------------------------------------------------------ provider */

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ConsentPreferences | null>(null);
  const [ready, setReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const stored = parsePreferences(readCookie(CONSENT_COOKIE_NAME));
    setPreferences(stored);
    setReady(true);
    if (stored) applyConsentAndMaybeLoadGtm(stored);
  }, []);

  const persist = useCallback((prefs: ConsentPreferences) => {
    writeConsentCookie(prefs);
    setPreferences(prefs);
    setPanelOpen(false);
    if (!prefs.analytics && !prefs.marketing) {
      applyConsentState(prefs);
      clearKnownNonEssentialCookies();
      // Se o GTM já estava carregado nesta sessão, recarregar garante
      // que nenhuma tag continue ativa após a revogação.
      if (document.getElementById(GTM_SCRIPT_ID)) window.location.reload();
      return;
    }
    applyConsentAndMaybeLoadGtm(prefs);
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      preferences,
      ready,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      acceptAll: () => persist({ analytics: true, marketing: true }),
      rejectOptional: () => persist({ analytics: false, marketing: false }),
      save: persist,
      revoke: () => {
        deleteConsentCookie();
        clearKnownNonEssentialCookies();
        setPreferences(null);
        setPanelOpen(false);
        if (typeof document !== "undefined" && document.getElementById(GTM_SCRIPT_ID)) {
          window.location.reload();
        }
      },
    }),
    [preferences, ready, panelOpen, persist],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useCookieConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) {
    throw new Error("useCookieConsent deve ser usado dentro de <CookieConsentProvider>");
  }
  return ctx;
}

// Evita "unused" caso pushDataLayer não seja usado externamente.
void pushDataLayer;
