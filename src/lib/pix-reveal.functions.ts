/**
 * WA-PIX-UX-01 — Server function autenticada que consome o token opaco
 * e devolve a chave Pix completa para a página `/pix/copiar/$token`.
 *
 * A chave nunca circula em query string nem em logs de aplicação.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consumeRevealToken } from "@/server/whatsapp-pix-reveal-token.server";

export const revealPixKey = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(64),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!userId) throw new Error("Usuário não autenticado");
    const payload = await consumeRevealToken({ userId, token: data.token });
    if (!payload) {
      return { ok: false as const, reason: "expired_or_invalid" as const };
    }
    return {
      ok: true as const,
      nome: payload.favorecidoNome,
      chave: payload.pixKey,
      tipo: payload.pixKeyType,
    };
  });
