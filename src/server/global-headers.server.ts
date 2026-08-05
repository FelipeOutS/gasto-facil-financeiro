import { SECURITY_HEADERS } from "./security-headers.server";
import { createMiddleware } from "@tanstack/react-start";

/**
 * Middleware global para injetar cabeçalhos de segurança em todas as requisições server-side.
 * Aplicado via functionMiddleware no TanStack Start.
 */
export const globalSecurityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    
    // Injeta os headers em todas as respostas que passam pelo middleware
    if (result.headers) {
      Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
        result.headers.set(key, value);
      });
    }
    
    return result;
  }
);
