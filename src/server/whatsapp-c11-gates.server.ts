/**
 * WA-C11 FASE 3B.2.B — Gates unificados de superfície produtiva.
 *
 * SERVER-ONLY. Duas superfícies protegidas neste módulo:
 *   1) `runInboundProductionGate` — chamado pela rota inbound
 *      `/api/public/whatsapp/expense`, ANTES de qualquer download de mídia,
 *      Whisper, OCR, LLM, parser financeiro, resposta ao usuário ou
 *      persistência. Consome quota inbound atomicamente com
 *      idempotency key = `external_id` da Meta.
 *   2) `canCreateNotificationForUser` — chamado por qualquer produtor de
 *      `whatsapp_notifications` (ex.: `gerarLembretesContasUsuario`), ANTES
 *      do insert/upsert. NÃO consome nem reserva quota outbound —
 *      apenas confere capacidade via `getUsageSnapshot`. A reserva outbound
 *      é responsabilidade do dispatcher (WA-C11 Fase 3B.2.d).
 *
 * Ordem canônica (aplicada em cada superfície na ordem exata do prompt):
 *   runtime.global_enabled → runtime.{inbound|creation}_enabled →
 *   entitlement (plano + beta + admin master + link/opt-in [creation]) →
 *   rollout determinístico via RPC `whatsapp_user_in_rollout` →
 *   `resolveCycleForPlan` → quota (inbound: consume atômico; creation:
 *   snapshot capacidade outbound).
 *
 * Regras invioláveis:
 *   - Fail-closed em qualquer erro (read runtime, load plan, RPC).
 *   - Admin Master NÃO ignora runtime OFF nem env OFF (kill switch
 *     operacional é acima de tudo). Admin Master ignora plano/beta/
 *     rollout via `getWhatsAppEntitlement` (que já retorna
 *     `reason=admin_master, betaAllowed=true`) e ignora capacidade
 *     outbound (não há linha em `whatsapp_plan_quotas` para
 *     admin_master; skip explícito).
 *   - Idempotency key inbound: sempre `external_message_id` da Meta.
 *     Nunca timestamp, telefone, texto ou UUID gerado.
 *   - Logs sanitizados: nenhum telefone, texto, PII, counters brutos.
 *   - Nenhuma decisão confia em input do cliente.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { readRuntimeConfig } from "@/server/whatsapp-runtime-config.server";
import {
  getWhatsAppEntitlement,
  type EntitlementResult,
} from "@/server/whatsapp-entitlement.server";
import { evaluateRollout } from "@/server/whatsapp-rollout.server";
import {
  resolveCycleForPlan,
  type Cycle,
  type PlanRow,
} from "@/server/whatsapp-cycle-resolver.server";
import {
  consumeInboundQuota,
  getUsageSnapshot,
  type QuotaConsumeResult,
} from "@/server/whatsapp-quota.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos

export type InboundGateDenyReason =
  | "runtime_global_off"
  | "runtime_inbound_off"
  | "entitlement_denied"
  | "rollout_denied"
  | "cycle_invalid"
  | "quota_denied"
  | "internal_error";

export type InboundGateOkReason = "allowed" | "duplicate";

export interface InboundGateOutcome {
  allowed: boolean;
  reason: InboundGateDenyReason | InboundGateOkReason;
  duplicate: boolean;
  adminMaster: boolean;
  planCode: string | null;
  cycleSource: Cycle["source"] | null;
  quota: { limit: number; used: number; remaining: number } | null;
}

export type NotifCreationGateReason =
  | "allowed"
  | "runtime_global_off"
  | "runtime_creation_off"
  | "entitlement_denied"
  | "rollout_denied"
  | "cycle_invalid"
  | "capacity_read_failed"
  | "quota_capacity_zero"
  | "internal_error";

export interface NotifCreationGateOutcome {
  allowed: boolean;
  reason: NotifCreationGateReason;
  adminMaster: boolean;
  planCode: string | null;
  cycleSource: Cycle["source"] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Injeção para testes

export interface GateDeps {
  client?: unknown;
  now?: () => Date;
  readRuntimeConfig?: typeof readRuntimeConfig;
  getWhatsAppEntitlement?: typeof getWhatsAppEntitlement;
  evaluateRollout?: typeof evaluateRollout;
  consumeInboundQuota?: typeof consumeInboundQuota;
  getUsageSnapshot?: typeof getUsageSnapshot;
  loadPlanRow?: (userId: string) => Promise<PlanRow | null>;
}

function nowOf(deps?: GateDeps): Date {
  return deps?.now?.() ?? new Date();
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
      current_period_end: typeof r.current_period_end === "string" ? r.current_period_end : null,
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
    console.info("[wa-c11-gate]", JSON.stringify({ event, ...extra }));
  } catch {
    // no-op
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound

export function isInboundGateOk(o: InboundGateOutcome): boolean {
  return o.allowed;
}

/**
 * Gate produtivo do inbound. Precisa que o caller já tenha:
 *   - validado HMAC;
 *   - parseado o payload;
 *   - descartado callbacks de status (rotam antes deste gate);
 *   - resolvido `userId` via `canUseWhatsAppForSender` (link ativo + opt-in);
 *   - preservado o `external_id` original da Meta como
 *     `externalMessageId` (idempotency key).
 *
 * Efeitos colaterais:
 *   - Em caminho feliz, consome 1 unidade da quota inbound do usuário
 *     atomicamente (RPC `whatsapp_consume_inbound_quota_atomic`).
 *   - Em reentrega Meta com o mesmo `external_id`, a RPC retorna
 *     `duplicate=true` e NÃO consome novamente.
 */
