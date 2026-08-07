import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

import { getRouter } from "./router";
import { attemptRecovery, classifyLoadError } from "./lib/recovery";
import { logClientError } from "./lib/diagnostic-logger";
import { BUILD_ID } from "./lib/build-id";

const router = getRouter();

// Instrumentação no ponto mais inicial possível — antes do Error Boundary.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event: Event) => {
    event.preventDefault();
    const payload = (event as Event & { payload?: Error }).payload;
    void attemptRecovery(
      payload instanceof Error ? payload : new Error("vite:preloadError"),
      "vite_preload_error",
    );
  });

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;

      // Falha ao carregar <script type="module"> / CSS / imagem.
      if (target && target !== (window as unknown as EventTarget) && target.tagName) {
        const resourceUrl = target.src ?? target.href;
        if (!resourceUrl) return;
        const type = classifyLoadError({
          message: `resource load failed: ${target.tagName}`,
          resourceUrl,
        });
        void attemptRecovery(new Error(`Resource load failed: ${target.tagName}`), type);
        return;
      }

      const error = event.error as Error | undefined;
      if (!error) return;
      const type = classifyLoadError({
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      void attemptRecovery(error, type);
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason ?? "unhandled"));
    const type = classifyLoadError({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    void attemptRecovery(error, type);
  });

  // Marcador para diagnóstico manual sem expor dados pessoais.
  (window as unknown as Record<string, string>).__GI_CLIENT_BUILD_ID__ = BUILD_ID;

  window.addEventListener("gi:diagnostic", (event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
    void logClientError({ error_type: "unknown", ...detail });
  });
}

hydrateRoot(document, <StartClient />);
