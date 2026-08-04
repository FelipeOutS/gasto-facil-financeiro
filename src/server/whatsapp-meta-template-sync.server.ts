/**
 * WA-C11 FASE 4B.2.a — Sincronização READ-ONLY do catálogo local com a Meta.
 *
 * SERVER-ONLY. Nesta fase:
 *  - Com `WHATSAPP_META_MGMT_ENABLED=false` → retorna `disabled` e faz
 *    zero fetch / zero DML.
 *  - Com flag ON e `fetchFn`/`applyPatch` injetados (testes) → correlaciona
 *    (`meta_name` + `language`), normaliza status, provider ID, quality
 *    score, rejection reason e last_synced_at; idempotente.
 *
 * Nunca ativa template automaticamente. Nunca altera body/placeholders.
 * Status remoto desconhecido → `unknown`. Divergência de conteúdo ou
 * fingerprint → registra outcome sanitizado sem ativar/sobrescrever.
 */

import {
  listRemoteTemplates,
  type ListRemoteOptions,
  type RemoteTemplateSummary,
} from "@/server/whatsapp-meta-template-management.server";
import type {
  CatalogLoader,
  CatalogTemplateRow,
} from "@/server/whatsapp-meta-templates-catalog.server";

const ALLOWED_STATUSES = new Set([
  "draft",
  "submitted",
  "pending",
  "approved",
  "rejected",
  "paused",
  "disabled",
]);

export type SyncPatch = {
  id: string;
  status: string;
  provider_template_id: string | null;
  quality_score: string | null;
  rejection_reason: string | null;
  last_synced_at: string;
};

export type SyncOutcome = {
  internal_key: string;
  version: number;
  meta_name: string;
  language: string;
  local_status_before: string;
  remote_status_normalized: string;
  action:
    | "no_change"
    | "patched"
    | "skipped_no_remote"
    | "skipped_not_local"
    | "content_divergence";
  provider_template_id: string | null;
};

export type SyncPatchApplier = (patch: SyncPatch) => Promise<void>;

export type SyncResult =
  | { ok: false; reason: "disabled" | "remote_error"; detail?: string; correlationId?: string }
  | { ok: true; outcomes: SyncOutcome[]; correlationId?: string };

export type SyncOptions = ListRemoteOptions & {
  applyPatch?: SyncPatchApplier;
  clock?: () => Date;
};

function isMgmtEnabled(): boolean {
  return process.env.WHATSAPP_META_MGMT_ENABLED === "true";
}

function normalizeStatus(remote: string): string {
  const lower = remote.toLowerCase();
  if (ALLOWED_STATUSES.has(lower)) return lower;
  return "unknown";
}

function sanitizeRejection(reason: string | null): string | null {
  if (!reason) return null;
  // Corta e remove controle; jamais preserva tokens/URLs longos.
  const cleaned = reason.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return cleaned.length > 240 ? cleaned.slice(0, 240) : cleaned;
}

/**
 * Executa sincronização read-only. `catalog` fornece os locais conhecidos
 * (fonte de verdade da correlação). `applyPatch` é opcional: quando ausente,
 * `outcomes` reporta as mudanças que *seriam* aplicadas sem DML.
 */
export async function syncRemoteTemplates(
  catalog: CatalogLoader,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  if (!isMgmtEnabled()) return { ok: false, reason: "disabled" };
  const remote = await listRemoteTemplates(opts);
  if (!remote.ok) {
    return {
      ok: false,
      reason: "remote_error",
      detail: remote.reason === "disabled" ? "disabled" : remote.reason,
      correlationId: opts.correlationId,
    };
  }
  const locals = await catalog.listAll();
  const localByKey = new Map<string, CatalogTemplateRow>();
  for (const l of locals) localByKey.set(`${l.meta_name}::${l.language}`, l);

  const now = (opts.clock ?? (() => new Date()))().toISOString();
  const outcomes: SyncOutcome[] = [];

  for (const r of remote.templates) {
    const key = `${r.name}::${r.language}`;
    const local = localByKey.get(key);
    if (!local) {
      // remoto que não temos localmente → registrar como skipped_not_local; nunca criar local.
      outcomes.push({
        internal_key: "",
        version: 0,
        meta_name: r.name,
        language: r.language,
        local_status_before: "",
        remote_status_normalized: normalizeStatus(r.status),
        action: "skipped_not_local",
        provider_template_id: r.id,
      });
      continue;
    }
    localByKey.delete(key);
    const normalized = normalizeStatus(r.status);
    const rejection = sanitizeRejection(r.rejection_reason);
    const provider = r.id ?? local.provider_template_id;
    const contentDivergence = detectContentDivergence(local, r);
    if (contentDivergence) {
      outcomes.push({
        internal_key: local.internal_key,
        version: local.version,
        meta_name: local.meta_name,
        language: local.language,
        local_status_before: local.status,
        remote_status_normalized: normalized,
        action: "content_divergence",
        provider_template_id: provider,
      });
      continue;
    }
    const patch: SyncPatch = {
      id: local.id,
      status: normalized === "unknown" ? "unknown" : normalized,
      provider_template_id: provider,
      quality_score: r.quality_score,
      rejection_reason: rejection,
      last_synced_at: now,
    };
    const needsUpdate =
      local.status !== patch.status ||
      local.provider_template_id !== patch.provider_template_id ||
      (local.quality_score ?? null) !== (patch.quality_score ?? null) ||
      (local.rejection_reason ?? null) !== (patch.rejection_reason ?? null);
    if (!needsUpdate) {
      outcomes.push({
        internal_key: local.internal_key,
        version: local.version,
        meta_name: local.meta_name,
        language: local.language,
        local_status_before: local.status,
        remote_status_normalized: normalized,
        action: "no_change",
        provider_template_id: provider,
      });
      continue;
    }
    if (opts.applyPatch) await opts.applyPatch(patch);
    outcomes.push({
      internal_key: local.internal_key,
      version: local.version,
      meta_name: local.meta_name,
      language: local.language,
      local_status_before: local.status,
      remote_status_normalized: normalized,
      action: "patched",
      provider_template_id: provider,
    });
  }
  // Locais que ficaram sem correspondente remoto → skipped_no_remote (não altera).
  for (const l of localByKey.values()) {
    outcomes.push({
      internal_key: l.internal_key,
      version: l.version,
      meta_name: l.meta_name,
      language: l.language,
      local_status_before: l.status,
      remote_status_normalized: "unknown",
      action: "skipped_no_remote",
      provider_template_id: l.provider_template_id,
    });
  }
  return { ok: true, outcomes, correlationId: opts.correlationId };
}

/**
 * Detecta divergência estrutural mínima. Nesta fase o único sinal remoto
 * disponível na listagem é (name, language, status, category). Se a
 * categoria remota vier preenchida e diferente da local, marcamos como
 * divergência para NUNCA sobrescrever silenciosamente.
 */
function detectContentDivergence(
  local: CatalogTemplateRow,
  remote: RemoteTemplateSummary,
): boolean {
  if (remote.category && remote.category !== local.category) return true;
  return false;
}
