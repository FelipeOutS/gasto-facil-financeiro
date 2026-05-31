/// <reference types="google.maps" />
import { useEffect, useRef, useState, useCallback } from "react";
import {
  loadGoogleMaps,
  isGoogleMapsLoaded,
  getGoogleMapsError,
  getGoogleMapsLoadState,
  type GoogleMapsLoadState,
} from "@/lib/google-maps";

export type UseGoogleMapsResult = {
  state: GoogleMapsLoadState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  init: () => void;
};

/** Centro padrão: Brasil (São Paulo) — apenas para validação visual. */
const DEFAULT_CENTER = { lat: -23.55052, lng: -46.633308 };
const DEFAULT_ZOOM = 12;

export function useGoogleMaps(): UseGoogleMapsResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [state, setState] = useState<GoogleMapsLoadState>(getGoogleMapsLoadState);

  const renderMap = useCallback(() => {
    if (mapRef.current) return;
    if (!containerRef.current) return;
    const maps = (window as unknown as { google?: { maps?: typeof google.maps } })
      .google?.maps;
    if (!maps) return;
    try {
      mapRef.current = new maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        disableDefaultUI: false,
        clickableIcons: false,
      });
    } catch {
      // erro silencioso — não expõe detalhes em UI/log
    }
  }, []);

  const init = useCallback(() => {
    if (isGoogleMapsLoaded()) {
      setState(getGoogleMapsLoadState());
      // Render no próximo tick, garantindo containerRef montado
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

  useEffect(() => {
    if (state.status === "loaded") {
      renderMap();
    }
  }, [state.status, renderMap]);

  return { state, containerRef, init };
}
