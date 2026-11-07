import { useEffect, useRef } from "react";

/** Hysteresis: tiny reversals never toggle the navigation. */
export function nextNavScroll(previous: number, accumulated: number, current: number) {
  const delta = current - previous;
  return Math.sign(delta) === Math.sign(accumulated) ? accumulated + delta : delta;
}

export function attachNavScrollSize(nav: HTMLElement, keyboardOpen = false) {
    let previous = window.scrollY;
    let accumulated = 0;
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const expand = () => { nav.dataset.compact = "false"; accumulated = 0; };
    expand();
    const update = () => {
      frame = 0;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.max(0, Math.min(window.scrollY, max));
      const blocked = keyboardOpen || nav.hidden || reduced.matches || nav.contains(document.activeElement) ||
        document.activeElement?.matches("input,textarea,select,[contenteditable=true]") ||
        !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], [aria-modal="true"]');
      if (blocked || y <= 16 || max < 64) expand();
      else {
        accumulated = nextNavScroll(previous, accumulated, y);
        if (Math.abs(accumulated) >= 36) {
          nav.dataset.compact = accumulated > 0 ? "true" : "false";
          accumulated = 0;
        }
      }
      previous = y;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    reduced.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      reduced.removeEventListener("change", schedule);
    };
}

export function useNavScrollSize(pathname: string, keyboardOpen: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) return attachNavScrollSize(ref.current, keyboardOpen);
  }, [pathname, keyboardOpen]);
  return ref;
}