export async function runInboundProductionGate(
  args: { userId: string; externalMessageId: string },
  deps?: GateDeps,
): Promise<InboundGateOutcome> {
  const uHash = hashId(args.userId);
  const eHash = hashId(args.externalMessageId);

  try {
    if (!args.userId || typeof args.userId !== "string" || args.userId.length < 8) {
      safeLog("inbound_invalid_user", { u: uHash });
      return blockedInbound("internal_error");
    }
    if (
      !args.externalMessageId ||
      typeof args.externalMessageId !== "string" ||
      args.externalMessageId.trim().length === 0
    ) {
      safeLog("inbound_invalid_msgid", { u: uHash });
      return blockedInbound("internal_error");
    }

    // 1) Runtime config (fail-closed já implementado no reader).
    const readRC = deps?.readRuntimeConfig ?? readRuntimeConfig;
    const rc = await readRC(deps?.client);
    if (!rc.global_enabled) {
      safeLog("inbound_blocked", { u: uHash, e: eHash, r: "runtime_global_off" });
      return blockedInbound("runtime_global_off");
    }
    if (!rc.inbound_enabled) {
      safeLog("inbound_blocked", { u: uHash, e: eHash, r: "runtime_inbound_off" });
      return blockedInbound("runtime_inbound_off");
    }

    // 2) Load plan (para entitlement + rollout + ciclo + quota).
    const loadPlan = deps?.loadPlanRow ?? defaultLoadPlanRow;
    const plan = await loadPlan(args.userId);
    // plan pode ser null (usuário sem linha) — entitlement discrimina.

    // 3) Entitlement (plano + beta + admin master).
    const getEnt = deps?.getWhatsAppEntitlement ?? getWhatsAppEntitlement;
    const ent: EntitlementResult = await getEnt(args.userId);
    if (!ent.allowed) {
      safeLog("inbound_blocked", { u: uHash, e: eHash, r: "entitlement_denied", er: ent.reason });
      return blockedInbound("entitlement_denied", ent.adminMaster);
    }

    // 4) Rollout — Admin Master ignora.
    if (!ent.adminMaster) {
      const evalRO = deps?.evaluateRollout ?? evaluateRollout;
      const roll = await evalRO(
        {
          userId: args.userId,
          planCode: plan?.plano ?? null,
          betaAllowed: ent.betaAllowed,
          rolloutEnabled: rc.rollout_enabled,
          rolloutPercentage: rc.rollout_percentage,
        },
        deps?.client,
      );
      if (!roll.allowed) {
        safeLog("inbound_blocked", {
          u: uHash,
          e: eHash,
          r: "rollout_denied",
          rr: roll.reason,
        });
        return blockedInbound("rollout_denied", false, plan?.plano ?? null);
      }
    }

    // 5) Ciclo.
    const now = nowOf(deps);
    const cycle = resolveCycleForPlan(plan, now);
    if (cycle.source === "invalid") {
      safeLog("inbound_blocked", { u: uHash, e: eHash, r: "cycle_invalid" });
      return blockedInbound("cycle_invalid", ent.adminMaster, plan?.plano ?? null);
    }

    // 6) Consumo atômico da quota inbound (idempotente por external_id).
    // Admin Master usa plano_code de quota "admin_master" que pode não
    // existir — nesse caso a RPC responde denied. Para admin, forçamos
    // um plan_code que sempre tem quota liberada; o design da Fase 3A
    // usa `plan_code` da tabela `whatsapp_plan_quotas`. Como não há
    // linha admin_master, usamos o plano real do admin (se houver) OU
    // pulamos a quota — decisão: pulamos para admin master.
    if (ent.adminMaster) {
      safeLog("inbound_allowed", { u: uHash, e: eHash, admin: true });
      return {
        allowed: true,
        reason: "allowed",
        duplicate: false,
        adminMaster: true,
        planCode: plan?.plano ?? null,
        cycleSource: cycle.source,
        quota: null,
      };
    }

    const consume = deps?.consumeInboundQuota ?? consumeInboundQuota;
    const q: QuotaConsumeResult = await consume(
      {
        userId: args.userId,
        inboundMessageId: args.externalMessageId,
        planCode: plan?.plano ?? "free_ads",
        cycle: { cycleStart: cycle.cycleStart, cycleEnd: cycle.cycleEnd },
        now,
      },
      deps?.client,
    );

    if (!q.allowed) {
      safeLog("inbound_blocked", {
        u: uHash,
        e: eHash,
        r: "quota_denied",
        qr: q.reason,
      });
      return {
        allowed: false,
        reason: "quota_denied",
        duplicate: false,
        adminMaster: false,
        planCode: plan?.plano ?? null,
        cycleSource: cycle.source,
        quota: { limit: q.limit, used: q.used, remaining: q.remaining },
      };
    }

    // Duplicate é caminho OK: mesma mensagem já foi contada. Caller
    // pode continuar (dedupe existente por `whatsapp_messages.external_id`
    // barra reprocessamento financeiro) OU pular processamento; ambos
    // são idempotentes.
    safeLog("inbound_allowed", {
      u: uHash,
      e: eHash,
      dup: q.duplicate,
      remaining: q.remaining,
    });
    return {
      allowed: true,
      reason: q.duplicate ? "duplicate" : "allowed",
      duplicate: q.duplicate,
      adminMaster: false,
      planCode: plan?.plano ?? null,
      cycleSource: cycle.source,
      quota: { limit: q.limit, used: q.used, remaining: q.remaining },
    };
  } catch {
    safeLog("inbound_exception", { u: uHash, e: eHash });
    return blockedInbound("internal_error");
  }
}

