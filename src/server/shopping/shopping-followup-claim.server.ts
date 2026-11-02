// Dedupe de reentrega das continuações de compras (só marcador, sem URL/preço/finanças).
export type FollowupClaim = (m: { userId: string; phone: string; externalId: string; text: string }) => Promise<"ok" | "dup" | "error">;
export const SHOPPING_FOLLOWUP_KIND = "shopping_followup";

/** Usa o índice único existente de whatsapp_messages.external_id; sem URL, preço ou finanças. */
export const dbClaimFollowup: FollowupClaim = async ({ userId, phone, externalId, text }) => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId, external_id: externalId, telefone: phone, texto: text.slice(0, 200),
      recebida_em: new Date().toISOString(), status: "sem_pendencia",
      parsed: { kind: SHOPPING_FOLLOWUP_KIND }, resposta_sugerida: null,
    });
    if (!error) return "ok";
    return error.code === "23505" ? "dup" : "error";
  } catch { return "error"; }
};

