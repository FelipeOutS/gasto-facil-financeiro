/**
 * WA-C11 FASE 1 — Fonte única e autoritativa de autorização do WhatsApp
 * por usuário. SERVER-ONLY.
 *
 * Este módulo é a ÚNICA fonte de verdade para "esse user_id pode operar o
 * WhatsApp do Gasto Inteligente agora?". Deve ser invocado em TODOS os
 * pontos críticos:
 *   - inbound (`/api/public/whatsapp/expense`) via `canUseWhatsAppForSender`;
 *   - criação de notification (`enqueueNotification`);
 *   - dispatcher (`/api/public/hooks/whatsapp-dispatcher`), no momento do
 *     envio, já com claim atômico feito.
 *
 * Regras invioláveis:
 *  1. Fonte primária do plano: SQL `public.has_feature_access(user_id, 'whatsapp')`.
 *     Cobre plano elegível + `has_active_plan_access` (cancelamento/expiração)
 *     + Admin Master (`is_full_access`).
 *  2. `whatsapp_beta_access` (via RPC `can_use_whatsapp`) atua como segunda
 *     condição DURANTE o rollout beta. Nunca substitui o plano — gratuito
 *     com beta ativo permanece BLOQUEADO.
 *  3. Admin Master (via `admin-master.server.ts`) mantém bypass explícito e
 *     auditável (identificado server-side por `auth.admin.getUserById`).
 *  4. Fail-closed em qualquer exceção: qualquer erro → `allowed=false`.
 *  5. Retorno sanitizado: sem PII, sem telefone, sem secret, sem email.
 *  6. Nenhuma decisão de plano confia em input do cliente (body, query,
 *     header, JWT claims, localStorage) — sempre revalida no banco.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminMasterEmail } from "@/server/admin-master.server";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import type { PlanTier } from "@/lib/plans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

/**
 * Motivos discriminados de decisão. Estáveis para logs/analytics.
 * NÃO expor PII. NÃO usar como texto voltado ao usuário final.
 */
export type EntitlementReason =
  | "allowed"
  | "admin_master"
  | "unknown_user"
  | "plan_not_eligible"
  | "subscription_inactive"
  | "subscription_expired"
  | "beta_access_missing"
  | "user_inactive"
  | "whatsapp_link_missing"
  | "whatsapp_link_inactive"
  | "opt_in_missing"
  | "internal_error";

export interface EntitlementResult {
  allowed: boolean;
  reason: EntitlementReason;
  plan: PlanTier | null;
  planActive: boolean;
  featureIncluded: boolean;
  betaAllowed: boolean;
  adminMaster: boolean;
  linkActive: boolean;
  optInActive: boolean;
  checkedAt: string;
}

export interface EntitlementOptions {
  /**
   * Quando true, o helper também verifica vínculo WhatsApp ativo + opt-in
   * válido (útil para gates de envio/dispatcher). No inbound essa camada
   * já é feita separadamente por `whatsapp-authz.server.ts`.
   */
  requireLink?: boolean;
  /**
   * Bypass para testes: injeta clientes mockados. Não usar em produção.
   */
  __client?: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function blocked(
  reason: EntitlementReason,
  extras: Partial<EntitlementResult> = {},
): EntitlementResult {
  return {
    allowed: false,
    reason,
    plan: null,
    planActive: false,
    featureIncluded: false,
    betaAllowed: false,
    adminMaster: false,
    linkActive: false,
    optInActive: false,
    checkedAt: nowIso(),
    ...extras,
  };
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await sb.auth.admin.getUserById(userId);
    const email: string | null = (data?.user?.email ?? "").trim().toLowerCase() || null;
    return email;
  } catch {
    return null;
  }
}