function blockedInbound(
  reason: InboundGateDenyReason,
  adminMaster = false,
  planCode: string | null = null,
): InboundGateOutcome {
  return {
    allowed: false,
    reason,
    duplicate: false,
    adminMaster,
    planCode,
    cycleSource: null,
    quota: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification creation

/**
 * Gate para produtores de `whatsapp_notifications`. Chamado por
 * `gerarLembretesContasUsuario` e futuros produtores (alertas, metas,
 * insights). NÃO reserva quota outbound (isso é do dispatcher). Apenas
 * confere:
 *   - runtime `global_enabled` + `notification_creation_enabled`;
 *   - entitlement completo (plano + beta + link ativo + opt-in);
 *   - rollout determinístico;
 *   - ciclo válido;
 *   - capacidade outbound disponível (snapshot read-only).
 */
export async function canCreateNotificationForUser(
  args: { userId: string },
  deps?: GateDeps,
): Promise<NotifCreationGateOutcome> {
  const uHash = hashId(args.userId);

  try {
    if (!args.userId || typeof args.userId !== "string" || args.userId.length < 8) {
      safeLog("notif_invalid_user", { u: uHash });
      return blockedNotif("internal_error");
    }

    // 1) Runtime config.
    const readRC = deps?.readRuntimeConfig ?? readRuntimeConfig;
    const rc = await readRC(deps?.client);
    if (!rc.global_enabled) {
      safeLog("notif_blocked", { u: uHash, r: "runtime_global_off" });
      return blockedNotif("runtime_global_off");
    }
    if (!rc.notification_creation_enabled) {
      safeLog("notif_blocked", { u: uHash, r: "runtime_creation_off" });
      return blockedNotif("runtime_creation_off");
    }

    // 2) Plan.
    const loadPlan = deps?.loadPlanRow ?? defaultLoadPlanRow;
    const plan = await loadPlan(args.userId);

    // 3) Entitlement (com link/opt-in obrigatório).
    const getEnt = deps?.getWhatsAppEntitlement ?? getWhatsAppEntitlement;
    const ent: EntitlementResult = await getEnt(args.userId, { requireLink: true });
    if (!ent.allowed) {
      safeLog("notif_blocked", { u: uHash, r: "entitlement_denied", er: ent.reason });
      return blockedNotif("entitlement_denied", ent.adminMaster, plan?.plano ?? null);
    }

    // 4) Rollout (Admin Master ignora).
    if (!ent.adminMaster) {
      const evalRO = deps?.evaluateRollout ?? evaluateRollout;
      const roll = await evalRO(
        {
          userId: args.userId,
          planCode: plan?.plano ?? null,
          betaAllowed: ent.betaAllowed,
          rolloutEnabled: rc.rollout_enabled,
          rolloutPercentage: rc.rollout_percentage,
        },
        deps?.client,
      );
      if (!roll.allowed) {
        safeLog("notif_blocked", { u: uHash, r: "rollout_denied", rr: roll.reason });
        return blockedNotif("rollout_denied", false, plan?.plano ?? null);
      }
    }

    // 5) Ciclo.
    const now = nowOf(deps);
    const cycle = resolveCycleForPlan(plan, now);
    if (cycle.source === "invalid") {
      safeLog("notif_blocked", { u: uHash, r: "cycle_invalid" });
      return blockedNotif("cycle_invalid", ent.adminMaster, plan?.plano ?? null);
    }

    // 6) Capacidade outbound (não consumir; snapshot puro).
    // Admin Master não tem linha em `whatsapp_plan_quotas` — libera.
    if (ent.adminMaster) {
      safeLog("notif_allowed", { u: uHash, admin: true });
      return {
        allowed: true,
        reason: "allowed",
        adminMaster: true,
        planCode: plan?.plano ?? null,
        cycleSource: cycle.source,
      };
    }

    const snap = deps?.getUsageSnapshot ?? getUsageSnapshot;
    const s = await snap(
      {
        userId: args.userId,
        planCode: plan?.plano ?? "free_ads",
        cycle: { cycleStart: cycle.cycleStart, cycleEnd: cycle.cycleEnd },
      },
      deps?.client,
    );
    if (!s) {
      safeLog("notif_blocked", { u: uHash, r: "capacity_read_failed" });
      return blockedNotif("capacity_read_failed", false, plan?.plano ?? null);
    }
    // Mensal e diário devem ambos ter espaço se limites > 0. Limite 0
    // (plano gratuito) → zero capacidade → bloqueia.
    const monthlyRemaining = s.outboundLimit - (s.outboundReserved + s.outboundCommitted);
    const dailyRemaining =
      s.dailyOutboundLimit > 0 ? s.dailyOutboundLimit - s.dailyOutboundUsed : Infinity;
    if (s.outboundLimit <= 0 || monthlyRemaining <= 0 || dailyRemaining <= 0) {
      safeLog("notif_blocked", { u: uHash, r: "quota_capacity_zero" });
      return blockedNotif("quota_capacity_zero", false, plan?.plano ?? null);
    }

    safeLog("notif_allowed", { u: uHash, mr: monthlyRemaining });
    return {
      allowed: true,
      reason: "allowed",
      adminMaster: false,
      planCode: plan?.plano ?? null,
      cycleSource: cycle.source,
    };
  } catch {
    safeLog("notif_exception", { u: uHash });
    return blockedNotif("internal_error");
  }
}

function blockedNotif(
  reason: NotifCreationGateReason,
  adminMaster = false,
  planCode: string | null = null,
): NotifCreationGateOutcome {
  return { allowed: false, reason, adminMaster, planCode, cycleSource: null };
}
