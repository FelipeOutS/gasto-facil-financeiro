import * as React from "react";
import { useTranslation } from "react-i18next";
import { MapPin, AlertTriangle, RefreshCw } from "lucide-react";
import { useGoogleMaps, type MapMarkerInput } from "@/hooks/use-google-maps";
import { cn } from "@/lib/utils";

export type GoogleMapViewHandle = {
  panTo: (lat: number, lng: number, zoom?: number) => void;
};

export type GoogleMapViewProps = {
  height?: string | number;
  className?: string;
  markers?: MapMarkerInput[];
};

export const GoogleMapView = React.forwardRef<
  GoogleMapViewHandle,
  GoogleMapViewProps
>(function GoogleMapView({ height = 320, className, markers }, ref) {
  const { t } = useTranslation("mercado");
  const { state, containerRef, init, setMarkers, panTo } = useGoogleMaps();

  React.useEffect(() => {
    if (state.status === "idle") init();
  }, [state.status, init]);

  React.useEffect(() => {
    if (state.status === "loaded") {
      setMarkers(markers ?? []);
    }
  }, [state.status, markers, setMarkers]);

  React.useImperativeHandle(ref, () => ({ panTo }), [panTo]);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  if (state.status === "loading") {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-3xl border border-dashed border-border/60 bg-card/60",
          className,
        )}
        style={{ height: heightStyle }}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <MapPin className="h-6 w-6 animate-bounce" />
          <p className="text-sm font-medium">{t("map.loading")}</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    const isKeyMissing =
      typeof state.message === "string" &&
      state.message.toLowerCase().includes("chave");

    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-destructive/40 bg-card/60 p-6 text-center",
          className,
        )}
        style={{ height: heightStyle }}
        role="alert"
        aria-live="polite"
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h3 className="text-sm font-semibold text-foreground">
          {isKeyMissing ? t("map.keyMissingTitle") : t("map.loadErrorTitle")}
        </h3>
        <p className="max-w-xs text-sm text-muted-foreground">
          {isKeyMissing
            ? t("map.keyMissingDescription")
            : t("map.loadErrorDescription")}
        </p>
        <button
          type="button"
          onClick={init}
          className="inline-flex items-center gap-1.5 rounded-full bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground ring-1 ring-border/60 transition-colors hover:bg-card"
        >
          <RefreshCw className="h-4 w-4" />
          {t("map.tryAgain")}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-3xl border border-border/60 bg-card overflow-hidden",
        className,
      )}
      style={{ height: heightStyle }}
      aria-label={t("map.loading")}
    />
  );
});
