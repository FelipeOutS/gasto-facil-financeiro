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
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GoogleMapView,
  type GoogleMapViewHandle,
} from "@/components/mercado/GoogleMapView";
import {
  searchNearbyMarkets,
  geocodeMarketSearchLocation,
  type NearbyMarket,
} from "@/lib/mercado/nearby-markets.functions";
import { addMercadoLocal } from "@/lib/mercado/mercados-store";
import type { MapMarkerInput } from "@/hooks/use-google-maps";

type Coords = { lat: number; lng: number };
type RadiusKm = 1 | 2.5 | 5 | 10;
const RADIUS_OPTIONS: RadiusKm[] = [1, 2.5, 5, 10];
const DEFAULT_RADIUS: RadiusKm = 2.5;

type MarketWithDistance = NearbyMarket & { distanceMeters: number | null };

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "geocoding" }
  | { kind: "searching" }
  | {
      kind: "ok";
      markets: MarketWithDistance[];
      userPos: Coords;
      locationLabel: string | null;
    }
  | { kind: "empty"; userPos: Coords; locationLabel: string | null }
  | { kind: "denied" }
  | { kind: "error"; reason: "geolocation" | "request" | "geocode" };

/** Haversine — distância aproximada em metros entre dois pontos. */
function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(
  meters: number,
  t: (k: string, opts?: Record<string, unknown>) => string,
  lang: string,
): string {
  if (meters < 1000) {
    return t("nearby.distanceMeters", { value: Math.round(meters) });
  }
  const km = meters / 1000;
  const formatted = new Intl.NumberFormat(lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(km);
  return t("nearby.distanceKm", { value: formatted });
}

export function NearbyMarkets() {
  const { t, i18n } = useTranslation("mercado");
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const [radius, setRadius] = React.useState<RadiusKm>(DEFAULT_RADIUS);
  const [manualQuery, setManualQuery] = React.useState("");
  const [manualError, setManualError] = React.useState<string | null>(null);
  const mapRef = React.useRef<GoogleMapViewHandle>(null);
  const search = useServerFn(searchNearbyMarkets);
  const geocode = useServerFn(geocodeMarketSearchLocation);

  const runSearch = React.useCallback(
    async (pos: Coords, locationLabel: string | null) => {
      setStatus({ kind: "searching" });
      try {
        const res = await search({
          data: {
            latitude: pos.lat,
            longitude: pos.lng,
            radiusMeters: Math.round(radius * 1000),
          },
        });
        if (res.error || !res.markets) {
          setStatus({ kind: "error", reason: "request" });
          return;
        }
        if (res.markets.length === 0) {
          setStatus({ kind: "empty", userPos: pos, locationLabel });
          return;
        }
        const withDistance: MarketWithDistance[] = res.markets
          .map((m) => ({
            ...m,
            distanceMeters:
              typeof m.latitude === "number" && typeof m.longitude === "number"
                ? haversineMeters(pos, { lat: m.latitude, lng: m.longitude })
                : null,
          }))
          .sort((a, b) => {
            if (a.distanceMeters == null) return 1;
            if (b.distanceMeters == null) return -1;
            return a.distanceMeters - b.distanceMeters;
          });
        setStatus({
          kind: "ok",
          markets: withDistance,
          userPos: pos,
          locationLabel,
        });
      } catch {
        setStatus({ kind: "error", reason: "request" });
      }
    },
    [search, radius],
  );

  const requestLocation = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus({ kind: "error", reason: "geolocation" });
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void runSearch(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          null,
        );
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

  const handleManualSearch = React.useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const query = manualQuery.trim();
      if (query.length < 3) {
        setManualError(t("nearby.invalidSearch"));
        return;
      }
      setManualError(null);
      setStatus({ kind: "geocoding" });
      try {
        const res = await geocode({ data: { query } });
        if (
          res.error ||
          typeof res.latitude !== "number" ||
          typeof res.longitude !== "number"
        ) {
          if (res.error === "no_address_found") {
            setManualError(t("nearby.noAddressFound"));
            setStatus({ kind: "idle" });
            return;
          }
          setStatus({ kind: "error", reason: "geocode" });
          return;
        }
        await runSearch(
          { lat: res.latitude, lng: res.longitude },
          res.formattedAddress,
        );
      } catch {
        setStatus({ kind: "error", reason: "geocode" });
      }
    },
    [manualQuery, geocode, runSearch, t],
  );

  const markers = React.useMemo<MapMarkerInput[]>(() => {
    if (status.kind !== "ok") return [];
    return status.markets
      .filter(
        (m): m is MarketWithDistance & { latitude: number; longitude: number } =>
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

  const isBusy =
    status.kind === "locating" ||
    status.kind === "geocoding" ||
    status.kind === "searching";

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

      {/* Manual search */}
      <form onSubmit={handleManualSearch} className="mt-4 flex flex-col gap-2">
        <label htmlFor="nearby-manual-search" className="text-sm font-medium">
          {t("nearby.manualSearchTitle")}
        </label>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("nearby.manualSearchDescription")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="nearby-manual-search"
            type="text"
            inputMode="search"
            autoComplete="off"
            maxLength={200}
            value={manualQuery}
            onChange={(e) => {
              setManualQuery(e.target.value);
              if (manualError) setManualError(null);
            }}
            placeholder={t("nearby.searchPlaceholder")}
            disabled={isBusy}
            className="min-h-11 flex-1"
          />
          <Button
            type="submit"
            disabled={isBusy || manualQuery.trim().length < 3}
            className="min-h-11 rounded-full font-semibold"
          >
            <Search className="h-4 w-4" />
            {t("nearby.searchButton")}
          </Button>
        </div>
        {manualError && (
          <p className="text-xs text-destructive">{manualError}</p>
        )}
      </form>

      {/* Radius selector */}
      <div className="mt-4">
        <p id="nearby-radius-label" className="text-sm font-medium">
          {t("nearby.radiusLabel")}
        </p>
        <div
          role="radiogroup"
          aria-labelledby="nearby-radius-label"
          className="mt-2 flex flex-wrap gap-2"
        >
          {RADIUS_OPTIONS.map((r) => {
            const active = radius === r;
            const key = r === 2.5 ? "2.5" : String(r);
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={isBusy}
                onClick={() => setRadius(r)}
                className={
                  "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors " +
                  (active
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-card text-foreground hover:bg-card-elevated")
                }
              >
                {t(`nearby.radiusOptions.${key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Use my location */}
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs leading-snug text-muted-foreground">
          {t("nearby.locationPrivacy")}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={requestLocation}
          disabled={isBusy}
          className="min-h-11 self-start rounded-full font-semibold"
        >
          <MapPin className="h-4 w-4" />
          {t("nearby.useLocation")}
        </Button>
      </div>

      {/* Busy states */}
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

      {status.kind === "geocoding" && (
        <div
          className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("nearby.geocoding")}
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
              <p className="mt-2 text-sm text-muted-foreground">
                {t("nearby.locationDeniedManualHint")}
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
            onClick={() => {
              if (status.reason === "geocode") {
                void handleManualSearch();
              } else {
                requestLocation();
              }
            }}
            className="min-h-11 self-start rounded-full"
          >
            {t("nearby.retry")}
          </Button>
        </div>
      )}

      {status.kind === "empty" && (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          {status.locationLabel && (
            <p className="mb-2 text-xs">
              {t("nearby.lastSearchLabel", { location: status.locationLabel })}
            </p>
          )}
          {t("nearby.empty")}
        </div>
      )}

      {status.kind === "ok" && (
        <>
          {status.locationLabel && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t("nearby.lastSearchLabel", { location: status.locationLabel })}
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-2">
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
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {m.distanceMeters != null && (
                          <span className="font-medium text-foreground">
                            {formatDistance(
                              m.distanceMeters,
                              t,
                              i18n.language || "pt-BR",
                            )}
                          </span>
                        )}
                        {typeof m.rating === "number" && (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                            {m.rating.toFixed(1)}
                            {typeof m.userRatingCount === "number" &&
                              ` · ${m.userRatingCount}`}
                          </span>
                        )}
                      </div>
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
        </>
      )}
    </section>
  );
}
