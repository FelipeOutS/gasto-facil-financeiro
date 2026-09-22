import { useLayoutEffect, useRef } from "react";

/** Visual only: routing owns selection; interruptions start at the rendered position. */
export function useLiquidNavIndicator(selected: number) {
  const ref = useRef<HTMLLIElement>(null);
  const previous = useRef(selected);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const node = ref.current;
    const pill = node?.firstElementChild as HTMLElement | null;
    const fromIndex = previous.current;
    previous.current = selected;
    if (!node || !pill) return;
    const running = animations.current.some((a) => a.playState === "running");
    const step = node.getBoundingClientRect().width;
    const from = running
      ? new DOMMatrixReadOnly(getComputedStyle(node).transform).m41
      : Math.max(0, fromIndex) * step;
    const initialScale = running ? new DOMMatrixReadOnly(getComputedStyle(pill).transform).a : 1;
    animations.current.forEach((a) => a.cancel());
    animations.current = [];
    if (
      selected < 0 ||
      fromIndex < 0 ||
      selected === fromIndex ||
      !step ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !node.animate
    )
      return;

    const to = selected * step;
    const distance = to - from;
    const stretch = 1 + Math.min(0.52, (Math.abs(distance) / Math.max(1, pill.offsetWidth)) * 0.14);
    const overshoot = Math.sign(distance) * Math.min(3, Math.abs(distance) * 0.025);
    const duration = 320 + Math.min(60, (Math.abs(distance) / step) * 15);
    animations.current = [
      node.animate(
        [
          { transform: `translate3d(${from}px,0,0)`, offset: 0 },
          { transform: `translate3d(${from + distance * 0.18}px,0,0)`, offset: 0.24 },
          { transform: `translate3d(${to + overshoot}px,0,0)`, offset: 0.8 },
          { transform: `translate3d(${to}px,0,0)`, offset: 1 },
        ],
        { duration, easing: "cubic-bezier(.2,.75,.25,1)" },
      ),
      pill.animate(
        [
          { transform: `scaleX(${initialScale})`, offset: 0 },
          { transform: `scaleX(${stretch})`, offset: 0.24 },
          { transform: "scaleX(1.02)", offset: 0.8 },
          { transform: "scaleX(1)", offset: 1 },
        ],
        { duration, easing: "cubic-bezier(.2,.75,.25,1)" },
      ),
    ];
  }, [selected]);

  useLayoutEffect(() => {
    const stop = () => {
      animations.current.forEach((a) => a.cancel());
      animations.current = [];
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.addEventListener("change", stop);
    // Rotation/resize snaps to the percentage-based route position.
    window.addEventListener("resize", stop);
    return () => {
      stop();
      reduced.removeEventListener("change", stop);
      window.removeEventListener("resize", stop);
    };
  }, []);
  return ref;
}
