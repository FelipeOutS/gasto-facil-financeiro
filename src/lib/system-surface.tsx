import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";

export type SystemSurface = "inherit" | "dark" | "light" | "brand";

type AndroidSystemUiBridge = {
  getInsets?: () => string;
  setSurface?: (surface: Exclude<SystemSurface, "inherit">) => void;
};

declare global {
  interface Window {
    AndroidSystemUi?: AndroidSystemUiBridge;
  }
}

const SystemSurfaceContext = createContext<(surface: SystemSurface) => () => void>(() => () => {});
const SURFACE_COLORS = { dark: "#101214", light: "#FAFAFB", brand: "#820AD1" } as const;

export function SystemSurfaceProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const nextId = useRef(0);
  const [overrides, setOverrides] = useState<Array<{ id: number; surface: SystemSurface }>>([]);
  const requested = overrides[overrides.length - 1]?.surface ?? "inherit";
  const surface = requested === "inherit" ? resolved : requested;

  useEffect(() => {
    const updateViewport = () => {
      document.documentElement.style.setProperty(
        "--app-viewport-height",
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    };
    const updateInsets = () => {
      try {
        const value = JSON.parse(window.AndroidSystemUi?.getInsets?.() ?? "{}") as { top?: number; bottom?: number };
        for (const edge of ["top", "bottom"] as const) {
          const inset = value[edge];
          if (typeof inset === "number" && Number.isFinite(inset) && inset >= 0 && inset < 200) {
            document.documentElement.style.setProperty(`--android-safe-${edge}`, `${inset}px`);
          }
        }
      } catch {
        // Browser and older APKs use CSS env() without the native bridge.
      }
    };
    updateViewport();
    updateInsets();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("android-system-insets", updateInsets);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("android-system-insets", updateInsets);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.systemSurface = surface;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = SURFACE_COLORS[surface];
    window.AndroidSystemUi?.setSurface?.(surface);
  }, [surface]);

  const register = useCallback((override: SystemSurface) => {
    const id = ++nextId.current;
    setOverrides((current) => [...current, { id, surface: override }]);
    return () => setOverrides((current) => current.filter((entry) => entry.id !== id));
  }, []);

  return <SystemSurfaceContext.Provider value={register}>{children}</SystemSurfaceContext.Provider>;
}

/** Optional, scoped override; unmounting restores the previous surface. */
export function useSystemSurfaceOverride(surface: SystemSurface) {
  const register = useContext(SystemSurfaceContext);
  useEffect(() => register(surface), [register, surface]);
}
