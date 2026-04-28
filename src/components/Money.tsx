import { useCountUp } from "@/hooks/use-count-up";
import { formatBRL } from "@/lib/format";

/**
 * Animated currency display. Counts from 0 up to `value` on mount, and tweens
 * smoothly when `value` changes. Respects prefers-reduced-motion.
 */
export function Money({
  value,
  duration = 700,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const v = useCountUp(value, duration);
  return <span className={className}>{formatBRL(v)}</span>;
}

/** Animated raw number (no currency formatting). */
export function CountNumber({
  value,
  duration = 700,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const v = useCountUp(value, duration);
  return <span className={className}>{Math.round(v).toLocaleString("pt-BR")}</span>;
}
