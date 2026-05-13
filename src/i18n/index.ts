import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ptCommon from "./locales/pt/common.json";
import ptLanding from "./locales/pt/landing.json";
import ptAuth from "./locales/pt/auth.json";
import ptAccount from "./locales/pt/account.json";
import ptNav from "./locales/pt/nav.json";
import ptDashboard from "./locales/pt/dashboard.json";

import enCommon from "./locales/en/common.json";
import enLanding from "./locales/en/landing.json";
import enAuth from "./locales/en/auth.json";
import enAccount from "./locales/en/account.json";
import enNav from "./locales/en/nav.json";
import enDashboard from "./locales/en/dashboard.json";

export const SUPPORTED_LOCALES = ["pt", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt";
export const LANG_STORAGE_KEY = "gi-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Detects the initial language from URL search > localStorage > browser. */
function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("lang");
    if (isLocale(fromUrl)) return fromUrl;
    // /pt/... or /en/... path prefix
    const seg = url.pathname.split("/").filter(Boolean)[0];
    if (isLocale(seg)) return seg;
    const fromStorage = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLocale(fromStorage)) return fromStorage;
    const nav = (window.navigator.language || "").toLowerCase();
    if (nav.startsWith("pt")) return "pt";
    if (nav.startsWith("en")) return "en";
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

const resources = {
  pt: { common: ptCommon, landing: ptLanding, auth: ptAuth, account: ptAccount, nav: ptNav, dashboard: ptDashboard },
  en: { common: enCommon, landing: enLanding, auth: enAuth, account: enAccount, nav: enNav, dashboard: enDashboard },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: "common",
    ns: ["common", "landing", "auth", "account", "nav", "dashboard"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18n;
