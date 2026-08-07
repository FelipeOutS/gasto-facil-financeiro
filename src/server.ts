import { createServerEntry } from "@tanstack/react-start/server-entry";
import { default as handler } from "@tanstack/react-start/server-entry";
import { applySecurityHeaders } from "./server/security-headers.server";

export default createServerEntry({
  async fetch(request: Request, options: Parameters<typeof handler.fetch>[1]) {
    const originalResponse = await handler.fetch(request, options);

    // Clonamos os headers para poder modificá-los
    const headers = new Headers(originalResponse.headers);

    // Verificamos se é uma requisição de documento HTML
    const contentType = headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");
    const isDocument =
      request.headers.get("sec-fetch-dest") === "document" ||
      (request.headers.get("accept") || "").includes("text/html");

    const pathname = new URL(request.url).pathname;

    if (isHtml || isDocument) {
      applySecurityHeaders(headers);
      // Version skew (incidente P0 2026-08-07): o HTML referencia chunks com
      // hash de um build específico. Se o HTML for cacheado, o navegador pede
      // chunks que já não existem. O HTML SEMPRE revalida; os assets com hash
      // continuam imutáveis e cacheáveis.
      headers.set("Cache-Control", "no-cache, must-revalidate");
      headers.set("CDN-Cache-Control", "no-cache, must-revalidate");
    } else if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") {
      // Arquivos de controle: precisam ser vistos imediatamente após o deploy.
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-cache, must-revalidate");
      headers.set("CDN-Cache-Control", "no-cache, must-revalidate");
    } else {
      // Para outros tipos (JSON, assets), garantimos ao menos o nosniff
      headers.set("X-Content-Type-Options", "nosniff");
    }

    // Criamos a nova resposta preservando o corpo (streaming) e o status
    return new Response(originalResponse.body, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers,
    });
  },
});
