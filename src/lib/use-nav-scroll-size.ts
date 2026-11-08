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
    let settle: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setCompact = (value: boolean) => {
      const next = String(value);
      if (nav.dataset.compact !== next) nav.dataset.compact = next;
    };
    const expand = () => { setCompact(false); accumulated = 0; };
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
        if (Math.abs(accumulated) >= 36) {
          setCompact(accumulated > 0);
          accumulated = 0;
        }
      }
      previous = y;
    };
    const schedule = () => {
      clearTimeout(settle);
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Keep the scroll path free of layout reads, DOM queries and width changes.
    // Preserve direction hysteresis, but morph the glass only after scrolling rests.
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      accumulated = nextNavScroll(previous, accumulated, y);
      previous = y;
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      frame = 0;
      settle = setTimeout(schedule, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    reduced.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
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
