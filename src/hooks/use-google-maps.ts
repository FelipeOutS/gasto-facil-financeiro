import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMaps,
  isGoogleMapsLoaded,
  getGoogleMapsError,
  getGoogleMapsLoadState,
  type GoogleMapsLoadState,
} from "@/lib/google-maps";

export type UseGoogleMapsResult = {
  /** Estado atual do carregamento do Google Maps */
  state: GoogleMapsLoadState;
  /** Ref para o container onde o mapa será renderizado */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Inicia o carregamento manualmente (lazy) */
  init: () => void;
};

/**
 * Hook React para carregar o Google Maps de forma lazy e segura.
 * Não carrega o script até que `init()` seja chamado.
 * Retorna o estado atual + uma ref para o container do mapa.
 */
export function useGoogleMaps(): UseGoogleMapsResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GoogleMapsLoadState>(getGoogleMapsLoadState);

  const init = () => {
    if (isGoogleMapsLoaded()) {
      setState(getGoogleMapsLoadState());
      return;
    }
    const currentError = getGoogleMapsError();
    if (currentError) {
      setState({ status: "error", message: currentError });
      return;
    }
    setState({ status: "loading" });
    loadGoogleMaps()
      .then(() => setState(getGoogleMapsLoadState()))
      .catch(() => setState(getGoogleMapsLoadState()));
  };

  useEffect(() => {
    // Se já estiver carregado por outro componente, sincroniza estado
    if (isGoogleMapsLoaded() && state.status !== "loaded") {
      setState(getGoogleMapsLoadState());
    }
  }, [state.status]);

  return { state, containerRef, init };
}
