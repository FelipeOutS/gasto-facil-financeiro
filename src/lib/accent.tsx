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
  /** Foreground color used over a tinted/soft brand surface (for readability). */
  fgOnSoftDark: string;
  fgOnSoftLight: string;
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
    fgOnSoftDark: "oklch(0.985 0 0)",
    fgOnSoftLight: "oklch(0.24 0.01 260)",
  },
  {
    id: "blue",
    label: "Azul",
    swatch: "#3b82f6",
    dark: "oklch(0.7 0.16 250)",
    light: "oklch(0.55 0.18 255)",
    fgDark: "oklch(0.18 0.01 260)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.86 0.08 250)",
    fgOnSoftLight: "oklch(0.4 0.16 255)",
  },
  {
    id: "violet",
    label: "Roxo",
    swatch: "#8b5cf6",
    dark: "oklch(0.72 0.18 295)",
    light: "oklch(0.55 0.22 295)",
    fgDark: "oklch(0.18 0.01 295)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.86 0.1 295)",
    fgOnSoftLight: "oklch(0.4 0.18 295)",
  },
  {
    id: "pink",
    label: "Rosa",
    swatch: "#ec4899",
    dark: "oklch(0.74 0.19 0)",
    light: "oklch(0.6 0.22 0)",
    fgDark: "oklch(0.18 0.01 0)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.88 0.12 0)",
    fgOnSoftLight: "oklch(0.45 0.2 0)",
  },
  {
    id: "amber",
    label: "Amarelo",
    swatch: "#facc15",
    dark: "oklch(0.85 0.16 95)",
    light: "oklch(0.78 0.17 90)",
    fgDark: "oklch(0.2 0.02 95)",
    fgLight: "oklch(0.2 0.02 95)",
    fgOnSoftDark: "oklch(0.92 0.12 95)",
    fgOnSoftLight: "oklch(0.45 0.14 80)",
  },
  {
    id: "cyan",
    label: "Ciano",
    swatch: "#06b6d4",
    dark: "oklch(0.78 0.13 215)",
    light: "oklch(0.62 0.14 220)",
    fgDark: "oklch(0.18 0.01 220)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.88 0.09 215)",
    fgOnSoftLight: "oklch(0.4 0.13 220)",
  },
  {
    id: "orange",
    label: "Laranja",
    swatch: "#fb923c",
    dark: "oklch(0.78 0.16 55)",
    light: "oklch(0.66 0.18 50)",
    fgDark: "oklch(0.2 0.02 55)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.9 0.11 55)",
    fgOnSoftLight: "oklch(0.45 0.16 50)",
  },
  {
    id: "green",
    label: "Verde",
    swatch: "#22c55e",
    dark: "oklch(0.74 0.17 152)",
    light: "oklch(0.58 0.17 152)",
    fgDark: "oklch(0.18 0.01 152)",
    fgLight: "oklch(0.985 0 0)",
    fgOnSoftDark: "oklch(0.88 0.11 152)",
    fgOnSoftLight: "oklch(0.4 0.16 152)",
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

/**
 * Per-accent tint intensity. Cores quentes (amarelo/laranja/rosa) recebem
 * presença menor para não cansar a leitura. Frias / neutras podem ir um
 * pouco mais fortes.
 *
 * Returns intensity (0-1) that we use as a multiplier on the base mix %.
 */
function tintIntensity(id: AccentId): number {
  switch (id) {
    case "amber":
    case "orange":
    case "pink":
      return 0.55; // ~3-5%
    case "blue":
    case "violet":
    case "green":
    case "cyan":
      return 1; // ~6-8%
    case "graphite":
    default:
      return 0.6;
  }
}

function applyAccent(id: AccentId) {
  if (typeof document === "undefined") return;
  const def = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  const isLight = root.classList.contains("light");
  const brand = isLight ? def.light : def.dark;
  const fg = isLight ? def.fgLight : def.fgDark;
  const fgOnSoft = isLight ? def.fgOnSoftLight : def.fgOnSoftDark;
  const intensity = tintIntensity(id);

  // Always-available brand tokens (work for any accent, including graphite)
  root.style.setProperty("--brand", brand);
  root.style.setProperty("--brand-foreground", fg);
  root.style.setProperty("--brand-fg-on-soft", fgOnSoft);

  // Soft surfaces & tints — derived via color-mix so they adapt to theme.
  // For graphite we use neutral mixes (so the UI stays elegant/neutral).
  if (id === "graphite") {
    root.style.setProperty(
      "--brand-soft",
      isLight
        ? "color-mix(in oklab, var(--foreground) 6%, transparent)"
        : "color-mix(in oklab, var(--foreground) 10%, transparent)",
    );
    root.style.setProperty(
      "--brand-tint",
      isLight
        ? "color-mix(in oklab, var(--foreground) 3%, transparent)"
        : "color-mix(in oklab, var(--foreground) 5%, transparent)",
    );
    root.style.setProperty(
      "--brand-border",
      "color-mix(in oklab, var(--foreground) 18%, transparent)",
    );
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
  } else {
    // Base de mistura ajustada por intensidade da cor.
    const softPct = Math.round((isLight ? 14 : 22) * intensity);
    const tintPct = Math.round((isLight ? 8 : 12) * intensity);

    root.style.setProperty(
      "--brand-soft",
      `color-mix(in oklab, ${brand} ${softPct}%, transparent)`,
    );
    root.style.setProperty(
      "--brand-tint",
      `color-mix(in oklab, ${brand} ${tintPct}%, transparent)`,
    );
    root.style.setProperty("--brand-border", `color-mix(in oklab, ${brand} 45%, transparent)`);
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
