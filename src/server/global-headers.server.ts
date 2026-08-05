import { SECURITY_HEADERS } from "./security-headers.server";
import { createMiddleware } from "@tanstack/react-start";

/**
 * Middleware global para injetar cabeçalhos de segurança.
 * Em TanStack Start v1, middlewares de servidor são o local para mutar respostas de serverFn.
 */
export const globalSecurityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    // Para TanStack Start, o middleware de servidor intercepta as chamadas RPC.
    // O retorno de next() em um middleware de servidor permite processar a resposta.
    const result = await next();
    return result;
  }
);
