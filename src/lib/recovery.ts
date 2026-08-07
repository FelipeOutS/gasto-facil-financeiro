/**
 * Classificação e recuperação de falhas de carregamento do cliente.
 *
 * Regras do incidente P0 (2026-08-07):
 *  - NÃO limpar todos os caches em erro genérico (só caches "gi-" do app);
 *  - NÃO tocar em IndexedDB, LocalStorage inteiro, cookies, sessão ou Auth;
 *  - só recarregar quando o BUILD_ID do servidor for DIFERENTE do BUILD_ID do
 *    bundle carregado (version skew comprovado);
 *  - no máximo UMA recuperação automática por par <buildAntigo>:<buildNovo>.
 */
import { BUILD_ID } from "./build-id";
import { logClientError } from "./diagnostic-logger";

export type LoadErrorType =
  | "vite_preload_error"
  | "dynamic_import_error"
  | "chunk_404"
  | "module_script_error"
  | "css_load_error"
  | "service_worker_error"
  | "hydration_error"
  | "tanstack_router_error"
  | "network_error"
  | "runtime_error"
  | "unknown";

export type RecoveryOutcome =
  | "recovered"
  | "same_build_no_reload"
  | "already_attempted"
  | "not_recoverable"
  | "version_unknown";

export interface ClassifyInput {
  name?: string;
  message?: string;
  stack?: string;
  resourceUrl?: string;
  eventType?: string;
  httpStatus?: number;
}

/** Erros que podem ser causados por version skew (chunk indisponível). */
const VERSION_SKEW_TYPES: ReadonlySet<LoadErrorType> = new Set<LoadErrorType>([
  "vite_preload_error",
  "dynamic_import_error",
  "chunk_404",
  "module_script_error",
  "css_load_error",
]);

export function isVersionSkewCandidate(type: LoadErrorType): boolean {
  return VERSION_SKEW_TYPES.has(type);
}

/**
 * Classifica a ocorrência sem transformar tudo em `chunk_404`.
 * Erros de API, CSP, hidratação e runtime têm classificação própria.
 */
export function classifyLoadError(input: ClassifyInput): LoadErrorType {
  if (input.eventType === "vite:preloadError") return "vite_preload_error";

  const text = `${input.name ?? ""} ${input.message ?? ""} ${input.stack ?? ""}`.toLowerCase();
  const url = (input.resourceUrl ?? "").toLowerCase();

  if (text.includes("content security policy") || text.includes("refused to")) {
    return "runtime_error";
  }
  if (text.includes("hydrat")) return "hydration_error";
  if (input.httpStatus === 404 && /\.(js|mjs)(\?|$)/.test(url)) return "chunk_404";
  if (text.includes("failed to fetch dynamically imported module")) return "dynamic_import_error";
  if (text.includes("importing a module script failed") || text.includes("loading chunk")) {
    return "module_script_error";
  }
  if (url.endsWith(".css") || text.includes("stylesheet")) return "css_load_error";
  if (text.includes("serviceworker")) return "service_worker_error";
  if (text.includes("matchcache") || text.includes("getmatchedroutes")) {
    return "tanstack_router_error";
  }
  if (text.includes("failed to fetch") || text.includes("networkerror")) return "network_error";
  if (input.name || input.message) return "runtime_error";
  return "unknown";
}

export function recoveryKey(oldBuild: string, newBuild: string): string {
  return `gi:version-recovery:${oldBuild}:${newBuild}`;
}

export interface RecoveryDeps {
  clientBuildId: string;
  /** Consulta /api/public/app-version com cache: 'no-store'. */
  fetchServerBuildId: () => Promise<string | null>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  cacheKeys: () => Promise<string[]>;
  deleteCache: (name: string) => Promise<unknown>;
  /** Registrations do escopo do app. */
  getRegistrations: () => Promise<readonly ServiceWorkerRegistration[]>;
  reload: () => void;
  log: typeof logClientError;
  route: string;
}

async function defaultFetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/public/app-version", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: string };
    return typeof body.buildId === "string" ? body.buildId : null;
  } catch {
    return null;
  }
}

function browserDeps(): RecoveryDeps {
  const hasWindow = typeof window !== "undefined";
  if (!hasWindow) {
    // Ambiente sem DOM (SSR/testes): defaults inertes — nada de reload.
    return {
      clientBuildId: BUILD_ID,
      fetchServerBuildId: defaultFetchServerBuildId,
      getItem: () => null,
      setItem: () => undefined,
      cacheKeys: async () => [],
      deleteCache: async () => false,
      getRegistrations: async () => [],
      reload: () => undefined,
      log: logClientError,
      route: "/",
    };
  }
  return {
    clientBuildId: BUILD_ID,
    fetchServerBuildId: defaultFetchServerBuildId,
    getItem: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* storage indisponível: seguimos sem persistir o guard */
      }
    },
    cacheKeys: async () => ("caches" in window ? caches.keys() : []),
    deleteCache: async (name) => ("caches" in window ? caches.delete(name) : false),
    getRegistrations: async () =>
      "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations() : [],
    reload: () => window.location.reload(),
    log: logClientError,
    route: window.location.pathname,
  };
}

/**
 * Recuperação de version skew. Retorna o desfecho para diagnóstico/testes.
 * NÃO recarrega quando o build do servidor é igual ao do bundle carregado.
 */
export async function attemptRecovery(
  error: Error,
  type: LoadErrorType,
  overrides: Partial<RecoveryDeps> = {},
): Promise<RecoveryOutcome> {
  const deps: RecoveryDeps = { ...browserDeps(), ...overrides };

  const baseReport = {
    error_type: type,
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    current_route: deps.route,
    js_build_id: deps.clientBuildId,
  };

  if (!isVersionSkewCandidate(type)) {
    await deps.log({ ...baseReport, recovery_attempted: false });
    return "not_recoverable";
  }

  const serverBuildId = await deps.fetchServerBuildId();

  if (!serverBuildId) {
    await deps.log({ ...baseReport, recovery_attempted: false });
    return "version_unknown";
  }

  if (serverBuildId === deps.clientBuildId) {
    // Mesmo build: não é version skew — não recarregar, apenas diagnosticar.
    await deps.log({
      ...baseReport,
      server_build_id: serverBuildId,
      recovery_attempted: false,
    });
    return "same_build_no_reload";
  }

  const key = recoveryKey(deps.clientBuildId, serverBuildId);
  if (deps.getItem(key)) {
    await deps.log({
      ...baseReport,
      server_build_id: serverBuildId,
      recovery_attempted: false,
    });
    return "already_attempted";
  }
  deps.setItem(key, new Date().toISOString());

  // Apenas caches do app. IndexedDB, LocalStorage, cookies e sessão intactos.
  for (const name of await deps.cacheKeys()) {
    if (name.startsWith("gi-")) await deps.deleteCache(name);
  }

  // Service Worker obsoleto: atualiza, ativa o waiting e remove a registration
  // (estamos em PWA STABILITY MODE — o sw.js publicado é o de limpeza).
  for (const registration of await deps.getRegistrations()) {
    try {
      await registration.update();
      registration.waiting?.postMessage("SKIP_WAITING");
      await registration.unregister();
    } catch {
      /* registration já removida por outra aba */
    }
  }

  await deps.log({
    ...baseReport,
    server_build_id: serverBuildId,
    recovery_attempted: true,
  });

  deps.reload();
  return "recovered";
}
