import { describe, expect, it } from "vitest";
import {
  attemptRecovery,
  classifyLoadError,
  isVersionSkewCandidate,
  recoveryKey,
  type RecoveryDeps,
} from "@/lib/recovery";
import { sanitizeText, sanitizeUrl, buildDiagnosticPayload } from "@/lib/diagnostic-logger";

function makeDeps(overrides: Partial<RecoveryDeps> = {}) {
  const store = new Map<string, string>();
  const deleted: string[] = [];
  const unregistered: string[] = [];
  let reloads = 0;
  const logged: Record<string, unknown>[] = [];

  const deps: Partial<RecoveryDeps> = {
    clientBuildId: "build-old",
    fetchServerBuildId: async () => "build-new",
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    cacheKeys: async () => ["gi-app-v1", "firebase-messaging-sw-cache"],
    deleteCache: async (name) => {
      deleted.push(name);
      return true;
    },
    getRegistrations: async () => [
      {
        update: async () => undefined,
        waiting: null,
        unregister: async () => {
          unregistered.push("sw");
          return true;
        },
      } as unknown as ServiceWorkerRegistration,
    ],
    reload: () => {
      reloads += 1;
    },
    log: async (data) => {
      logged.push(data as unknown as Record<string, unknown>);
    },
    route: "/dashboard",
    ...overrides,
  };

  return {
    deps,
    state: {
      deleted,
      unregistered,
      logged,
      get reloads() {
        return reloads;
      },
      store,
    },
  };
}

describe("classifyLoadError", () => {
  it("classifica vite:preloadError", () => {
    expect(classifyLoadError({ eventType: "vite:preloadError" })).toBe("vite_preload_error");
  });

  it("classifica import dinâmico e chunk 404", () => {
    expect(
      classifyLoadError({ message: "Failed to fetch dynamically imported module: /assets/a.js" }),
    ).toBe("dynamic_import_error");
    expect(classifyLoadError({ httpStatus: 404, resourceUrl: "/assets/x-abc.js" })).toBe(
      "chunk_404",
    );
  });

  it("NÃO trata erro de API, CSP ou hidratação como falha de chunk", () => {
    expect(
      classifyLoadError({ message: "Refused to connect due to Content Security Policy" }),
    ).toBe("runtime_error");
    expect(classifyLoadError({ message: "Hydration failed because..." })).toBe("hydration_error");
    expect(classifyLoadError({ message: "Failed to fetch" })).toBe("network_error");
  });

  it("apenas erros de asset são candidatos a version skew", () => {
    expect(isVersionSkewCandidate("chunk_404")).toBe(true);
    expect(isVersionSkewCandidate("hydration_error")).toBe(false);
    expect(isVersionSkewCandidate("network_error")).toBe(false);
    expect(isVersionSkewCandidate("runtime_error")).toBe(false);
  });
});

describe("attemptRecovery", () => {
  it("recarrega uma única vez quando o build do servidor difere", async () => {
    const { deps, state } = makeDeps();
    const first = await attemptRecovery(new Error("chunk"), "chunk_404", deps);
    expect(first).toBe("recovered");
    expect(state.reloads).toBe(1);

    // Guard persistente: segunda ocorrência do mesmo par não recarrega (sem loop).
    const second = await attemptRecovery(new Error("chunk"), "chunk_404", deps);
    expect(second).toBe("already_attempted");
    expect(state.reloads).toBe(1);
    expect(state.store.has(recoveryKey("build-old", "build-new"))).toBe(true);
  });

  it("não recarrega quando o build do servidor é igual (erro real do app)", async () => {
    const { deps, state } = makeDeps({ fetchServerBuildId: async () => "build-old" });
    expect(await attemptRecovery(new Error("chunk"), "chunk_404", deps)).toBe(
      "same_build_no_reload",
    );
    expect(state.reloads).toBe(0);
    expect(state.deleted).toEqual([]);
  });

  it("não recupera erro de runtime/hidratação, apenas registra", async () => {
    const { deps, state } = makeDeps();
    expect(await attemptRecovery(new Error("boom"), "hydration_error", deps)).toBe(
      "not_recoverable",
    );
    expect(state.reloads).toBe(0);
    expect(state.logged[0]?.recovery_attempted).toBe(false);
  });

  it("apaga somente caches do app, preservando caches de terceiros", async () => {
    const { deps, state } = makeDeps();
    await attemptRecovery(new Error("chunk"), "vite_preload_error", deps);
    expect(state.deleted).toEqual(["gi-app-v1"]);
    expect(state.unregistered).toEqual(["sw"]);
  });

  it("não recarrega quando a versão do servidor é desconhecida", async () => {
    const { deps, state } = makeDeps({ fetchServerBuildId: async () => null });
    expect(await attemptRecovery(new Error("chunk"), "chunk_404", deps)).toBe("version_unknown");
    expect(state.reloads).toBe(0);
  });
});

describe("diagnóstico sem dados sensíveis", () => {
  it("remove query string e fragmento das URLs", () => {
    expect(sanitizeUrl("https://x.com/a/b?token=abc#frag")).toBe("https://x.com/a/b");
  });

  it("redige JWT, e-mail, UUID e telefone", () => {
    const dirty =
      "user maria@ex.com id 123e4567-e89b-12d3-a456-426614174000 tel 5511999998888 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef";
    const clean = sanitizeText(dirty)!;
    expect(clean).not.toContain("maria@ex.com");
    expect(clean).not.toContain("123e4567");
    expect(clean).not.toContain("5511999998888");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("payload inclui build id e não vaza a query original", () => {
    const payload = buildDiagnosticPayload({
      error_type: "chunk_404",
      resource_url: "/assets/a.js?v=secret",
      current_route: "/dashboard?email=maria@ex.com",
    });
    expect(payload.resource_url).toBe("/assets/a.js");
    expect(String(payload.current_route)).not.toContain("maria@ex.com");
    expect(typeof payload.js_build_id).toBe("string");
  });
});
