/**
 * WA-C11 FASE 3B.2.E — Opt-out incondicional via WhatsApp.
 *
 * SERVER-ONLY. Reconhece comandos determinísticos de revogação de
 * consentimento e retorna a intenção. A revogação em si é aplicada pelo
 * caller (webhook inbound) ANTES de qualquer outra decisão de fluxo
 * (runtime, entitlement, beta, rollout, quota, IA, OCR, parser).
 *
 * Regras invioláveis:
 *   - Reconhecimento por MENSAGEM INTEGRAL normalizada (sem acento,
 *     sem case, sem pontuação de borda) — nunca por substring.
 *   - Frases financeiras comuns ("cancelar conta", "parar pagamento",
 *     "sair da fatura", "descadastrar cartão") NUNCA são opt-out.
 *   - A ação de opt-out não depende de plano, entitlement, quota,
 *     rollout ou beta. Sempre pode ser executada.
 *   - Logs sanitizados: hash do user_id, ação, origem. Nunca telefone,
 *     nunca texto original, nunca payload.
 */

// Base de comandos aceitos (normalizados: minúsculas, sem acento, sem
// pontuação nas bordas). ORDEM: itens mais longos primeiro para evitar
// que "parar de receber" seja subsumido por "parar" quando ambos são
// mensagens integrais.
const OPTOUT_COMMANDS: readonly string[] = Object.freeze([
  // Frases claras e não-ambíguas de revogação
  "parar de receber mensagens",
  "parar de receber",
  "nao quero mais mensagens",
  "nao quero mais receber",
  "nao quero mais",
  "remover whatsapp",
  "desativar whatsapp",
  "cancelar whatsapp",
  "sair do whatsapp",
  "descadastrar whatsapp",
  "descadastrar do whatsapp",
  // Comandos curtos — só válidos quando MENSAGEM INTEGRAL (após normalização)
  "parar",
  "sair",
  "cancelar",
  "descadastrar",
  "stop",
  "unsubscribe",
]);

// Frases que CONTÊM palavras de opt-out mas NÃO são opt-out. Servem como
// smoke-test e documentação. Nunca são consultadas em runtime.
export const OPTOUT_FALSE_POSITIVES: readonly string[] = Object.freeze([
  "cancelar conta",
  "cancelar pagamento",
  "cancelar boleto",
  "cancelar pix",
  "parar pagamento",
  "parar cartao",
  "sair da fatura",
  "sair do cartao",
  "descadastrar cartao",
  "remover cartao",
  "desativar cartao",
]);

/**
 * Normaliza mensagem para reconhecimento:
 *   - remove diacríticos (á → a, ç → c)
 *   - lowercase
 *   - colapsa espaços internos
 *   - remove pontuação apenas nas BORDAS
 */
export function normalizeOptoutInput(raw: string): string {
  if (typeof raw !== "string") return "";
  const noDiacritics = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const lower = noDiacritics.toLowerCase();
  // Colapsa whitespace interno; remove apenas pontuação nas bordas.
  const collapsed = lower.replace(/\s+/g, " ").trim();
  return collapsed.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").trim();
}

export interface OptoutDetection {
  isOptout: boolean;
  matchedCommand: string | null;
}

/**
 * Detecta opt-out por comparação de MENSAGEM INTEGRAL normalizada.
 * NUNCA por substring — "cancelar conta" jamais dispara "cancelar".
 */
export function detectOptout(rawText: string): OptoutDetection {
  const norm = normalizeOptoutInput(rawText);
  if (!norm) return { isOptout: false, matchedCommand: null };
  for (const cmd of OPTOUT_COMMANDS) {
    if (norm === cmd) {
      return { isOptout: true, matchedCommand: cmd };
    }
  }
  return { isOptout: false, matchedCommand: null };
}

/**
 * Hash curto e determinístico para logs (não-reversível para telefone/PII).
 */
function safeHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export interface OptoutAuditRecord {
  userIdHash: string;
  origin: "whatsapp" | "web";
  action: "revoke_consent";
  matchedCommand: string | null;
  previousActive: boolean;
  newActive: false;
  pendingInvalidated: number;
  correlationId: string;
  at: string;
}

/**
 * Constrói o registro de auditoria sanitizado. Nunca inclui telefone,
 * texto original, dados financeiros ou payload da Meta.
 */
export function buildOptoutAudit(args: {
  userId: string;
  origin: "whatsapp" | "web";
  matchedCommand: string | null;
  previousActive: boolean;
  pendingInvalidated: number;
  correlationId: string;
  now?: Date;
}): OptoutAuditRecord {
  return {
    userIdHash: safeHash(args.userId),
    origin: args.origin,
    action: "revoke_consent",
    matchedCommand: args.matchedCommand,
    previousActive: args.previousActive,
    newActive: false,
    pendingInvalidated: Math.max(0, args.pendingInvalidated | 0),
    correlationId: args.correlationId,
    at: (args.now ?? new Date()).toISOString(),
  };
}

/**
 * Executor server-side. Revoga o vínculo e invalida notifications
 * pending seguras (sem attempt em curso). NUNCA toca:
 *   - processing, sending, ambiguous, sent, delivered, read
 *   - canary v1
 *   - histórico de mensagens
 *   - dados financeiros
 */
export async function executeOptoutRevocation(args: {
  userId: string;
  origin: "whatsapp" | "web";
  matchedCommand: string | null;
  correlationId: string;
  now?: Date;
  // Injeção para testes
  client?: unknown;
}): Promise<{
  ok: boolean;
  audit: OptoutAuditRecord | null;
  reason?: string;
}> {
  // Load client lazy: proteção do bundle client-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sb: any;
  if (args.client) {
    sb = args.client;
  } else {
    const mod = await import("@/integrations/supabase/client.server");
    sb = mod.supabaseAdmin;
  }

  // 1) Snapshot atual dos vínculos ativos.
  const { data: links, error: selErr } = await sb
    .from("whatsapp_links")
    .select("id, ativo, revogado_em")
    .eq("user_id", args.userId);
  if (selErr) {
    return { ok: false, audit: null, reason: "select_error" };
  }
  const activeLinks = (links ?? []).filter(
    (l: { ativo: boolean; revogado_em: string | null }) => l.ativo && !l.revogado_em,
  );
  const previousActive = activeLinks.length > 0;

  // 2) Revoga todos os vínculos do usuário (soft revoke).
  if (previousActive) {
    const nowIso = (args.now ?? new Date()).toISOString();
    const { error: updErr } = await sb
      .from("whatsapp_links")
      .update({ ativo: false, revogado_em: nowIso })
      .eq("user_id", args.userId)
      .is("revogado_em", null);
    if (updErr) {
      return { ok: false, audit: null, reason: "revoke_error" };
    }
  }

  // 3) Invalida SOMENTE notifications pending sem attempt em curso.
  //    Nunca toca processing/sending/ambiguous/sent/delivered/read/canary.
  let pendingInvalidated = 0;
  try {
    const { data: cancelled } = await sb
      .from("whatsapp_notifications")
      .update({ status: "cancelled", cancelled_at: (args.now ?? new Date()).toISOString() })
      .eq("user_id", args.userId)
      .eq("status", "pending")
      .is("claim_token", null)
      .select("id");
    pendingInvalidated = Array.isArray(cancelled) ? cancelled.length : 0;
  } catch {
    // Não bloqueia a revogação principal por falha do cleanup.
  }

  const audit = buildOptoutAudit({
    userId: args.userId,
    origin: args.origin,
    matchedCommand: args.matchedCommand,
    previousActive,
    pendingInvalidated,
    correlationId: args.correlationId,
    now: args.now,
  });

  try {
    console.info("[wa-optout]", JSON.stringify(audit));
  } catch {
    // no-op
  }

  return { ok: true, audit };
}
