/**
 * WA-C11 FASE 4B.2.a — Cliente Meta server-only para gestão de templates.
 *
 * SERVER-ONLY. Superfície mínima nesta fase:
 *  - listagem remota (GET)
 *  - consulta de template (GET)
 *  - preparação de payload (puro, sem I/O)
 *  - preview dry-run
 *  - fingerprint
 *  - detecção de duplicidade contra catálogo local
 *
 * PROIBIDO nesta fase (não implementado):
 *  - DELETE
 *  - PATCH / edição remota
 *  - POST em /message_templates (submissão real)
 *  - `/messages` (envio)
 *  - upload
 *  - alteração de WABA / número
 *
 * Regras de URL:
 *  - host fixo `graph.facebook.com` via `buildWhatsAppGraphUrl`
 *  - versão via helper validado
 *  - WABA_ID lido EXCLUSIVAMENTE de `process.env.WHATSAPP_WABA_ID`
 *  - path fixo `${WABA_ID}/message_templates`
 *  - jamais aceita WABA, token ou URL vindos do chamador
 *
 * Flags (leitura em runtime, nunca no import-time):
 *  - `WHATSAPP_META_MGMT_ENABLED=false` → operações retornam `disabled`
 *  - `WHATSAPP_META_SUBMISSION_ENABLED=false` → submissão permanece em `dry_run`
 *
 * Token só em `Authorization: Bearer`. Nunca em URL/query/body/log.
 */

import { createHash } from "node:crypto";
import { buildWhatsAppGraphUrl } from "@/server/whatsapp-graph-version.server";
import type { CatalogTemplateRow } from "@/server/whatsapp-meta-templates-catalog.server";
import { resolveAllowedMapping } from "@/server/whatsapp-meta-template-mapping.server";

// ─────────────────────────────────────────────────────────────────────────────
// Flags e envs (server-only, lidas por chamada — nunca no import-time)

export type FlagOutcomeDisabled = { ok: false; reason: "disabled"; flag: string };

function isMgmtEnabled(): boolean {
  return process.env.WHATSAPP_META_MGMT_ENABLED === "true";
}
function isSubmissionEnabled(): boolean {
  return process.env.WHATSAPP_META_SUBMISSION_ENABLED === "true";
}

const WABA_ID_PATTERN = /^[0-9]{5,32}$/;

function readWabaId():
  | { ok: true; wabaId: string }
  | { ok: false; reason: "waba_missing" | "waba_invalid" } {
  const raw = process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "waba_missing" };
  if (!WABA_ID_PATTERN.test(raw)) return { ok: false, reason: "waba_invalid" };
  return { ok: true, wabaId: raw };
}

function readAccessToken():
  | { ok: true; token: string }
  | { ok: false; reason: "token_missing" } {
  const raw = process.env.WHATSAPP_ACCESS_TOKEN;
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "token_missing" };
  return { ok: true, token: raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// URL builder (allowlist rígida — apenas `${WABA_ID}/message_templates`)

export type UrlBuildResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "waba_missing"
        | "waba_invalid"
        | "graph_config_error"
        | "invalid_path";
    };

/**
 * Monta a URL fixa `graph.facebook.com/<v>/<WABA_ID>/message_templates`
 * (opcionalmente com querystring de listagem). Rejeita override externo.
 */
export function buildMessageTemplatesUrl(query?: {
  fields?: string;
  limit?: number;
  after?: string;
}): UrlBuildResult {
  const waba = readWabaId();
  if (!waba.ok) return { ok: false, reason: waba.reason };
  const parts: string[] = [];
  if (query?.fields) parts.push(`fields=${encodeURIComponent(query.fields)}`);
  if (typeof query?.limit === "number" && Number.isInteger(query.limit) && query.limit > 0) {
    parts.push(`limit=${query.limit}`);
  }
  if (query?.after) parts.push(`after=${encodeURIComponent(query.after)}`);
  const path = parts.length > 0
    ? `${waba.wabaId}/message_templates?${parts.join("&")}`
    : `${waba.wabaId}/message_templates`;
  const built = buildWhatsAppGraphUrl({ kind: "admin_path", path });
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason === "configuration_error" ? "graph_config_error" : "invalid_path",
    };
  }
  return { ok: true, url: built.url };
}