async function hasWhatsAppFeatureSQL(userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("has_feature_access", {
      _user_id: userId,
      _feature: "whatsapp",
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

async function hasBetaAccess(userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("can_use_whatsapp", { _user_id: userId });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

async function readActiveLink(
  userId: string,
): Promise<{ ok: boolean; reason: EntitlementReason }> {
  try {
    const { data } = await sb
      .from("whatsapp_links")
      .select("ativo, opt_in_em, revogado_em")
      .eq("user_id", userId)
      .order("opt_in_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { ok: false, reason: "whatsapp_link_missing" };
    const row = data as { ativo: boolean; opt_in_em: string | null; revogado_em: string | null };
    if (!row.ativo || row.revogado_em) return { ok: false, reason: "whatsapp_link_inactive" };
    if (!row.opt_in_em) return { ok: false, reason: "opt_in_missing" };
    return { ok: true, reason: "allowed" };
  } catch {
    return { ok: false, reason: "internal_error" };
  }
}

function mapSubscriptionToReason(sub: {
  active: boolean;
  status: string;
  plan: PlanTier;
}): EntitlementReason {
  if (sub.status === "expirado") return "subscription_expired";
  if (!sub.active) return "subscription_inactive";
  return "plan_not_eligible";
}

function hashUserId(userId: string): string {
  // Log-only. Não é criptográfico; usa apenas os primeiros 8 chars.
  return userId.slice(0, 8);
}

function logDecision(event: string, r: EntitlementResult, userId: string): void {
  try {
    console.info(
      "[wa-entitlement]",
      JSON.stringify({
        event,
        user_id_hash: hashUserId(userId),
        allowed: r.allowed,
        reason: r.reason,
        plan: r.plan,
        beta: r.betaAllowed,
        admin: r.adminMaster,
        checked_at: r.checkedAt,
      }),
    );
  } catch {
    // no-op
  }
}

/**
 * Retorna o estado completo do direito de uso do WhatsApp para um
 * `userId`. Nunca lança — falhas internas fecham (allowed=false,
 * reason='internal_error').
 */
export async function getWhatsAppEntitlement(
  userId: string | null | undefined,
  opts: EntitlementOptions = {},
): Promise<EntitlementResult> {
  if (!userId || typeof userId !== "string" || userId.length < 8) {
    const r = blocked("unknown_user");
    return r;
  }

  try {
    const email = await getUserEmail(userId);
    const isAdmin = isAdminMasterEmail(email);

    // Fonte primária — SQL. Cobre plano + assinatura + Admin Master.
    const featureIncluded = await hasWhatsAppFeatureSQL(userId);

    // Admin Master: bypass explícito. `has_feature_access` já retorna true
    // via `is_full_access`, mas mantemos a checagem independente para
    // registrar `reason=admin_master` corretamente e auditoria.
    if (isAdmin) {
      const r: EntitlementResult = {
        allowed: true,
        reason: "admin_master",
        plan: "admin_master",
        planActive: true,
        featureIncluded: true,
        betaAllowed: true,
        adminMaster: true,
        linkActive: false,
        optInActive: false,
        checkedAt: nowIso(),
      };
      if (opts.requireLink) {
        const link = await readActiveLink(userId);
        r.linkActive = link.ok || link.reason === "opt_in_missing"
          ? link.reason !== "whatsapp_link_missing" && link.reason !== "whatsapp_link_inactive"
          : false;
        r.optInActive = link.ok;
        // Admin Master preserva bypass mesmo sem link — decisão comercial
        // atual do canary. Não bloqueamos.
      }
      logDecision("entitlement_allowed", r, userId);
      return r;
    }

    // Não-admin: precisa da SQL primária.
    if (!featureIncluded) {
      // Discriminar motivo consultando o snapshot de assinatura.
      let reason: EntitlementReason = "plan_not_eligible";
      let plan: PlanTier | null = null;
      let planActive = false;
      try {
        const sub = await getSubscriptionForUserIdentity({
          userId,
          email,
          repairLink: false,
        });
        plan = sub.plan;
        planActive = sub.active;
        reason = mapSubscriptionToReason(sub);
      } catch {
        // mantém plan_not_eligible
      }
      const r = blocked(reason, { plan, planActive, featureIncluded: false });
      logDecision("entitlement_blocked", r, userId);
      return r;
    }

    // Plano OK. Beta é obrigatório durante rollout.
    const betaAllowed = await hasBetaAccess(userId);
    if (!betaAllowed) {
      const r = blocked("beta_access_missing", {
        featureIncluded: true,
        planActive: true,
        betaAllowed: false,
      });
      logDecision("entitlement_blocked", r, userId);
      return r;
    }

    // Camada operacional opcional: vínculo + opt-in.
    let linkActive = false;
    let optInActive = false;
    if (opts.requireLink) {
      const link = await readActiveLink(userId);
      if (!link.ok) {
        const r = blocked(link.reason, {
          featureIncluded: true,
          planActive: true,
          betaAllowed: true,
        });
        logDecision("entitlement_blocked", r, userId);
        return r;
      }
      linkActive = true;
      optInActive = true;
    }

    const r: EntitlementResult = {
      allowed: true,
      reason: "allowed",
      plan: null, // não exposto quando allowed (evita PII de plano no bundle de log de outros callers)
      planActive: true,
      featureIncluded: true,
      betaAllowed: true,
      adminMaster: false,
      linkActive,
      optInActive,
      checkedAt: nowIso(),
    };
    logDecision("entitlement_allowed", r, userId);
    return r;
  } catch {
    const r = blocked("internal_error");
    logDecision("entitlement_error", r, userId);
    return r;
  }
}

/**
 * Versão que lança `Response 403` sanitizado — para uso em rotas /
 * server functions que preferem controle por exception.
 */
export async function assertWhatsAppEntitlement(
  userId: string | null | undefined,
  opts: EntitlementOptions = {},
): Promise<EntitlementResult> {
  const r = await getWhatsAppEntitlement(userId, opts);
  if (!r.allowed) {
    throw new Response(
      JSON.stringify({ error: "whatsapp_not_entitled", reason: r.reason }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return r;
}
