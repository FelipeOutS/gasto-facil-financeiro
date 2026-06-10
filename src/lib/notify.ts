/**
 * Lean notification wrapper around sonner.
 *
 * Goals:
 * - Centralize tone/duration defaults without touching the global Toaster.
 * - Provide a small, predictable API: success / error / info / warning / action.
 * - Allow gradual adoption — existing `toast.*` calls keep working unchanged.
 *
 * Do NOT change global Sonner config here. Do NOT replace the Toaster.
 */
import { toast, type ExternalToast } from "sonner";

type Options = ExternalToast;

type ActionOptions = Options & {
  actionLabel: string;
  onAction: () => void;
};

const DEFAULTS: Record<"success" | "error" | "info" | "warning", number> = {
  success: 3500,
  error: 5500,
  info: 4000,
  warning: 5000,
};

function merge(kind: keyof typeof DEFAULTS, opts?: Options): Options {
  return { duration: DEFAULTS[kind], ...opts };
}

export const notify = {
  success(message: string, opts?: Options) {
    return toast.success(message, merge("success", opts));
  },
  error(message: string, opts?: Options) {
    return toast.error(message, merge("error", opts));
  },
  info(message: string, opts?: Options) {
    return toast.info(message, merge("info", opts));
  },
  warning(message: string, opts?: Options) {
    return toast.warning(message, merge("warning", opts));
  },
  /**
   * Success-toast with an actionable button (e.g. "Ver gasto").
   * Falls back to a regular success toast if no action handler is provided.
   */
  action(message: string, opts: ActionOptions) {
    const { actionLabel, onAction, ...rest } = opts;
    return toast.success(message, {
      ...merge("success", rest),
      action: {
        label: actionLabel,
        onClick: onAction,
      },
    });
  },
};

export type Notify = typeof notify;