// Explicitamente indisponíveis nesta fase.
export function deleteRemoteTemplate(): never {
  throw new Error("not_implemented:delete_template_disallowed_in_phase_4b2a");
}
export function sendRemoteMessage(): never {
  throw new Error("not_implemented:message_send_disallowed_in_management_client");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint

export type FingerprintInput = {
  metaName: string;
  language: string;
  category: string;
  body: string;
  footer: string | null;
  components: unknown;
  placeholderSchema: unknown;
};

export function computeTemplateFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    metaName: input.metaName,
    language: input.language,
    category: input.category,
    body: input.body,
    footer: input.footer ?? null,
    components: input.components ?? null,
    placeholderSchema: input.placeholderSchema ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Preparação de payload (puro)

export type PayloadPrepareResult =
  | { ok: true; payload: Record<string, unknown>; fingerprint: string }
  | { ok: false; reason: "invalid_local_template" | "not_allowed" };

export function prepareSubmissionPayload(local: CatalogTemplateRow): PayloadPrepareResult {
  if (!resolveAllowedMapping(local.internal_key).ok) return { ok: false, reason: "not_allowed" };
  if (!local.body || local.body.length === 0) return { ok: false, reason: "invalid_local_template" };
  if (local.language !== "pt_BR") return { ok: false, reason: "invalid_local_template" };
  if (local.category !== "UTILITY") return { ok: false, reason: "invalid_local_template" };
  const components: unknown[] = [
    { 
      type: "BODY", 
      text: local.body, 
      example: {
        body_text: [Object.values(local.examples ?? {} as any)]
      }
    },

  ];
  if (local.footer && local.footer.length > 0) {
    components.push({ type: "FOOTER", text: local.footer });
  }
  const payload: Record<string, unknown> = {
    name: local.meta_name,
    language: local.language,
    category: local.category,
    components,
  };
  const fingerprint = computeTemplateFingerprint({
    metaName: local.meta_name,
    language: local.language,
    category: local.category,
    body: local.body,
    footer: local.footer,
    components,
    placeholderSchema: local.placeholder_schema,
  });
  return { ok: true, payload, fingerprint };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dry-run

export type DryRunResult =
  | FlagOutcomeDisabled
  | { ok: false; reason: "invalid_local_template" | "not_allowed" | "not_draft" | "already_active" | "duplicate_local" }
  | {
      ok: true;
      dry_run: true;
      submission_enabled: false;
      remote_call_performed: false;
      payload: Record<string, unknown>;
      fingerprint: string;
      metaName: string;
      language: string;
      category: string;
    };

export function prepareDryRun(
  local: CatalogTemplateRow,
  existingLocalByMeta?: CatalogTemplateRow | null,
): DryRunResult {
  if (!isMgmtEnabled()) return { ok: false, reason: "disabled", flag: "WHATSAPP_META_MGMT_ENABLED" };
  if (local.status !== "draft") return { ok: false, reason: "not_draft" };
  if (local.active !== false) return { ok: false, reason: "already_active" };
  const prepared = prepareSubmissionPayload(local);
  if (!prepared.ok) return { ok: false, reason: prepared.reason };
  if (
    existingLocalByMeta &&
    existingLocalByMeta.id !== local.id &&
    existingLocalByMeta.meta_name === local.meta_name &&
    existingLocalByMeta.language === local.language
  ) {
    return { ok: false, reason: "duplicate_local" };
  }
  // Independentemente de WHATSAPP_META_SUBMISSION_ENABLED, este helper
  // NUNCA executa POST. Se a flag ficasse ON, o call site autorizado teria
  // que passar por outro módulo (não implementado nesta fase).
  void isSubmissionEnabled();
  return {
    ok: true,
    dry_run: true,
    submission_enabled: false,
    remote_call_performed: false,
    payload: prepared.payload,
    fingerprint: prepared.fingerprint,
    metaName: local.meta_name,
    language: local.language,
    category: local.category,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Listagem remota (GET) — usa fetchFn injetado; testes passam mock.

export type RemoteTemplateSummary = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  id: string | null;
  quality_score: string | null;
  rejection_reason: string | null;
};

export type RemoteListResult =
  | FlagOutcomeDisabled
  | {
      ok: false;
      reason:
        | "waba_missing"
        | "waba_invalid"
        | "token_missing"
        | "graph_config_error"
        | "http_error"
        | "invalid_json"
        | "timeout";
      status?: number;
      correlationId?: string;
    }
  | {
      ok: true;
      templates: RemoteTemplateSummary[];
      correlationId?: string;
    };

const DEFAULT_TIMEOUT_MS = 15_000;

export type ListRemoteOptions = {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  correlationId?: string;
  limit?: number;
};

export async function listRemoteTemplates(opts: ListRemoteOptions = {}): Promise<RemoteListResult> {
  if (!isMgmtEnabled()) return { ok: false, reason: "disabled", flag: "WHATSAPP_META_MGMT_ENABLED" };
  const tok = readAccessToken();
  if (!tok.ok) return { ok: false, reason: "token_missing" };
  const url = buildMessageTemplatesUrl({
    fields: "name,language,status,category,id,quality_score,rejected_reason",
    limit: opts.limit ?? 100,
  });
  if (!url.ok) {
    return {
      ok: false,
      reason:
        url.reason === "graph_config_error"
          ? "graph_config_error"
          : url.reason === "waba_missing"
            ? "waba_missing"
            : url.reason === "waba_invalid"
              ? "waba_invalid"
              : "graph_config_error",
    };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeoutMs = Math.min(
    Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000),
    30_000,
  );
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetchFn(url.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tok.token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: "http_error", status: res.status, correlationId: opts.correlationId };
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return { ok: false, reason: "http_error", status: res.status, correlationId: opts.correlationId };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json", correlationId: opts.correlationId };
    }
    const templates = normalizeRemoteList(parsed);
    return { ok: true, templates, correlationId: opts.correlationId };
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "timeout" : "http_error",
      correlationId: opts.correlationId,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRemoteList(parsed: unknown): RemoteTemplateSummary[] {
  if (!parsed || typeof parsed !== "object") return [];
  const dataField = (parsed as { data?: unknown }).data;
  if (!Array.isArray(dataField)) return [];
  const out: RemoteTemplateSummary[] = [];
  for (const raw of dataField) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const language = typeof r.language === "string" ? r.language : null;
    const status = typeof r.status === "string" ? r.status : null;
    if (!name || !language || !status) continue;
    out.push({
      name,
      language,
      status,
      category: typeof r.category === "string" ? r.category : null,
      id: typeof r.id === "string" ? r.id : null,
      quality_score: typeof r.quality_score === "string" ? r.quality_score : null,
      rejection_reason:
        typeof r.rejected_reason === "string"
          ? r.rejected_reason
          : typeof r.rejection_reason === "string"
            ? r.rejection_reason
            : null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consulta remota de um único template (GET)

export type RemoteFetchOneResult =
  | FlagOutcomeDisabled
  | { ok: false; reason: "not_allowed" | "not_found" | "http_error" | "invalid_json" | "timeout" | "token_missing" | "graph_config_error" }
  | { ok: true; template: RemoteTemplateSummary };

export async function fetchRemoteTemplateByName(
  metaName: string,
  language: string,
  opts: ListRemoteOptions = {},
): Promise<RemoteFetchOneResult> {
  if (!isMgmtEnabled()) return { ok: false, reason: "disabled", flag: "WHATSAPP_META_MGMT_ENABLED" };
  // Consulta é feita listando (com paginação restrita) e correlacionando
  // por (name, language) — não aceitamos ID vindo do client.
  const list = await listRemoteTemplates(opts);
  if (!list.ok) {
    if (list.reason === "disabled") return { ok: false, reason: "disabled", flag: list.flag };
    return { ok: false, reason: list.reason as RemoteFetchOneResult extends { reason: infer R } ? R : never };
  }
  const found = list.templates.find((t) => t.name === metaName && t.language === language);
  if (!found) return { ok: false, reason: "not_found" };
  return { ok: true, template: found };
}
