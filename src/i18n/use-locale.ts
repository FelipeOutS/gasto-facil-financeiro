import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { LANG_STORAGE_KEY, isLocale, type Locale } from "./index";

function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && value.toLowerCase().startsWith("en") ? "en" : "pt";
}

/**
 * Sincroniza o idioma entre: URL search param (?lang=) ↔ i18next ↔ localStorage ↔ <html lang>.
 * O search param é a fonte primária quando presente; localStorage é o fallback persistente.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { lang?: string };
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const current: Locale = normalizeLocale(i18n.resolvedLanguage || i18n.language);

  // URL → i18n
  useEffect(() => {
    const fromUrl = search.lang;
    if (isLocale(fromUrl)) {
      if (fromUrl !== normalizeLocale(i18n.resolvedLanguage || i18n.language)) void i18n.changeLanguage(fromUrl);
      return;
    }
    // Sem ?lang= na URL: aplica fallback persistente (localStorage > navegador)
    // só depois da hidratação para não causar mismatch SSR/cliente.
    try {
      const fromStorage = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (isLocale(fromStorage) && fromStorage !== normalizeLocale(i18n.resolvedLanguage || i18n.language)) {
        void i18n.changeLanguage(fromStorage);
        return;
      }
      const nav = (window.navigator.language || "").toLowerCase();
      const guess: Locale | null = nav.startsWith("en") ? "en" : nav.startsWith("pt") ? "pt" : null;
      if (guess && guess !== normalizeLocale(i18n.resolvedLanguage || i18n.language)) void i18n.changeLanguage(guess);
    } catch {
      // ignore
    }
  }, [search.lang, i18n]);

  // i18n → <html lang> + localStorage
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = current === "en" ? "en" : "pt-BR";
    }
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, current);
    } catch {
      // ignore quota / private mode
    }
  }, [current]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === current) return;
      void i18n.changeLanguage(next);
      try {
        window.localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      // Atualiza o search param na rota atual sem recarregar
      void navigate({
        to: pathname,
        search: (prev: Record<string, unknown>) => ({ ...prev, lang: next }),
        replace: true,
      });
    },
    [current, i18n, navigate, pathname],
  );

  return { locale: current, setLocale };
}
