import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";

const ease = [0.23, 1, 0.32, 1] as const;

/** The active panel keeps its natural height. Only its outer viewport interpolates.
 * No exit queue, overlapping text, fixed maximum height or temporarily empty panel.
 */
export function FeatureCollection({ id, title, items, className = "" }: {
  id: string;
  title: string;
  items: { label: string; content: ReactNode }[];
  className?: string;
}) {
  const [selected, setSelected] = useState(0);
  const [height, setHeight] = useState<number>();
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const instant = useRef(true);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const panel = panels.current[selected];
    if (!panel) return;
    const measure = () => setHeight(Math.ceil(panel.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    const animation = !reduce && !instant.current
      ? panel.animate([
          { opacity: 0.65, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" })
      : undefined;
    return () => { observer.disconnect(); animation?.cancel(); };
  }, [selected, reduce]);

  function select(index: number, immediate: boolean) {
    instant.current = immediate;
    setSelected(index);
  }

  return (
    <section id={id} className={`gi-collection ${className}`}>
      <div className="gi-collection-heading">
        <h2>{title}</h2>
        <div role="tablist" aria-label={title} className="gi-collection-tabs">
          {items.map((item, index) => (
            <button key={index} type="button" role="tab" id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel-${index}`} aria-selected={selected === index}
              tabIndex={selected === index ? 0 : -1}
              onClick={event => select(index, event.detail === 0)}
              onKeyDown={event => {
                const next = event.key === "ArrowRight" ? (index + 1) % items.length
                  : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
                  : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
                if (next === null) return;
                event.preventDefault();
                select(next, true);
                document.getElementById(`${id}-tab-${next}`)?.focus({ preventScroll: true });
              }}>{item.label}</button>
          ))}
        </div>
      </div>
      <motion.div className="gi-panel-viewport" initial={false}
        animate={{ height: height ?? "auto" }}
        transition={{ duration: reduce || instant.current ? 0 : 0.24, ease }}>
        {items.map((item, index) => (
          <div key={index} ref={node => { panels.current[index] = node; }}
            id={`${id}-panel-${index}`} role="tabpanel" data-collection-panel
            aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={selected !== index}
            className={height === undefined ? "gi-feature-panel" : "gi-feature-panel gi-panel-measured"}>
            {item.content}
          </div>
        ))}
      </motion.div>
    </section>
  );
}
