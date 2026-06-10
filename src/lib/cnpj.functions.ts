/**
 * Server function de consulta de CNPJ.
 *
 * Client-safe: pode ser importado por componentes. O bundler substitui pela
 * chamada RPC; a lógica sensível (fetch externo + service role) vive em
 * cnpj.server.ts e nunca chega ao bundle do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consultarCnpjInterno } from "./cnpj.server";
import { assertFeatureAccess } from "./feature-gate.server";

const inputSchema = z.object({
  cnpj: z.string().min(1).max(32),
});

/**
 * Consulta dados públicos de uma empresa por CNPJ.
 *
 * - Requer auth + plano com feature `empresa_inteligente` (MEI/Empresa).
 * - Cache: 30 dias.
 * - Fontes: BrasilAPI (primária) → CNPJ.ws (fallback).
 */
export const consultarCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertFeatureAccess(context.userId, "empresa_inteligente");
    return consultarCnpjInterno(data.cnpj);
  });
