import { useEffect, useState } from "react";

/** VisualViewport covers browsers; innerHeight also covers Android adjustResize.
 * Only a focused editable field plus a substantial height loss hides navigation.
 * Scroll/pinch zoom alone must never turn the first tap into a reveal gesture.
 */
export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let baseline = window.visualViewport?.height ?? window.innerHeight;
    let frame = 0;
    const check = () => {
      const viewport = window.visualViewport;
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      const target = document.activeElement;
      const editing =
        target instanceof HTMLElement &&
        (target.matches("textarea, [contenteditable='true']") ||
          (target instanceof HTMLInputElement &&
            ![
              "button",
              "submit",
              "reset",
              "checkbox",
              "radio",
              "range",
              "color",
              "file",
              "hidden",
            ].includes(target.type)));
      if (!editing) baseline = Math.max(baseline, height);
      setOpen(editing && baseline - height > 120);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const rotate = () => {
      baseline = window.visualViewport?.height ?? window.innerHeight;
      schedule();
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", rotate);
    window.visualViewport?.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", rotate);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, []);
  return open;
}
