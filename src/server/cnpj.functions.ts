/**
 * Server function de consulta de CNPJ.
 *
 * Client-safe: pode ser importado por componentes. O bundler substitui pela
 * chamada RPC; a lógica sensível (fetch externo + service role) vive em
 * cnpj.server.ts e nunca chega ao bundle do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { consultarCnpjInterno } from "./cnpj.server";

const inputSchema = z.object({
  cnpj: z.string().min(1).max(32),
});

/**
 * Consulta dados públicos de uma empresa por CNPJ.
 *
 * - Sem auth: dados públicos da RFB; cache compartilhado entre usuários.
 * - Cache: 30 dias.
 * - Fontes: BrasilAPI (primária) → CNPJ.ws (fallback).
 * - CNPJ inválido nunca chama API externa.
 */
export const consultarCnpj = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    return consultarCnpjInterno(data.cnpj);
  });
