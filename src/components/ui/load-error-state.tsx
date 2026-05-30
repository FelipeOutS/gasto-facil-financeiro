import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Variant = "default" | "compact";

export interface LoadErrorStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  retryLabel?: React.ReactNode;
  onRetry?: () => void | Promise<void>;
  variant?: Variant;
  className?: string;
}

/**
 * Standardized "couldn't load" state with a friendly message and a
 * "Try again" button. Use ONLY for read/load failures — never for
 * submit/write failures (those stay as toasts).
 */
export function LoadErrorState({
  icon,
  title,
  description,
  retryLabel,
  onRetry,
  variant = "default",
  className,
}: LoadErrorStateProps) {
  const { t } = useTranslation("common");
  const isCompact = variant === "compact";
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = React.useCallback(async () => {
    if (!onRetry || retrying) return;
    try {
      setRetrying(true);
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry, retrying]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center rounded-3xl border border-dashed border-destructive/40 bg-card/60 text-center animate-rise",
        isCompact ? "p-5" : "p-8",
        className,
      )}
    >
      <div
        className={cn(
          "grid place-items-center rounded-2xl bg-destructive/10 text-destructive animate-pop",
          isCompact ? "h-12 w-12" : "h-14 w-14",
        )}
      >
        {icon ?? <AlertTriangle className={isCompact ? "h-5 w-5" : "h-6 w-6"} aria-hidden />}
      </div>
      <h3
        className={cn(
          "mt-3 font-semibold text-foreground",
          isCompact ? "text-sm" : "text-base",
        )}
      >
        {title ?? t("loadError.title")}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description ?? t("loadError.description")}
      </p>
      {onRetry && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="min-h-11 rounded-full font-semibold"
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", retrying && "animate-spin")}
              aria-hidden
            />
            {retryLabel ?? t("loadError.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default LoadErrorState;
