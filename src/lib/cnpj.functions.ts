/**
 * Server function de consulta de CNPJ.
 *
 * Vive em src/lib/ (client-safe path) para passar pelo import-protection
 * do TanStack Start; os módulos *.server.ts são carregados dinamicamente
 * dentro do handler, então a service role nunca chega ao bundle do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const { assertFeatureAccess } = await import("@/server/feature-gate.server");
    const { consultarCnpjInterno } = await import("@/server/cnpj.server");
    await assertFeatureAccess(context.userId, "empresa_inteligente");
    return consultarCnpjInterno(data.cnpj);
  });
