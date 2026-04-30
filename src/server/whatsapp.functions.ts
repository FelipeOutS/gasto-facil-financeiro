import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { processarMensagemWhatsApp } from "./whatsapp.server";

/** Normaliza telefone: mantém apenas dígitos. */
function normTel(raw: string): string {
  return raw.replace(/\D/g, "");
}

export const listWhatsAppLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("whatsapp_links")
      .select("id, telefone, ativo, ultimo_uso, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: data ?? [] };
  });

export const upsertWhatsAppLink = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        telefone: z.string().min(8).max(20),
        ativo: z.boolean().optional(),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const tel = normTel(data.telefone);
    if (tel.length < 8) throw new Error("Telefone inválido");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    const { data: existing } = await sb
      .from("whatsapp_links")
      .select("id, user_id")
      .eq("telefone", tel)
      .maybeSingle();

    if (existing && existing.user_id !== userId) {
      throw new Error("Esse número já está vinculado a outra conta.");
    }

    if (existing) {
      const { error } = await sb
        .from("whatsapp_links")
        .update({ ativo: data.ativo ?? true })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id, telefone: tel };
    }

    const { data: created, error } = await sb
      .from("whatsapp_links")
      .insert({ user_id: userId, telefone: tel, ativo: data.ativo ?? true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id, telefone: tel };
  });

export const deleteWhatsAppLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb
      .from("whatsapp_links")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWhatsAppMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("whatsapp_messages")
      .select(
        "id, telefone, texto, status, gasto_id, confianca, recebida_em, resposta_sugerida, erro",
      )
      .order("recebida_em", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { messages: data ?? [] };
  });

/** Dispara um teste do webhook usando o telefone vinculado e a mensagem do usuário. */
export const testarWebhookWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        telefone: z.string().min(8).max(20),
        texto: z.string().min(1).max(1000),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const tel = normTel(data.telefone);
    const externalId = `test-${Date.now()}`;
    const out = await processarMensagemWhatsApp({
      external_id: externalId,
      telefone: tel,
      texto: data.texto,
    });
    return out;
  });
