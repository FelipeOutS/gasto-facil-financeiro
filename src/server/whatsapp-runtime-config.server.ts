/**
 * WA-C11 FASE 3B — Runtime Config Reader/Writer
 *
 * SERVER-ONLY. Lê o singleton `whatsapp_runtime_config` (id=1) e retorna
 * o estado estruturado. Fail-closed em qualquer falha: todas as flags
 * `false` e percentual 0.
 *
 * Regras invioláveis:
 *   - Banco `true` nunca sobrepõe env `false`. Precedência é aplicada
 *     nos gates de fluxo (inbound/outbound/dispatcher); este módulo só
 *     entrega o estado do banco.
 *   - Alteração exige Admin Master (validado no caller). Trigger
 *     `wa_rc_audit` registra automaticamente em
 *     `whatsapp_runtime_config_audit`.
 *   - Nenhum cache longo. TTL curto opcional pode ser adicionado no
 *     caller para caminhos hot; este módulo sempre lê fresco.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = _supabaseAdmin as any;

export interface WhatsAppRuntimeConfig {
  global_enabled: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  notification_creation_enabled: boolean;
  new_links_enabled: boolean;
  rollout_enabled: boolean;
  rollout_percentage: number;
  global_daily_outbound_limit: number;
  maintenance_message_enabled: boolean;
  reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export const FAIL_CLOSED_RUNTIME: WhatsAppRuntimeConfig = Object.freeze({
  global_enabled: false,
  inbound_enabled: false,
  outbound_enabled: false,
  notification_creation_enabled: false,
  new_links_enabled: false,
  rollout_enabled: false,
  rollout_percentage: 0,
  global_daily_outbound_limit: 0,
  maintenance_message_enabled: false,
  reason: null,
  updated_at: null,
  updated_by: null,
});

function coerceBool(v: unknown): boolean {
  return v === true;
}

function coerceInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * Lê o singleton. Fail-closed: qualquer erro devolve FAIL_CLOSED_RUNTIME.
 */
export async function readRuntimeConfig(
  client: unknown = sb,
): Promise<WhatsAppRuntimeConfig> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { data, error } = await c
      .from("whatsapp_runtime_config")
      .select(
        "id, global_enabled, inbound_enabled, outbound_enabled, notification_creation_enabled, new_links_enabled, rollout_enabled, rollout_percentage, global_daily_outbound_limit, maintenance_message_enabled, reason, updated_at, updated_by",
      )
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return { ...FAIL_CLOSED_RUNTIME };
    return {
      global_enabled: coerceBool(data.global_enabled),
      inbound_enabled: coerceBool(data.inbound_enabled),
      outbound_enabled: coerceBool(data.outbound_enabled),
      notification_creation_enabled: coerceBool(data.notification_creation_enabled),
      new_links_enabled: coerceBool(data.new_links_enabled),
      rollout_enabled: coerceBool(data.rollout_enabled),
      rollout_percentage: coerceInt(data.rollout_percentage, 0, 100),
      global_daily_outbound_limit: coerceInt(data.global_daily_outbound_limit, 0, 1_000_000),
      maintenance_message_enabled: coerceBool(data.maintenance_message_enabled),
      reason: typeof data.reason === "string" ? data.reason : null,
      updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
      updated_by: typeof data.updated_by === "string" ? data.updated_by : null,
    };
  } catch {
    return { ...FAIL_CLOSED_RUNTIME };
  }
}

export interface RuntimeConfigPatch {
  global_enabled?: boolean;
  inbound_enabled?: boolean;
  outbound_enabled?: boolean;
  notification_creation_enabled?: boolean;
  new_links_enabled?: boolean;
  rollout_enabled?: boolean;
  rollout_percentage?: number;
  global_daily_outbound_limit?: number;
  maintenance_message_enabled?: boolean;
}

const REASON_REQUIRED_FIELDS: Array<keyof RuntimeConfigPatch> = [
  "global_enabled",
  "outbound_enabled",
  "rollout_enabled",
  "rollout_percentage",
  "global_daily_outbound_limit",
];

export function requiresReason(patch: RuntimeConfigPatch): boolean {
  return REASON_REQUIRED_FIELDS.some((k) => patch[k] !== undefined);
}

/**
 * Atualização privilegiada. Caller DEVE ter validado Admin Master antes
 * de chamar. Motivo obrigatório para campos sensíveis.
 */
export async function updateRuntimeConfig(
  patch: RuntimeConfigPatch,
  ctx: { adminUserId: string; reason: string | null },
  client: unknown = sb,
): Promise<
  | { ok: true; config: WhatsAppRuntimeConfig }
  | { ok: false; error: "reason_required" | "invalid_patch" | "db_error" }
> {
  if (requiresReason(patch) && (!ctx.reason || ctx.reason.trim().length < 3)) {
    return { ok: false, error: "reason_required" };
  }
  const normalized: Record<string, unknown> = { updated_by: ctx.adminUserId, reason: ctx.reason ?? null };
  if (patch.global_enabled !== undefined) normalized.global_enabled = !!patch.global_enabled;
  if (patch.inbound_enabled !== undefined) normalized.inbound_enabled = !!patch.inbound_enabled;
  if (patch.outbound_enabled !== undefined) normalized.outbound_enabled = !!patch.outbound_enabled;
  if (patch.notification_creation_enabled !== undefined)
    normalized.notification_creation_enabled = !!patch.notification_creation_enabled;
  if (patch.new_links_enabled !== undefined) normalized.new_links_enabled = !!patch.new_links_enabled;
  if (patch.rollout_enabled !== undefined) normalized.rollout_enabled = !!patch.rollout_enabled;
  if (patch.rollout_percentage !== undefined) {
    const p = coerceInt(patch.rollout_percentage, -1, 101);
    if (p < 0 || p > 100) return { ok: false, error: "invalid_patch" };
    normalized.rollout_percentage = p;
  }
  if (patch.global_daily_outbound_limit !== undefined) {
    const v = coerceInt(patch.global_daily_outbound_limit, -1, 1_000_001);
    if (v < 0 || v > 1_000_000) return { ok: false, error: "invalid_patch" };
    normalized.global_daily_outbound_limit = v;
  }
  if (patch.maintenance_message_enabled !== undefined)
    normalized.maintenance_message_enabled = !!patch.maintenance_message_enabled;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { error } = await c.from("whatsapp_runtime_config").update(normalized).eq("id", 1);
    if (error) return { ok: false, error: "db_error" };
    const fresh = await readRuntimeConfig(client);
    return { ok: true, config: fresh };
  } catch {
    return { ok: false, error: "db_error" };
  }
}
