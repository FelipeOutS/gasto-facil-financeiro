/**
 * WA-C11 FASE 3B.2.C — Financial Action Quota Gate (defesa em profundidade).
 *
 * SERVER-ONLY. Chamado pelos 10 call sites financeiros do WhatsApp
 * (gasto texto/áudio, comprovante, pagar-pessoa, Pix, receita única,
 * receita recorrente, baixa de conta, parcelamento, criação de conta
 * por texto, criação de conta por boleto) ANTES da escrita real ou
 * RPC financeira.
 *
 * Ordem canônica (fail-closed em qualquer erro):
 *   1) runtime.global_enabled  → bloqueia todas ações se OFF
 *   2) entitlement (plano + beta + admin master) → bloqueia se revogado
 *   3) resolveCycleForPlan → bloqueia se ciclo inválido
 *   4) consumeFinancialActionQuota (atômica, idempotente pela key)
 *
 * NÃO revalida rollout: para fluxos síncronos dentro do mesmo inbound,
 * o rollout já foi validado pelo `runInboundProductionGate`. Fluxos
 * assíncronos podem ser cobertos em fase futura.
 *
 * Regras invioláveis:
 *   - `externalMessageId` obrigatório e não vazio (rejeita internal_error).
 *   - Idempotency key: `wa:financial:<messageId>:<actionType>[:<disc>]:v1`.
 *     Estável, determinística, jamais Date.now/UUID/texto/valor.
 *   - Admin Master: pula quota (não há linha em `whatsapp_plan_quotas`
 *     para admin_master) mas NÃO ignora runtime OFF.
 *   - Logs sanitizados: nunca telefone, valor, descrição, PII.
 *   - Não confia em input do cliente; user_id vem sempre do inbound gate.
 *
 * Compensação: NÃO existe RPC de compensação nesta fase. A janela
 * "consumo consumado + write falha pré-commit" é milissegundos e o
 * retry usa a MESMA key → `duplicate=true` sem nova cobrança. Escritas
 * financeiras têm seu próprio dedupe (constraints, RPCs atômicas,
 * claims `_persistindo` por `external_id`). Nenhuma condição gera
 * duplicação financeira real.
 */
import { readRuntimeConfig } from "@/server/whatsapp-runtime-config.server";
import {
  getWhatsAppEntitlement,
  type EntitlementResult,
} from "@/server/whatsapp-entitlement.server";
import {
  resolveCycleForPlan,
  type Cycle,
  type PlanRow,
} from "@/server/whatsapp-cycle-resolver.server";
import {
  consumeFinancialActionQuota,
  type QuotaConsumeResult,
} from "@/server/whatsapp-quota.server";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos

export type FinancialActionType =
  | "expense" // gasto por texto/áudio (whatsapp.server.ts:persistirGasto)
  | "expense_receipt" // gasto por comprovante (whatsapp-comprovantes.server.ts)
  | "expense_pay_person" // pagar-pessoa flow (com claim pp_persistindo)
  | "expense_pix" // pix intents "paguei X"
  | "income_single" // receita única
  | "income_recurring" // receita recorrente (RPC create_recurring_income)
  | "bill_payment" // baixa de conta (whatsapp_baixa_conta_atomic)
  | "installment" // parcelamento (create_installment_purchase)
  | "bill_create_text" // criação de conta por texto
  | "bill_create_boleto"; // criação de conta por boleto (OCR/manual)

export type FinancialGateReason =
  | "allowed"
  | "duplicate"
  | "invalid_input"
  | "runtime_global_off"
  | "entitlement_denied"
  | "cycle_invalid"
  | "quota_denied"
  | "internal_error";

