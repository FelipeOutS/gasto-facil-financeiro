import * as React from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import {
  MapPin,
  Loader2,
  Compass,
  AlertTriangle,
  Plus,
  ExternalLink,
  Store,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GoogleMapView,
  type GoogleMapViewHandle,
} from "@/components/mercado/GoogleMapView";
import { searchNearbyMarkets, type NearbyMarket } from "@/lib/mercado/nearby-markets.functions";
import { addMercadoLocal } from "@/lib/mercado/mercados-store";
import type { MapMarkerInput } from "@/hooks/use-google-maps";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "searching" }
  | { kind: "ok"; markets: NearbyMarket[]; userPos: { lat: number; lng: number } }
  | { kind: "empty"; userPos: { lat: number; lng: number } }
  | { kind: "denied" }
  | { kind: "error"; reason: "geolocation" | "request" };

export function NearbyMarkets() {
  const { t } = useTranslation("mercado");
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const mapRef = React.useRef<GoogleMapViewHandle>(null);
  const search = useServerFn(searchNearbyMarkets);

  const runSearch = React.useCallback(
    async (lat: number, lng: number) => {
      setStatus({ kind: "searching" });
      try {
        const res = await search({
          data: { latitude: lat, longitude: lng, radiusMeters: 2500 },
        });
        if (res.error || !res.markets) {
          setStatus({ kind: "error", reason: "request" });
          return;
        }
        if (res.markets.length === 0) {
          setStatus({ kind: "empty", userPos: { lat, lng } });
          return;
        }
        setStatus({ kind: "ok", markets: res.markets, userPos: { lat, lng } });
      } catch {
        setStatus({ kind: "error", reason: "request" });
      }
    },
    [search],
  );

  const requestLocation = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus({ kind: "error", reason: "geolocation" });
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void runSearch(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus({ kind: "denied" });
        } else {
          setStatus({ kind: "error", reason: "geolocation" });
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  }, [runSearch]);

  const markers = React.useMemo<MapMarkerInput[]>(() => {
    if (status.kind !== "ok") return [];
    return status.markets
      .filter(
        (m): m is NearbyMarket & { latitude: number; longitude: number } =>
          typeof m.latitude === "number" && typeof m.longitude === "number",
      )
      .map((m) => ({
        id: m.placeId,
        latitude: m.latitude,
        longitude: m.longitude,
        title: m.name,
        onClick: () => setSelectedId(m.placeId),
      }));
  }, [status]);

  const handleSelect = (m: NearbyMarket) => {
    setSelectedId(m.placeId);
    if (typeof m.latitude === "number" && typeof m.longitude === "number") {
      mapRef.current?.panTo(m.latitude, m.longitude, 16);
    }
  };

  const handleAdd = (m: NearbyMarket) => {
    const created = addMercadoLocal({
      nome: m.name,
      endereco: m.address ?? undefined,
    });
    if (!created) {
      toast.error(t("nearby.errorTitle"));
      return;
    }
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.add(m.placeId);
      return next;
    });
    toast.success(t("nearby.added"));
  };

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card-elevated p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Compass className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold md:text-lg">
            {t("nearby.title")}
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {t("nearby.description")}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <GoogleMapView ref={mapRef} height={260} markers={markers} />
      </div>

      {status.kind === "idle" && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs leading-snug text-muted-foreground">
            {t("nearby.locationPrivacy")}
          </p>
          <Button
            type="button"
            onClick={requestLocation}
            className="min-h-11 self-start rounded-full font-semibold"
          >
            <MapPin className="h-4 w-4" />
            {t("nearby.useLocation")}
          </Button>
        </div>
      )}

      {(status.kind === "locating" || status.kind === "searching") && (
        <div
          className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("nearby.loading")}
        </div>
      )}

      {status.kind === "denied" && (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("nearby.permissionDeniedTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("nearby.permissionDenied")}
              </p>
            </div>
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-card p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("nearby.errorTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("nearby.error")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={requestLocation}
            className="min-h-11 self-start rounded-full"
          >
            {t("nearby.retry")}
          </Button>
        </div>
      )}

      {status.kind === "empty" && (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          {t("nearby.empty")}
        </div>
      )}

      {status.kind === "ok" && (
        <ul className="mt-4 flex flex-col gap-2">
          {status.markets.map((m) => {
            const selected = selectedId === m.placeId;
            const saved = savedIds.has(m.placeId);
            return (
              <li
                key={m.placeId}
                className={
                  "rounded-2xl border bg-card p-3 transition-colors " +
                  (selected
                    ? "border-brand/60 ring-1 ring-brand/40"
                    : "border-border/60")
                }
              >
                <button
                  type="button"
                  onClick={() => handleSelect(m)}
                  className="flex w-full items-start gap-3 text-left"
                  aria-label={t("nearby.selectMarket", { name: m.name })}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
                    <Store className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.name}</p>
                    {m.address && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {m.address}
                      </p>
                    )}
                    {typeof m.rating === "number" && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                        {m.rating.toFixed(1)}
                        {typeof m.userRatingCount === "number" &&
                          ` · ${m.userRatingCount}`}
                      </p>
                    )}
                  </div>
                </button>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleAdd(m)}
                    disabled={saved}
                    className="min-h-10 rounded-full"
                  >
                    <Plus className="h-4 w-4" />
                    {saved ? t("nearby.added") : t("nearby.addMarket")}
                  </Button>
                  {m.googleMapsUri && (
                    <a
                      href={m.googleMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-card-elevated"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("nearby.openInMaps")}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
