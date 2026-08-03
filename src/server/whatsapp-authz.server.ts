/**
 * WA-G5B — Gate único de autorização do WhatsApp por número remetente.
 *
 * Centraliza TODA a verificação de "esse telefone pode usar o WhatsApp do
 * Gasto Inteligente?". Qualquer fluxo (gasto, receita, consulta, OCR,
 * reset, ajuda) precisa passar por aqui ANTES de qualquer parser, download
 * de mídia, cálculo de hash, chamada de IA ou persistência financeira.
 *
 * Regras (todas precisam passar):
 *  1) telefone normalizado em E.164 (apenas dígitos);
 *  2) existe vínculo ATIVO em `whatsapp_links` para esse telefone;
 *  3) vínculo possui `opt_in_em` (consentimento) e NÃO possui `revogado_em`;
 *  4) usuário do vínculo existe;
 *  5) Admin Master → libera (bypass);
 *  6) canary ligado → SOMENTE Admin Master passa;
 *  7) beta fechada → usuário precisa estar em `whatsapp_beta_access`
 *     (RPC `can_use_whatsapp`) E ter plano elegível para WhatsApp
 *     (paid plan: pessoal_premium / mei_essencial / mei_inteligente /
 *     empresa). free, free_ads, pessoal_manual, sem_assinatura → bloqueados.
 *
 * Retorna apenas `{ allowed, userId? }` ao caller — nunca o motivo
 * detalhado (evita enumeração de contas/planos por terceiros).
 *
 * Falhas internas (DB indisponível, RPC erro) sempre resultam em
 * `{ allowed: false }` — fail closed.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "crypto";
import { checkRateLimit } from "./rate-limit.server";
import { hasAdminMasterRole } from "./admin-master.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;


export type AuthzResult = {
  allowed: boolean;
  userId?: string;
};

/**
 * Normaliza para E.164 brasileiro (apenas dígitos). Aceita variações
 * com/sem DDI 55. Retorna `null` se inválido.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function hashPhone(digits: string): string {
  return createHash("sha256").update(digits).digest("hex").slice(0, 32);
}

async function isAdminMaster(userId: string): Promise<{ isAdmin: boolean }> {
  try {
    const isAdmin = await hasAdminMasterRole(userId);
    return { isAdmin };
  } catch {
    return { isAdmin: false };
  }
}

/**
 * Gate único. Não emite nenhum sinal externo (sem reply, sem log
 * sensível); o caller decide o que fazer com `allowed=false`.
 *
 * WA-C11 Fase 1 — a decisão de plano/beta é delegada a
 * `getWhatsAppEntitlement` (fonte única). Este módulo cuida somente da
 * resolução telefone → user_id + link ativo + opt-in.
 */
export async function canUseWhatsAppForSender(
  senderPhone: string | null | undefined,
  opts?: { canaryOnly?: boolean },
): Promise<AuthzResult> {
  const digits = normalizePhone(senderPhone);
  if (!digits) return { allowed: false };

  try {
    const candidatos = new Set<string>([digits]);
    if (digits.startsWith("55")) candidatos.add(digits.slice(2));
    else candidatos.add(`55${digits}`);

    // (1)(2)(3)(4) — vínculo ativo + consentimento + não revogado.
    const { data: link } = await sb
      .from("whatsapp_links")
      .select("user_id, ativo, opt_in_em, revogado_em")
      .in("telefone", Array.from(candidatos))
      .limit(1)
      .maybeSingle();
    if (!link || !link.user_id) return { allowed: false };
    if (!link.ativo || link.revogado_em || !link.opt_in_em) return { allowed: false };

    const userId: string = link.user_id;

    // (5) Admin Master sempre passa (bypass explícito, auditado).
    const { isAdmin } = await isAdminMaster(userId);
    if (isAdmin) return { allowed: true, userId };

    // (6) Canary fechado: só admin master.
    if (opts?.canaryOnly) return { allowed: false };

    // (7) WA-C11 Fase 1 — Delegação para a fonte única de entitlement.
    // Cobre: plano elegível (SQL `has_feature_access`) + beta_access +
    // assinatura ativa/não cancelada/não expirada. Gratuito com beta
    // ativo permanece BLOQUEADO por construção.
    try {
      const { getWhatsAppEntitlement } = await import(
        "@/server/whatsapp-entitlement.server"
      );
      const ent = await getWhatsAppEntitlement(userId);
      if (!ent.allowed) return { allowed: false };
    } catch {
      return { allowed: false };
    }

    return { allowed: true, userId };
  } catch {
    return { allowed: false };
  }
}

/**
 * Mensagem neutra (sem PII, sem revelar existência de conta/plano)
 * para responder a um número não autorizado que envia TEXTO.
 *
 * Para imagens/PDFs/áudios/vídeos de números não autorizados: NÃO
 * use esta função — apenas descarte em silêncio (200 OK).
 */
export const WHATSAPP_BLOCKED_REPLY =
  "Este número ainda não está autorizado a usar o WhatsApp do Gasto Inteligente.\n\n" +
  "Para continuar, crie ou acesse sua conta, conecte este mesmo número e tenha um plano elegível.";

/**
 * Decide se podemos enviar a mensagem de "não autorizado" agora.
 * Rate limit: 1 envio por número a cada 24 horas. A chave persistida é
 * apenas o hash truncado do telefone — telefone bruto nunca é gravado em
 * `rate_limit_events.key`.
 */
export async function shouldSendBlockedReply(
  senderPhone: string | null | undefined,
): Promise<boolean> {
  const digits = normalizePhone(senderPhone);
  if (!digits) return false;
  const key = `wa_blocked_reply:${hashPhone(digits)}`;
  const r = await checkRateLimit({
    key,
    route: "/api/public/whatsapp/expense#blocked",
    limit: 1,
    windowSeconds: 24 * 60 * 60,
    method: "POST",
  });
  return !r.blocked;
}
