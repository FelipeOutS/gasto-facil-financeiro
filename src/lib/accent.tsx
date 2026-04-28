import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AccentId =
  | "graphite"
  | "blue"
  | "violet"
  | "pink"
  | "amber"
  | "cyan"
  | "orange"
  | "green";

type AccentDef = {
  id: AccentId;
  label: string;
  /** Swatch shown in the picker (raw hex). */
  swatch: string;
  /** Brand color in OKLCH for dark mode. */
  dark: string;
  /** Brand color in OKLCH for light mode. */
  light: string;
  /** Foreground (text/icon) color over brand surface. */
  fgDark: string;
  fgLight: string;
};

export const ACCENTS: AccentDef[] = [
  {
    id: "graphite",
    label: "Grafite",
    swatch: "#f5f5f5",
    dark: "oklch(0.985 0 0)",
    light: "oklch(0.24 0.01 260)",
    fgDark: "oklch(0.18 0.005 260)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "blue",
    label: "Azul",
    swatch: "#3b82f6",
    dark: "oklch(0.7 0.16 250)",
    light: "oklch(0.55 0.18 255)",
    fgDark: "oklch(0.18 0.01 260)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "violet",
    label: "Roxo",
    swatch: "#8b5cf6",
    dark: "oklch(0.72 0.18 295)",
    light: "oklch(0.55 0.22 295)",
    fgDark: "oklch(0.18 0.01 295)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "pink",
    label: "Rosa",
    swatch: "#ec4899",
    dark: "oklch(0.74 0.19 0)",
    light: "oklch(0.6 0.22 0)",
    fgDark: "oklch(0.18 0.01 0)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "amber",
    label: "Amarelo",
    swatch: "#facc15",
    dark: "oklch(0.85 0.16 95)",
    light: "oklch(0.78 0.17 90)",
    fgDark: "oklch(0.2 0.02 95)",
    fgLight: "oklch(0.2 0.02 95)",
  },
  {
    id: "cyan",
    label: "Ciano",
    swatch: "#06b6d4",
    dark: "oklch(0.78 0.13 215)",
    light: "oklch(0.62 0.14 220)",
    fgDark: "oklch(0.18 0.01 220)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "orange",
    label: "Laranja",
    swatch: "#fb923c",
    dark: "oklch(0.78 0.16 55)",
    light: "oklch(0.66 0.18 50)",
    fgDark: "oklch(0.2 0.02 55)",
    fgLight: "oklch(0.985 0 0)",
  },
  {
    id: "green",
    label: "Verde",
    swatch: "#22c55e",
    dark: "oklch(0.74 0.17 152)",
    light: "oklch(0.58 0.17 152)",
    fgDark: "oklch(0.18 0.01 152)",
    fgLight: "oklch(0.985 0 0)",
  },
];

const STORAGE_KEY = "gf-accent";
const DEFAULT_ACCENT: AccentId = "graphite";

type AccentCtx = {
  accent: AccentId;
  setAccent: (id: AccentId) => void;
};

const Ctx = createContext<AccentCtx | null>(null);

function readStored(): AccentId {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && ACCENTS.some((a) => a.id === v)) return v as AccentId;
  } catch {
    /* noop */
  }
  return DEFAULT_ACCENT;
}

function applyAccent(id: AccentId) {
  if (typeof document === "undefined") return;
  const def = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  const isLight = root.classList.contains("light");
  const brand = isLight ? def.light : def.dark;
  const fg = isLight ? def.fgLight : def.fgDark;
  // Always available token for any custom accent usage
  root.style.setProperty("--brand", brand);
  root.style.setProperty("--brand-foreground", fg);
  // For non-graphite accents, override primary/ring so it propagates
  // through buttons, focus rings, progress, etc.
  if (id === "graphite") {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
  } else {
    root.style.setProperty("--primary", brand);
    root.style.setProperty("--primary-foreground", fg);
    root.style.setProperty("--ring", brand);
  }
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    const stored = readStored();
    setAccentState(stored);
    applyAccent(stored);
    // Re-apply when html.light class toggles (theme change)
    const root = document.documentElement;
    const obs = new MutationObserver(() => applyAccent(stored));
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Re-apply whenever the chosen accent changes (covers theme toggle re-renders)
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const setAccent = (id: AccentId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* noop */
    }
    setAccentState(id);
    applyAccent(id);
  };

  return <Ctx.Provider value={{ accent, setAccent }}>{children}</Ctx.Provider>;
}

export function useAccent(): AccentCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { accent: DEFAULT_ACCENT, setAccent: () => {} };
  return ctx;
}
