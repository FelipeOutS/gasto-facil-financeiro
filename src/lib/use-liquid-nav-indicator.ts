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
    // Frequent navigation needs immediate feedback, not elastic deformation.
    // Retarget from the rendered position when a second tap interrupts the slide.
    animations.current = [
      node.animate(
        [
          { transform: `translate3d(${from}px,0,0)`, offset: 0 },
          { transform: `translate3d(${to}px,0,0)`, offset: 1 },
        ],
        { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
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
