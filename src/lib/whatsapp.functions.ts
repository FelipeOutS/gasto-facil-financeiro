import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { processarMensagemWhatsApp } from "@/server/whatsapp.server";
import { assertFeatureAccess } from "@/server/feature-gate.server";

/** Normaliza telefone: mantém apenas dígitos. */
function normTel(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Gate unificado: feature de plano + beta fechada (ou Admin Master).
 * Lança 403 amigável se faltar acesso de beta.
 */
async function assertWhatsAppAccess(userId: string): Promise<void> {
  await assertFeatureAccess(userId, "whatsapp");
  const { canUseWhatsApp } = await import("@/server/whatsapp-beta.server");
  const ok = await canUseWhatsApp(userId);
  if (!ok) {
    throw new Response(
      JSON.stringify({
        error: "whatsapp_beta_required",
        message:
          "O WhatsApp está em beta fechada. Solicite acesso ao Admin Master para participar.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Retorna apenas o status (boolean) dos secrets do WhatsApp.
 * NUNCA retorna os valores. Usado no painel admin para mostrar
 * "Configurado" / "Não configurado".
 */
export const getWhatsAppConfigStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertFeatureAccess(context.userId, "whatsapp");
    const has = (v: string | undefined | null) => typeof v === "string" && v.trim().length > 0;
    const flag = (v: string | undefined | null) => (v ?? "").trim().toLowerCase() === "true";
    return {
      access_token: has(process.env.WHATSAPP_ACCESS_TOKEN),
      phone_number_id: has(process.env.WHATSAPP_PHONE_NUMBER_ID),
      business_account_id: has(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
      verify_token: has(process.env.WHATSAPP_VERIFY_TOKEN),
      enabled: flag(process.env.WHATSAPP_ENABLED),
      canary_enabled: flag(process.env.WHATSAPP_CANARY_ENABLED),
    };
  });

export const listWhatsAppLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertWhatsAppAccess(context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("whatsapp_links")
      .select("id, telefone, ativo, ultimo_uso, created_at, opt_in_em, opt_in_version, revogado_em")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: data ?? [] };
  });

/** Versão atual da copy de consentimento (WhatsApp como canal de lançamento de gastos). */
export const WHATSAPP_OPT_IN_VERSION = "whatsapp-expense-v1";

/**
 * Versão específica para o fluxo de re-confirmação de consentimento
 * de vínculo já existente (LGPD). Não altera telefone, não cria vínculo,
 * não fala com a Meta — apenas atualiza opt_in do próprio usuário.
 */
export const WHATSAPP_CONSENT_REFRESH_VERSION = "whatsapp-lancamentos-v1";

/**
 * WA-C11 Fase 3B.2.E — Gate de novos vínculos.
 * Bloqueia criação ou reativação quando `new_links_enabled=false` ou
 * `global_enabled=false`. NUNCA aplicado em: opt-out, refresh de consentimento
 * de vínculo já existente sem reativação, ou listagem/leitura.
 */
async function assertNewLinksAllowed(): Promise<void> {
  const { readRuntimeConfig } = await import("@/server/whatsapp-runtime-config.server");
  const rc = await readRuntimeConfig();
  if (!rc.global_enabled || !rc.new_links_enabled) {
    throw new Response(
      JSON.stringify({
        error: "new_links_disabled",
        message: "Novos vínculos de WhatsApp estão temporariamente desabilitados.",
      }),
      { status: 423, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const confirmWhatsAppLinkConsent = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        aceitou: z.literal(true),
        user_agent: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    // Localiza o vínculo do PRÓPRIO usuário (RLS já restringe a auth.uid()).
    const { data: link, error: selErr } = await sb
      .from("whatsapp_links")
      .select("id, ativo, telefone, revogado_em")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!link) {
      return { consentimento_atualizado: "falhou" as const };
    }

    // Se o vínculo está revogado ou inativo, isto é reativação — cai no gate.
    const isReactivation = !link.ativo || link.revogado_em !== null;
    if (isReactivation) {
      await assertNewLinksAllowed();
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await sb
      .from("whatsapp_links")
      .update({
        opt_in_em: nowIso,
        opt_in_version: WHATSAPP_CONSENT_REFRESH_VERSION,
        opt_in_user_agent: data.user_agent ?? null,
        revogado_em: null,
      })
      .eq("id", link.id)
      .eq("user_id", userId);
    if (updErr) {
      return { consentimento_atualizado: "falhou" as const };
    }
    return { consentimento_atualizado: "ok" as const };
  });

export const upsertWhatsAppLink = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        telefone: z.string().min(8).max(20),
        ativo: z.boolean().optional(),
        aceitou_opt_in: z.boolean(),
        user_agent: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
    // WA-C11 3B.2.E — novo vínculo ou reativação: gate obrigatório.
    await assertNewLinksAllowed();
    if (data.aceitou_opt_in !== true) {
      throw new Error(
        "Para usar o lançamento por WhatsApp, você precisa aceitar o consentimento de uso desse canal.",
      );
    }
    const tel = normTel(data.telefone);
    if (tel.length < 8) throw new Error("Telefone inválido");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    // Cross-user: existência global do telefone (RLS não vê linhas de outros;
    // usamos a query com filtro explícito, e a unicidade real vem da constraint
    // do banco). Se pertence a outro usuário, negamos sem revelar identidade.
    const { data: existing } = await sb
      .from("whatsapp_links")
      .select("id, user_id")
      .eq("telefone", tel)
      .maybeSingle();

    if (existing && existing.user_id !== userId) {
      throw new Error("Esse número já está vinculado a outra conta.");
    }

    const nowIso = new Date().toISOString();
    const consentPayload = {
      opt_in_em: nowIso,
      opt_in_version: WHATSAPP_OPT_IN_VERSION,
      opt_in_user_agent: data.user_agent ?? null,
      revogado_em: null as string | null,
    };

    if (existing) {
      const { error } = await sb
        .from("whatsapp_links")
        .update({ ativo: data.ativo ?? true, ...consentPayload })
        .eq("id", existing.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: existing.id, telefone: tel };
    }

    const { data: created, error } = await sb
      .from("whatsapp_links")
      .insert({
        user_id: userId,
        telefone: tel,
        ativo: data.ativo ?? true,
        ...consentPayload,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id, telefone: tel };
  });

/**
 * WA-C11 Fase 3B.2.E — Opt-out incondicional via web.
 *
 * Requisitos:
 *   - Autenticação Supabase obrigatória.
 *   - Ownership server-side (filtro explícito por user_id).
 *   - NÃO exige entitlement/beta/plano ativo/rollout: o dono sempre pode
 *     revogar seu próprio consentimento e sair do canal.
 *   - Soft revoke (LGPD): mantém histórico, mas impede o webhook de
 *     processar mensagens deste vínculo até novo consentimento explícito
 *     (que passará por `assertNewLinksAllowed`).
 */
export const deleteWhatsAppLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    // Filtro explícito por user_id: nunca depende apenas de RLS.
    const { data: updated, error } = await sb
      .from("whatsapp_links")
      .update({
        ativo: false,
        revogado_em: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) {
      // Não vaza identidade: mesma mensagem para "não existe" e "de outro dono".
      throw new Response(
        JSON.stringify({ error: "not_found", message: "Vínculo não encontrado." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return { ok: true };
  });

export const listWhatsAppMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertWhatsAppAccess(context.userId);
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
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
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
  .inputValidator((d) => z.object({ messageId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    const { data: msg, error: msgErr } = await sb
      .from("whatsapp_messages")
      .select("id, gasto_id, user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (msgErr) throw new Error(msgErr.message);
    if (!msg || msg.user_id !== userId) throw new Error("Mensagem não encontrada.");

    if (msg.gasto_id) {
      // Remove o gasto real (RLS garante que só o dono pode apagar).
      const { error: delErr } = await sb.from("gastos").delete().eq("id", msg.gasto_id);
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
  .inputValidator((d) => z.object({ messageId: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { userId } = context;

    const { data: msg, error } = await sb
      .from("whatsapp_messages")
      .select("id, telefone, texto, user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!msg || msg.user_id !== userId) throw new Error("Mensagem não encontrada.");

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
    await assertWhatsAppAccess(context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb.from("whatsapp_messages").delete().eq("id", data.messageId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Envia uma mensagem de teste real pelo WhatsApp Cloud API usando os
 * secrets do servidor. Falha cedo (e claramente) se faltar configuração.
 * O token NUNCA é retornado ao cliente — apenas status do envio.
 */
export const enviarMensagemTesteWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        telefone: z.string().min(8).max(20),
        texto: z.string().min(1).max(1000),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertWhatsAppAccess(context.userId);
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token) {
      throw new Error(
        "Configure o secret WHATSAPP_ACCESS_TOKEN no Lovable/Supabase para ativar o envio de mensagens pelo WhatsApp.",
      );
    }
    if (!phoneId) {
      throw new Error("Configure o secret WHATSAPP_PHONE_NUMBER_ID para enviar mensagens.");
    }
    const to = normTel(data.telefone);
    const { buildWhatsAppGraphUrl } = await import("@/server/whatsapp-graph-version.server");
    const built = buildWhatsAppGraphUrl({ kind: "messages", phoneNumberId: phoneId });
    if (!built.ok) {
      // META-GRAPH-UPGRADE-01 — fail-closed
      return { sent: false, status: 0, error: "configuration_error" };
    }
    const res = await fetch(built.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: data.texto },
      }),
    });
    const ok = res.ok;
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    // Não logar nem retornar o token. Retornar apenas status genérico.
    if (!ok) {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (detail as any)?.error?.message ?? `HTTP ${res.status}`;
      return { sent: false, status: res.status, error: msg };
    }
    return { sent: true, status: res.status };
  });