export interface FinancialQuotaGateOutcome {
  allowed: boolean;
  reason: FinancialGateReason;
  duplicate: boolean;
  adminMaster: boolean;
  planCode: string | null;
  idempotencyKey: string | null;
  cycleSource: Cycle["source"] | null;
  quota: { limit: number; used: number; remaining: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Injeção para testes

export interface FinancialGateDeps {
  client?: unknown;
  now?: () => Date;
  readRuntimeConfig?: typeof readRuntimeConfig;
  getWhatsAppEntitlement?: typeof getWhatsAppEntitlement;
  consumeFinancialActionQuota?: typeof consumeFinancialActionQuota;
  loadPlanRow?: (userId: string) => Promise<PlanRow | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos

async function defaultLoadPlanRow(userId: string): Promise<PlanRow | null> {
  try {
    const { data } = await sb
      .from("user_plans")
      .select("plano, status, current_period_start, current_period_end, access_until")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      plano: typeof r.plano === "string" ? r.plano : null,
      status: typeof r.status === "string" ? r.status : null,
      current_period_start:
        typeof r.current_period_start === "string" ? r.current_period_start : null,
      current_period_end:
        typeof r.current_period_end === "string" ? r.current_period_end : null,
      access_until: typeof r.access_until === "string" ? r.access_until : null,
    };
  } catch {
    return null;
  }
}

function hashId(id: string): string {
  return id.slice(0, 8);
}

function safeLog(event: string, extra: Record<string, unknown>): void {
  try {
    console.info("[wa-financial-gate]", JSON.stringify({ event, ...extra }));
  } catch {
    // no-op
  }
}

function blocked(
  reason: FinancialGateReason,
  extra?: Partial<FinancialQuotaGateOutcome>,
): FinancialQuotaGateOutcome {
  return {
    allowed: false,
    reason,
    duplicate: false,
    adminMaster: false,
    planCode: null,
    idempotencyKey: null,
    cycleSource: null,
    quota: null,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency key builder

/**
 * Constrói a idempotency key canônica.
 *
 * Formato: `wa:financial:<messageId>:<actionType>[:<discriminator>]:v1`.
 *
 * O discriminator deve ser determinístico (índice de parcela, ocorrência
 * recorrente, etapa confirmada) — nunca timestamp, UUID aleatório, texto
 * livre ou valor financeiro.
 *
 * Uma mesma mensagem que gera apenas UMA entidade financeira legítima
 * (mesmo com múltiplas linhas físicas — ex.: 12 parcelas de um cartão
 * ou 12 ocorrências de uma conta recorrente) usa UMA única key, sem
 * discriminator, e portanto consome UMA unidade de quota.
 */
export function buildFinancialActionKey(
  messageId: string,
  actionType: FinancialActionType,
  discriminator?: string,
): string {
  const base = `wa:financial:${messageId}:${actionType}:v1`;
  if (discriminator && discriminator.length > 0) {
    return `wa:financial:${messageId}:${actionType}:${discriminator}:v1`;
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate principal

/**
 * Aplica quota financeira do WhatsApp. Chamado ANTES da escrita real
 * (insert/RPC). Deve ser chamado DEPOIS do claim `_persistindo` quando
 * o fluxo tiver claim.
 *
 * Contrato:
 *   - `userId` deve vir do inbound gate (nunca do cliente).
 *   - `externalMessageId` = `msg.external_id` do webhook Meta.
 *     Rejeitado se vazio (`internal_error`).
 *   - `actionType` identifica o call site para logs e idempotência.
 *   - `discriminator` opcional apenas quando a mesma mensagem gera
 *     MÚLTIPLAS entidades financeiras distintas legítimas.
 *
 * Retorno semântico:
 *   - `allowed=true, duplicate=false` → caller pode escrever livremente.
 *     Uma unidade de quota FOI consumida.
 *   - `allowed=true, duplicate=true` → retry Meta / reprocessamento
 *     legítimo. Nenhuma nova unidade consumida. Caller pode escrever
 *     (a idempotência da escrita cuida do resto) OU pular (a escrita
 *     já ocorreu na primeira vez).
 *   - `allowed=false` → NÃO escrever. Retornar mensagem neutra ao usuário.
 */
export async function assertFinancialActionQuotaForWhatsApp(
  args: {
    userId: string;
    externalMessageId: string;
    actionType: FinancialActionType;
    discriminator?: string;
  },
  deps?: FinancialGateDeps,
): Promise<FinancialQuotaGateOutcome> {
  const uHash = args.userId ? hashId(args.userId) : "";
  const at = args.actionType;

  // 0) Input validation (fail-closed).
  if (!args.userId || typeof args.userId !== "string" || args.userId.length < 8) {
    safeLog("invalid_user", { at });
    return blocked("invalid_input");
  }
  if (
    !args.externalMessageId ||
    typeof args.externalMessageId !== "string" ||
    args.externalMessageId.trim().length === 0
  ) {
    safeLog("invalid_msgid", { u: uHash, at });
    return blocked("invalid_input");
  }

  const idempotencyKey = buildFinancialActionKey(
    args.externalMessageId,
    args.actionType,
    args.discriminator,
  );
  const idemHash = hashId(idempotencyKey);

  try {
    // 1) Runtime global — kill switch acima de tudo.
    const readRC = deps?.readRuntimeConfig ?? readRuntimeConfig;
    const rc = await readRC(deps?.client);
    if (!rc.global_enabled) {
      safeLog("blocked", { u: uHash, at, r: "runtime_global_off", k: idemHash });
      return blocked("runtime_global_off", { idempotencyKey });
    }

    // 2) Entitlement (plano + beta + admin master).
    const getEnt = deps?.getWhatsAppEntitlement ?? getWhatsAppEntitlement;
    const ent: EntitlementResult = await getEnt(args.userId);
    if (!ent.allowed) {
      safeLog("blocked", {
        u: uHash,
        at,
        r: "entitlement_denied",
        er: ent.reason,
        k: idemHash,
      });
      return blocked("entitlement_denied", {
        idempotencyKey,
        adminMaster: ent.adminMaster,
      });
    }

    // 3) Load plan for cycle resolution.
    const loadPlan = deps?.loadPlanRow ?? defaultLoadPlanRow;
    const plan = await loadPlan(args.userId);

    // 4) Admin Master: quota financeira não tem linha em `whatsapp_plan_quotas`
    //    para `admin_master`. Skip explícito, mantendo runtime OFF como kill.
    if (ent.adminMaster) {
      safeLog("allowed", { u: uHash, at, admin: true, k: idemHash });
      return {
        allowed: true,
        reason: "allowed",
        duplicate: false,
        adminMaster: true,
        planCode: plan?.plano ?? null,
        idempotencyKey,
        cycleSource: null,
        quota: null,
      };
    }

    // 5) Cycle window.
    const now = deps?.now?.() ?? new Date();
    const cycle = resolveCycleForPlan(plan, now);
    if (cycle.source === "invalid") {
      safeLog("blocked", { u: uHash, at, r: "cycle_invalid", k: idemHash });
      return blocked("cycle_invalid", {
        idempotencyKey,
        planCode: plan?.plano ?? null,
      });
    }

    // 6) Atomic consume (idempotente por idempotencyKey).
    const consume = deps?.consumeFinancialActionQuota ?? consumeFinancialActionQuota;
    const q: QuotaConsumeResult = await consume(
      {
        userId: args.userId,
        idempotencyKey,
        planCode: plan?.plano ?? "free_ads",
        cycle: { cycleStart: cycle.cycleStart, cycleEnd: cycle.cycleEnd },
        now,
      },
      deps?.client,
    );

    if (!q.allowed) {
      safeLog("blocked", {
        u: uHash,
        at,
        r: "quota_denied",
        qr: q.reason,
        k: idemHash,
      });
      return {
        allowed: false,
        reason: "quota_denied",
        duplicate: false,
        adminMaster: false,
        planCode: plan?.plano ?? null,
        idempotencyKey,
        cycleSource: cycle.source,
        quota: { limit: q.limit, used: q.used, remaining: q.remaining },
      };
    }

    if (q.duplicate) {
      safeLog("duplicate", {
        u: uHash,
        at,
        k: idemHash,
        remaining: q.remaining,
      });
      return {
        allowed: true,
        reason: "duplicate",
        duplicate: true,
        adminMaster: false,
        planCode: plan?.plano ?? null,
        idempotencyKey,
        cycleSource: cycle.source,
        quota: { limit: q.limit, used: q.used, remaining: q.remaining },
      };
    }

    safeLog("allowed", {
      u: uHash,
      at,
      k: idemHash,
      remaining: q.remaining,
    });
    return {
      allowed: true,
      reason: "allowed",
      duplicate: false,
      adminMaster: false,
      planCode: plan?.plano ?? null,
      idempotencyKey,
      cycleSource: cycle.source,
      quota: { limit: q.limit, used: q.used, remaining: q.remaining },
    };
  } catch {
    safeLog("exception", { u: uHash, at, k: idemHash });
    return blocked("internal_error", { idempotencyKey });
  }
}

/**
 * Mensagem neutra e sem PII para retornar ao usuário quando o gate
 * bloqueia. Não expõe counters detalhados. Templates comerciais ficam
 * para a Fase 4.
 */
export function financialQuotaBlockedReply(outcome: FinancialQuotaGateOutcome): string {
  if (outcome.reason === "quota_denied" && outcome.quota) {
    return (
      "Você atingiu o limite mensal de ações do seu plano no WhatsApp. " +
      "Você poderá continuar registrando aqui pelo app. " +
      "No próximo ciclo o limite é renovado automaticamente."
    );
  }
  if (outcome.reason === "entitlement_denied") {
    return (
      "No momento este número não está habilitado para registrar ações via WhatsApp. " +
      "Você pode continuar usando o app normalmente."
    );
  }
  return (
    "Não consegui processar essa ação agora pelo WhatsApp. " +
    "Tente novamente daqui a pouco ou use o app."
  );
}
