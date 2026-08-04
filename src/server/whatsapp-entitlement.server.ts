/**
 * WA-C11 FASE 1 — Fonte única e autoritativa de autorização do WhatsApp
 * por usuário. SERVER-ONLY.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSubscriptionForUserIdentity } from "@/server/subscription.server";
import type { PlanTier } from "@/lib/plans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sb = _supabaseAdmin as any;

/**
 * Injeta um cliente Supabase para testes.
 */
export function __inject_sb_for_testing(newSb: any) {
  sb = newSb;
}

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
  requireLink?: boolean;
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

async function hasWhatsAppFeatureSQL(userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("has_feature_access", {
      _user_id: userId,
      _feature: "whatsapp",
    });
    if (error) {
      console.error("[wa-entitlement] feature RPC error:", error);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[wa-entitlement] feature RPC exception:", err);
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

export async function getWhatsAppEntitlement(
  userId: string | null | undefined,
  opts: EntitlementOptions = {},
): Promise<EntitlementResult> {
  if (!userId || typeof userId !== "string" || userId.length < 8) {
    return blocked("unknown_user");
  }

  try {
    const { hasAdminMasterRole } = await import("@/server/admin-master.server");
    const isAdmin = await hasAdminMasterRole(userId);

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
      }
      logDecision("entitlement_allowed", r, userId);
      return r;
    }

    const featureIncluded = await hasWhatsAppFeatureSQL(userId);
    if (!featureIncluded) {
      let reason: EntitlementReason = "plan_not_eligible";
      let plan: PlanTier | null = null;
      let planActive = false;
      try {
        const { data: authUser } = await sb.auth.admin.getUserById(userId);
        const email = authUser?.user?.email ?? null;
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
      plan: null,
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
  } catch (err) {
    const r = blocked("internal_error");
    logDecision("entitlement_error", r, userId);
    return r;
  }
}

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
