import { createServerEntry } from "@tanstack/react-start/server-entry";
import { default as handler } from "@tanstack/react-start/server-entry";
import { applySecurityHeaders } from "./server/security-headers.server";

export default createServerEntry({
  async fetch(request: Request, options: any) {
    const originalResponse = await handler.fetch(request, options);

    // Clonamos os headers para poder modificá-los
    const headers = new Headers(originalResponse.headers);

    // Verificamos se é uma requisição de documento HTML
    const contentType = headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");
    const isDocument =
      request.headers.get("sec-fetch-dest") === "document" ||
      (request.headers.get("accept") || "").includes("text/html");

    if (isHtml || isDocument) {
      applySecurityHeaders(headers);
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
