/// <reference types="google.maps" />
import { useEffect, useRef, useState, useCallback } from "react";
import {
  loadGoogleMaps,
  isGoogleMapsLoaded,
  getGoogleMapsError,
  getGoogleMapsLoadState,
  type GoogleMapsLoadState,
} from "@/lib/google-maps";

export type MapMarkerInput = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  onClick?: () => void;
};

export type UseGoogleMapsResult = {
  state: GoogleMapsLoadState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  init: () => void;
  setMarkers: (markers: MapMarkerInput[]) => void;
  panTo: (lat: number, lng: number, zoom?: number) => void;
};

/** Centro padrão: Brasil (São Paulo) — apenas para validação visual. */
const DEFAULT_CENTER = { lat: -23.55052, lng: -46.633308 };
const DEFAULT_ZOOM = 12;

export function useGoogleMaps(): UseGoogleMapsResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const pendingMarkersRef = useRef<MapMarkerInput[] | null>(null);
  const [state, setState] = useState<GoogleMapsLoadState>(getGoogleMapsLoadState);

  const applyMarkers = useCallback(() => {
    const map = mapRef.current;
    const pending = pendingMarkersRef.current;
    const maps = (window as unknown as { google?: { maps?: typeof google.maps } }).google?.maps;
    if (!map || !maps || !pending) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (pending.length === 0) return;

    const bounds = new maps.LatLngBounds();
    pending.forEach((m) => {
      const marker = new maps.Marker({
        position: { lat: m.latitude, lng: m.longitude },
        map,
        title: m.title,
      });
      if (m.onClick) {
        marker.addListener("click", m.onClick);
      }
      markersRef.current.push(marker);
      bounds.extend({ lat: m.latitude, lng: m.longitude });
    });

    if (pending.length === 1) {
      map.panTo({ lat: pending[0].latitude, lng: pending[0].longitude });
      if (map.getZoom() != null && (map.getZoom() ?? 0) < 14) map.setZoom(15);
    } else {
      map.fitBounds(bounds, 64);
    }
  }, []);

  const renderMap = useCallback(() => {
    if (mapRef.current) {
      applyMarkers();
      return;
    }
    if (!containerRef.current) return;
    const maps = (window as unknown as { google?: { maps?: typeof google.maps } }).google?.maps;
    if (!maps) return;
    try {
      mapRef.current = new maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        disableDefaultUI: false,
        clickableIcons: false,
      });
      applyMarkers();
    } catch {
      // erro silencioso — não expõe detalhes em UI/log
    }
  }, [applyMarkers]);

  const init = useCallback(() => {
    if (isGoogleMapsLoaded()) {
      setState(getGoogleMapsLoadState());
      setTimeout(renderMap, 0);
      return;
    }
    const currentError = getGoogleMapsError();
    if (currentError) {
      setState({ status: "error", message: currentError });
      return;
    }
    setState({ status: "loading" });
    loadGoogleMaps()
      .then(() => {
        setState(getGoogleMapsLoadState());
        setTimeout(renderMap, 0);
      })
      .catch(() => setState(getGoogleMapsLoadState()));
  }, [renderMap]);

  const setMarkers = useCallback(
    (markers: MapMarkerInput[]) => {
      pendingMarkersRef.current = markers;
      applyMarkers();
    },
    [applyMarkers],
  );

  const panTo = useCallback((lat: number, lng: number, zoom?: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat, lng });
    if (typeof zoom === "number") map.setZoom(zoom);
  }, []);

  useEffect(() => {
    if (state.status === "loaded") {
      renderMap();
    }
  }, [state.status, renderMap]);

  return { state, containerRef, init, setMarkers, panTo };
}
