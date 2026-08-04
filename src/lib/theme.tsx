import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "gf-theme";

type ThemeContextValue = {
  theme: ThemeChoice;
  resolved: ResolvedTheme;
  setTheme: (t: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* noop */
  }
  return "dark";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: ThemeChoice): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

const THEME_COLOR_DARK = "#1E2126";
const THEME_COLOR_LIGHT = "#FAFAFB";

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
    root.style.colorScheme = "dark";
  }
  // Sincroniza a meta theme-color para o WebView/Android pintar a status
  // bar e o overscroll inferior com a cor real do fundo do app.
  try {
    const color = resolved === "light" ? THEME_COLOR_LIGHT : THEME_COLOR_DARK;
    let meta = document.querySelector(
      'meta[name="theme-color"]:not([media])',
    ) as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  } catch {
    /* noop */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("dark");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readStored();
    const r = resolve(stored);
    setThemeState(stored);
    setResolved(r);
    applyTheme(r);
  }, []);

  // Watch system changes when in system mode
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r: ResolvedTheme = mql.matches ? "dark" : "light";
      setResolved(r);
      applyTheme(r);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (t: ThemeChoice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* noop */
    }
    const r = resolve(t);
    setThemeState(t);
    setResolved(r);
    applyTheme(r);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback when used outside provider (e.g. SSR)
    return {
      theme: "dark" as ThemeChoice,
      resolved: "dark" as ResolvedTheme,
      setTheme: () => {},
    };
  }
  return ctx;
}
