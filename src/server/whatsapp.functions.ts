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

/**
 * Exclui o gasto criado por uma mensagem do WhatsApp e atualiza o log
 * para refletir a exclusão. O delete em cascata na tabela `gastos`
 * garante que cartões, faturas, dashboard e relatórios recalculem.
 */
export const deleteGastoFromWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ messageId: z.string().uuid() }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    const { data: msg, error: msgErr } = await sb
      .from("whatsapp_messages")
      .select("id, gasto_id, user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (msgErr) throw new Error(msgErr.message);
    if (!msg || msg.user_id !== userId)
      throw new Error("Mensagem não encontrada.");

    if (msg.gasto_id) {
      // Remove o gasto real (RLS garante que só o dono pode apagar).
      const { error: delErr } = await sb
        .from("gastos")
        .delete()
        .eq("id", msg.gasto_id);
      if (delErr) throw new Error(delErr.message);

      // Limpa contas a pagar vinculadas, se houver.
      await sb
        .from("contas_a_pagar")
        .update({ status: "pendente", data_pagamento: null, gasto_id: null })
        .eq("gasto_id", msg.gasto_id);
    }

    // Atualiza o log mantendo histórico.
    const { error: updErr } = await sb
      .from("whatsapp_messages")
      .update({
        status: "gasto_excluido",
        gasto_id: null,
        resposta_sugerida: "Gasto excluído pelo usuário.",
      })
      .eq("id", data.messageId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true };
  });

/** Reprocessa uma mensagem (cria novo gasto a partir do mesmo texto). */
export const reprocessarMensagemWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ messageId: z.string().uuid() }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    const { data: msg, error } = await sb
      .from("whatsapp_messages")
      .select("id, telefone, texto, user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!msg || msg.user_id !== userId)
      throw new Error("Mensagem não encontrada.");

    // Remove o log antigo para liberar a dedupe e processa de novo.
    await sb.from("whatsapp_messages").delete().eq("id", data.messageId);

    const out = await processarMensagemWhatsApp({
      external_id: `reproc-${Date.now()}`,
      telefone: msg.telefone,
      texto: msg.texto,
    });
    return out;
  });

/** Exclui apenas o log da mensagem do WhatsApp (não toca no gasto). */
export const deleteWhatsAppMessageLog = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ messageId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb
      .from("whatsapp_messages")
      .delete()
      .eq("id", data.messageId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
