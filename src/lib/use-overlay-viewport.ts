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
  const originalMaxHeight = node.style.maxHeight;
  const originalHeight = node.style.height;
  let appliedMaxHeight = false;
  let appliedHeight = false;
  const update = () => {
    // Remove only our own override before checking whether native CSS recovered.
    if (appliedMaxHeight) node.style.maxHeight = originalMaxHeight;
    if (appliedHeight) node.style.height = originalHeight;
    appliedMaxHeight = false;
    appliedHeight = false;
    const style = getComputedStyle(node);
    const height = window.visualViewport?.height || window.innerHeight;
    if (style.maxHeight === "0px") {
      const fallback = overlayHeightFallback(node.className, height);
      if (fallback) {
        node.style.maxHeight = fallback;
        appliedMaxHeight = true;
      }
    }
    // Some Android WebViews also resolve an explicit 100dvh panel height to 0px.
    if (style.height === "0px" && /(?:^|\s)h-\[100dvh\](?=\s|$)/.test(node.className) && height > 0) {
      node.style.height = `${height}px`;
      appliedHeight = true;
    }
  };
  update();
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  return () => {
    window.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("resize", update);
    if (appliedMaxHeight) node.style.maxHeight = originalMaxHeight;
    if (appliedHeight) node.style.height = originalHeight;
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
