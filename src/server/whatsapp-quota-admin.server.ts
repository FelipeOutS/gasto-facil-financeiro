/**
 * WA-C11 FASE 3B.3 — Quota Admin Helpers (SERVER-ONLY).
 *
 * Regras invariáveis:
 *  - Toda alteração exige Admin Master. Este módulo apenas expõe helpers
 *    puros; a autorização é responsabilidade do caller (server function).
 *  - Plano permitido é resolvido server-side; nunca confiar em plan_code
 *    vindo do cliente sem validação.
 *  - Planos gratuitos permanecem obrigatoriamente com quota zero.
 *  - Motivo é obrigatório e sanitizado (min 3 chars após trim, max 500).
 *  - Números: inteiros, não-negativos, teto seguro; NaN/Infinity/decimal
 *    são rejeitados. Diário nunca maior que mensal.
 *  - Uso agregado é sempre agregado; não retorna phone/nome/email/PII.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

export const ALLOWED_PLAN_CODES = Object.freeze([
  "free",
  "free_ads",
  "sem_assinatura",
  "pessoal_manual",
  "pessoal_premium",
  "mei_essencial",
  "mei_inteligente",
  "empresa",
] as const);

export type AllowedPlanCode = (typeof ALLOWED_PLAN_CODES)[number];

export const FREE_PLAN_CODES = Object.freeze([
  "free",
  "free_ads",
  "sem_assinatura",
  "pessoal_manual",
] as const);

const MAX_LIMIT = 1_000_000;

export type QuotaRow = {
  plan_code: string;
  inbound_monthly_limit: number;
  outbound_monthly_limit: number;
  financial_actions_monthly_limit: number;
  daily_inbound_limit: number;
  daily_outbound_limit: number;
  per_minute_limit: number;
  enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

export type QuotaPatch = {
  inbound_monthly_limit?: number;
  outbound_monthly_limit?: number;
  financial_actions_monthly_limit?: number;
  daily_inbound_limit?: number;
  daily_outbound_limit?: number;
  per_minute_limit?: number;
  enabled?: boolean;
};

export type QuotaUpdateError =
  | "unknown_plan"
  | "reason_required"
  | "invalid_number"
  | "negative_value"
  | "value_too_large"
  | "daily_exceeds_monthly"
  | "free_plan_must_be_zero"
  | "empty_patch"
  | "db_error";

export type QuotaUpdateResult =
  | { ok: true; row: QuotaRow }
  | { ok: false; error: QuotaUpdateError };

export function isAllowedPlan(code: string): code is AllowedPlanCode {
  return (ALLOWED_PLAN_CODES as ReadonlyArray<string>).includes(code);
}

export function isFreePlan(code: string): boolean {
  return (FREE_PLAN_CODES as ReadonlyArray<string>).includes(code);
}

export function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 500) return null;
  // Bloqueia tags HTML básicas e null bytes; motivos livres em pt-BR passam.
  if (/[<>\u0000]/.test(trimmed)) return null;
  return trimmed;
}

function validateNumberField(
  v: unknown,
):
  | { ok: true; value: number }
  | { ok: false; err: "invalid_number" | "negative_value" | "value_too_large" } {
  if (typeof v !== "number") return { ok: false, err: "invalid_number" };
  if (!Number.isFinite(v)) return { ok: false, err: "invalid_number" };
  if (!Number.isInteger(v)) return { ok: false, err: "invalid_number" };
  if (v < 0) return { ok: false, err: "negative_value" };
  if (v > MAX_LIMIT) return { ok: false, err: "value_too_large" };
  return { ok: true, value: v };
}

export function validateQuotaPatch(
  planCode: string,
  patch: QuotaPatch,
): { ok: true; patch: QuotaPatch } | { ok: false; error: QuotaUpdateError } {
  if (!isAllowedPlan(planCode)) return { ok: false, error: "unknown_plan" };

  const clean: QuotaPatch = {};
  const numericFields: Array<keyof QuotaPatch> = [
    "inbound_monthly_limit",
    "outbound_monthly_limit",
    "financial_actions_monthly_limit",
    "daily_inbound_limit",
    "daily_outbound_limit",
    "per_minute_limit",
  ];
  for (const f of numericFields) {
    const v = patch[f];
    if (v === undefined) continue;
    const chk = validateNumberField(v);
    if (!chk.ok) return { ok: false, error: chk.err };
    (clean as Record<string, unknown>)[f] = chk.value;
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== "boolean") return { ok: false, error: "invalid_number" };
    clean.enabled = patch.enabled;
  }

  const keys = Object.keys(clean);
  if (keys.length === 0) return { ok: false, error: "empty_patch" };

  // Free plans devem permanecer com todos os limites zero (mas podem alterar `enabled`).
  if (isFreePlan(planCode)) {
    for (const f of numericFields) {
      const v = (clean as Record<string, unknown>)[f];
      if (typeof v === "number" && v !== 0) {
        return { ok: false, error: "free_plan_must_be_zero" };
      }
    }
  }

  // Consistência diário/mensal quando ambos presentes no patch OU quando
  // apenas um for enviado, será revalidado após merge no updatePlanQuota.
  const pIn = clean.daily_inbound_limit;
  const pInM = clean.inbound_monthly_limit;
  if (typeof pIn === "number" && typeof pInM === "number" && pIn > pInM) {
    return { ok: false, error: "daily_exceeds_monthly" };
  }
  const pOut = clean.daily_outbound_limit;
  const pOutM = clean.outbound_monthly_limit;
  if (typeof pOut === "number" && typeof pOutM === "number" && pOut > pOutM) {
    return { ok: false, error: "daily_exceeds_monthly" };
  }

  return { ok: true, patch: clean };
}

function mapRow(r: Record<string, unknown> | null | undefined): QuotaRow | null {
  if (!r) return null;
  return {
    plan_code: String(r.plan_code ?? ""),
    inbound_monthly_limit: Number(r.inbound_monthly_limit ?? 0),
    outbound_monthly_limit: Number(r.outbound_monthly_limit ?? 0),
    financial_actions_monthly_limit: Number(r.financial_actions_monthly_limit ?? 0),
    daily_inbound_limit: Number(r.daily_inbound_limit ?? 0),
    daily_outbound_limit: Number(r.daily_outbound_limit ?? 0),
    per_minute_limit: Number(r.per_minute_limit ?? 0),
    enabled: r.enabled === true,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
    updated_by: typeof r.updated_by === "string" ? r.updated_by : null,
  };
}

export async function listPlanQuotas(client: unknown = sb): Promise<QuotaRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c
      .from("whatsapp_plan_quotas")
      .select(
        "plan_code, inbound_monthly_limit, outbound_monthly_limit, financial_actions_monthly_limit, daily_inbound_limit, daily_outbound_limit, per_minute_limit, enabled, updated_at, updated_by",
      )
      .order("plan_code", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    const rows: QuotaRow[] = [];
    for (const r of data) {
      const m = mapRow(r as Record<string, unknown>);
      if (m) rows.push(m);
    }
    return rows;
  } catch {
    return [];
  }
}

export async function updatePlanQuota(
  planCode: string,
  patch: QuotaPatch,
  ctx: { adminUserId: string; reason: string | null },
  client: unknown = sb,
): Promise<QuotaUpdateResult> {
  const cleanReason = sanitizeReason(ctx.reason);
  if (!cleanReason) return { ok: false, error: "reason_required" };

  const val = validateQuotaPatch(planCode, patch);
  if (!val.ok) return { ok: false, error: val.error };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    // Carrega estado atual para revalidar consistência diário/mensal após merge.
    const { data: current, error: curErr } = await c
      .from("whatsapp_plan_quotas")
      .select(
        "plan_code, inbound_monthly_limit, outbound_monthly_limit, financial_actions_monthly_limit, daily_inbound_limit, daily_outbound_limit, per_minute_limit, enabled",
      )
      .eq("plan_code", planCode)
      .maybeSingle();
    if (curErr) return { ok: false, error: "db_error" };
    if (!current) return { ok: false, error: "unknown_plan" };

    const merged = {
      ...(current as Record<string, unknown>),
      ...(val.patch as Record<string, unknown>),
    };
    const inD = Number(merged.daily_inbound_limit ?? 0);
    const inM = Number(merged.inbound_monthly_limit ?? 0);
    const outD = Number(merged.daily_outbound_limit ?? 0);
    const outM = Number(merged.outbound_monthly_limit ?? 0);
    if (inD > inM || outD > outM) {
      return { ok: false, error: "daily_exceeds_monthly" };
    }

    const updatePayload: Record<string, unknown> = {
      ...val.patch,
      updated_by: ctx.adminUserId,
    };

    const { data: updated, error: upErr } = await c
      .from("whatsapp_plan_quotas")
      .update(updatePayload)
      .eq("plan_code", planCode)
      .select(
        "plan_code, inbound_monthly_limit, outbound_monthly_limit, financial_actions_monthly_limit, daily_inbound_limit, daily_outbound_limit, per_minute_limit, enabled, updated_at, updated_by",
      )
      .maybeSingle();
    if (upErr || !updated) return { ok: false, error: "db_error" };

    // Auditoria mínima (best-effort; não usa tabela paralela — reusa runtime_config_audit
    // apenas para runtime. Para quotas mantemos updated_by/updated_at + notes opcional).
    // O motivo é registrado no evento estruturado de log server-side abaixo.
    try {
      console.info(
        JSON.stringify({
          event: "wa_quota_admin_update",
          plan_code: planCode,
          fields_changed: Object.keys(val.patch),
          admin_user_id: ctx.adminUserId,
          reason: cleanReason,
        }),
      );
    } catch {
      // logging nunca deve derrubar o caminho crítico
    }

    const row = mapRow(updated as Record<string, unknown>);
    if (!row) return { ok: false, error: "db_error" };
    return { ok: true, row };
  } catch {
    return { ok: false, error: "db_error" };
  }
}

export type UsageSnapshot = {
  window: "current_cycle";
  users_with_usage: number;
  inbound_used_total: number;
  outbound_reserved_total: number;
  outbound_committed_total: number;
  financial_actions_used_total: number;
  users_over_80pct: number;
  users_at_limit: number;
  generated_at: string;
};

export async function getUsageSnapshot(client: unknown = sb): Promise<UsageSnapshot> {
  const empty: UsageSnapshot = {
    window: "current_cycle",
    users_with_usage: 0,
    inbound_used_total: 0,
    outbound_reserved_total: 0,
    outbound_committed_total: 0,
    financial_actions_used_total: 0,
    users_over_80pct: 0,
    users_at_limit: 0,
    generated_at: new Date().toISOString(),
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const nowIso = new Date().toISOString();
    const { data, error } = await c
      .from("whatsapp_usage_counters")
      .select(
        "user_id, plan_code, inbound_used, outbound_reserved, outbound_committed, financial_actions_used",
      )
      .lte("cycle_start", nowIso)
      .gte("cycle_end", nowIso);
    if (error || !Array.isArray(data)) return empty;

    const quotasList = await listPlanQuotas(client);
    const quotasByPlan = new Map<string, QuotaRow>();
    for (const q of quotasList) quotasByPlan.set(q.plan_code, q);

    let inbound = 0;
    let outR = 0;
    let outC = 0;
    let fin = 0;
    let over80 = 0;
    let atLimit = 0;
    const users = new Set<string>();
    for (const row of data as Array<Record<string, unknown>>) {
      const uid = typeof row.user_id === "string" ? row.user_id : null;
      const plan = typeof row.plan_code === "string" ? row.plan_code : "";
      const iu = Number(row.inbound_used ?? 0);
      const or = Number(row.outbound_reserved ?? 0);
      const oc = Number(row.outbound_committed ?? 0);
      const fu = Number(row.financial_actions_used ?? 0);
      if (uid && (iu > 0 || or > 0 || oc > 0 || fu > 0)) users.add(uid);
      inbound += iu;
      outR += or;
      outC += oc;
      fin += fu;
      const q = quotasByPlan.get(plan);
      if (q && q.outbound_monthly_limit > 0) {
        const total = oc + or;
        const ratio = total / q.outbound_monthly_limit;
        if (ratio >= 1) atLimit++;
        else if (ratio >= 0.8) over80++;
      }
    }
    return {
      window: "current_cycle",
      users_with_usage: users.size,
      inbound_used_total: inbound,
      outbound_reserved_total: outR,
      outbound_committed_total: outC,
      financial_actions_used_total: fin,
      users_over_80pct: over80,
      users_at_limit: atLimit,
      generated_at: nowIso,
    };
  } catch {
    return empty;
  }
}
