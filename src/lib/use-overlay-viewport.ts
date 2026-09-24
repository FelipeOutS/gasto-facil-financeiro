import { useCallback, useRef, type ForwardedRef } from "react";

/** Resolve only the explicit viewport max-height used by overlay primitives.
 * Keep the caller's 90vh/85vh cap and rem spacing, rather than changing layout. */
export function overlayHeightFallback(className: string, height: number): string | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  const value = [...className.matchAll(/(?:^|\s)max-h-\[([^\]]+)\]/g)].at(-1)?.[1];
  if (!value || !/\d(?:d|s|l)?vh\b/.test(value)) return null;
  return value
    .replace(/_/g, " ")
    .replace(/(\d+(?:\.\d+)?)(?:d|s|l)?vh\b/g, (_, n) => `${(height * Number(n)) / 100}px`)
    .replace(/px([+-])/g, "px $1 ");
}

/** WebView can report 0px for viewport CSS units while visualViewport is valid.
 * Install on the actual portalled panel, and release listeners on unmount. */
export function watchOverlayViewport(node: HTMLElement): () => void {
  const original = node.style.maxHeight;
  let applied = false;
  const update = () => {
    // Remove only our own override before checking whether native CSS recovered.
    if (applied) node.style.maxHeight = original;
    applied = false;
    if (getComputedStyle(node).maxHeight !== "0px") return;
    const height = window.visualViewport?.height || window.innerHeight;
    const fallback = overlayHeightFallback(node.className, height);
    if (fallback) {
      node.style.maxHeight = fallback;
      applied = true;
    }
  };
  update();
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  return () => {
    window.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("resize", update);
    if (applied) node.style.maxHeight = original;
  };
}

export function useOverlayViewportRef<T extends HTMLElement>(forwardedRef: ForwardedRef<T>) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (node: T | null) => {
      cleanup.current?.();
      cleanup.current = node ? watchOverlayViewport(node) : undefined;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
}
