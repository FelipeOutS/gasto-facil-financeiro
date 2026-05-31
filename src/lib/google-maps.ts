/// <reference types="google.maps" />
/**
 * Google Maps Loader — helper seguro para carregar a Google Maps JS API
 * ----------------------------------------------------------------------------
 * Regras:
 * - Lê a chave gerenciada do connector Lovable:
 *   `import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`.
 * - Tracking ID opcional via `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID`.
 * - NUNCA expõe a chave em logs, UI ou requisições.
 * - Carrega o script apenas uma vez (singleton + deduplicação).
 * - Retorna erro controlado se a chave estiver ausente ou o load falhar.
 * - Não carrega globalmente — somente quando um componente do Mercado
 *   Inteligente solicita explicitamente.
 */

export type GoogleMapsLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; maps: typeof google.maps }
  | { status: "error"; message: string };

let loadPromise: Promise<typeof google.maps> | null = null;
let loadState: GoogleMapsLoadState = { status: "idle" };

const CALLBACK_NAME = "__gastoInteligenteMapsInit__";

function getApiKey(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = (import.meta.env as any).VITE_GOOGLE_MAPS_API_KEY;
    return typeof key === "string" && key.trim().length > 0
      ? key.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function createScript(apiKey: string): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    apiKey,
  )}&loading=async&callback=${CALLBACK_NAME}`;
  script.async = true;
  script.defer = true;
  return script;
}

function setState(next: GoogleMapsLoadState) {
  loadState = next;
}

export function getGoogleMapsLoadState(): GoogleMapsLoadState {
  return loadState;
}

export function isGoogleMapsLoaded(): boolean {
  return loadState.status === "loaded";
}

export function getGoogleMapsError(): string | null {
  return loadState.status === "error" ? loadState.message : null;
}

/**
 * Carrega a Google Maps JavaScript API de forma lazy e deduplicada.
 * Resolve com `google.maps` quando pronto. Rejeita com mensagem amigável
 * em caso de falha (chave ausente, timeout, erro de rede).
 */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loadState.status === "loaded") {
    return Promise.resolve(loadState.maps);
  }
  if (loadState.status === "error") {
    return Promise.reject(new Error(loadState.message));
  }
  if (loadPromise) {
    return loadPromise;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    const msg =
      "A chave do Google Maps não está configurada. " +
      "O mapa ficará indisponível até que a configuração seja concluída.";
    setState({ status: "error", message: msg });
    return Promise.reject(new Error(msg));
  }

  setState({ status: "loading" });

  loadPromise = new Promise<typeof google.maps>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      const msg =
        "O mapa demorou muito para carregar. " +
        "Verifique sua conexão e tente novamente.";
      setState({ status: "error", message: msg });
      reject(new Error(msg));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any)[CALLBACK_NAME];
    }

    function onError() {
      cleanup();
      const msg =
        "Não foi possível carregar o Google Maps. " +
        "Verifique sua conexão ou tente novamente mais tarde.";
      setState({ status: "error", message: msg });
      reject(new Error(msg));
    }

    // Registra callback global que o Google Maps chama após `loading=async`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[CALLBACK_NAME] = () => {
      cleanup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maps = (window as any).google?.maps;
      if (!maps) {
        const msg =
          "O Google Maps não iniciou corretamente. Tente recarregar a página.";
        setState({ status: "error", message: msg });
        reject(new Error(msg));
        return;
      }
      setState({ status: "loaded", maps });
      resolve(maps as typeof google.maps);
    };

    const script = createScript(apiKey);
    script.onerror = onError;
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Reseta o estado interno (útil principalmente em testes).
 * Em produção não deve ser chamado.
 */
export function resetGoogleMapsLoader(): void {
  loadPromise = null;
  loadState = { status: "idle" };
}
