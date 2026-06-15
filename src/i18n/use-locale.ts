import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { LANG_STORAGE_KEY, isLocale, type Locale } from "./index";

function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && value.toLowerCase().startsWith("en") ? "en" : "pt";
}

/**
 * Aplica `next` em i18next + localStorage somente quando o valor realmente mudou,
 * evitando disparar `languageChanged` em loop quando o idioma já é o atual.
 */
function applyLocale(i18nInstance: { language?: string; resolvedLanguage?: string; changeLanguage: (l: string) => Promise<unknown> }, next: Locale) {
  const currentNormalized = normalizeLocale(i18nInstance.resolvedLanguage || i18nInstance.language);
  if (currentNormalized === next) return;
  void i18nInstance.changeLanguage(next);
  try {
    if (window.localStorage.getItem(LANG_STORAGE_KEY) !== next) {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    }
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Sincroniza o idioma entre: URL search param (?lang=) ↔ i18next ↔ localStorage ↔ <html lang>.
 * Sem parâmetro explícito, mantém o idioma determinístico usado no SSR. Ler a
 * preferência local em um efeito pode ocorrer antes de chunks lazy terminarem
 * de hidratar e produzir textos diferentes dentro da mesma árvore.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const searchRaw = useSearch({ strict: false }) as { lang?: string } | undefined;
  const langParam = searchRaw?.lang;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const current: Locale = normalizeLocale(i18n.resolvedLanguage || i18n.language);

  // URL → i18n (depende apenas do search param; `i18n` é singleton estável e fica fora do array)
  useEffect(() => {
    if (isLocale(langParam)) {
      applyLocale(i18n, langParam);
      return;
    }
    // i18n é singleton; intencionalmente fora das deps para não re-disparar este efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langParam]);

  // i18n → <html lang> + localStorage (só escreve se mudou)
  useEffect(() => {
    if (typeof document !== "undefined") {
      const next = current === "en" ? "en" : "pt-BR";
      if (document.documentElement.lang !== next) {
        document.documentElement.lang = next;
      }
    }
    try {
      if (window.localStorage.getItem(LANG_STORAGE_KEY) !== current) {
        window.localStorage.setItem(LANG_STORAGE_KEY, current);
      }
    } catch {
      // ignore quota / private mode
    }
  }, [current]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === current) return;
      applyLocale(i18n, next);
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
