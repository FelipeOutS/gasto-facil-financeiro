/**
 * WA-C11 FASE 7B — Submissão controlada de templates para a Meta.
 *
 * SERVER-ONLY. Requisitos:
 *  - WHATSAPP_META_SUBMISSION_ENABLED=true
 *  - Role 'owner' validada
 *  - Template deve estar em 'draft' localmente
 *  - Mapeamento deve estar na allowlist (gi_conta_...)
 *  - Não tenta submeter se já existir provider_template_id
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  prepareSubmissionPayload,
  buildMessageTemplatesUrl,
} from "@/server/whatsapp-meta-template-management.server";
import type {
  CatalogTemplateRow,
  CatalogLoader,
} from "@/server/whatsapp-meta-templates-catalog.server";

export const META_SUBMIT_TIMEOUT_MS = 15_000;

function isSubmissionEnabled(): boolean {
  return process.env.WHATSAPP_META_SUBMISSION_ENABLED === "true";
}

function readAccessToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

export type SubmissionResult =
  | {
      ok: false;
      reason:
        | "disabled"
        | "already_submitted"
        | "payload_error"
        | "meta_error"
        | "token_missing"
        | "forbidden"
        | "not_found"
        | "timeout"
        | "persist_failed";
      detail?: string;
      /** Presente em persist_failed: a Meta JÁ recebeu; não reenviar, sincronizar. */
      provider_template_id?: string;
    }
  | { ok: true; provider_template_id: string; status: string };

/**
 * Submete um único template rascunho para a Meta.
 */
export async function submitTemplateToMeta(
  local: CatalogTemplateRow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: { fetchFn?: typeof fetch; timeoutMs?: number; client?: any } = {},
): Promise<SubmissionResult> {
  if (!isSubmissionEnabled()) return { ok: false, reason: "disabled" };

  const token = readAccessToken();
  if (!token) return { ok: false, reason: "token_missing" };

  if (local.provider_template_id || local.status !== "draft") {
    return { ok: false, reason: "already_submitted" };
  }

  const prepared = prepareSubmissionPayload(local);
  if (!prepared.ok) return { ok: false, reason: "payload_error", detail: prepared.reason };

  const url = buildMessageTemplatesUrl();
  if (!url.ok) return { ok: false, reason: "meta_error", detail: url.reason };

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? META_SUBMIT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchFn(url.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prepared.payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const isTimeout = name === "TimeoutError" || name === "AbortError";
    console.error("[submitTemplateToMeta] falha de rede", { kind: isTimeout ? "timeout" : "network" });
    // Resultado incerto: a Meta pode ter recebido. O admin deve sincronizar antes de reenviar.
    return { ok: false, reason: isTimeout ? "timeout" : "meta_error", detail: isTimeout ? "Tempo esgotado; sincronize antes de tentar de novo." : "Falha de rede" };
  }

  let data: { id?: unknown; status?: unknown; error?: { message?: unknown; code?: unknown } } | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    // Log sem corpo bruto da Meta (pode conter dados da conta).
    console.error("[submitTemplateToMeta] Erro Meta", { status: res.status, code: data?.error?.code ?? null });
    const msg = typeof data?.error?.message === "string" ? data.error.message.slice(0, 200) : "Erro desconhecido";
    return { ok: false, reason: "meta_error", detail: msg };
  }

  const providerId = typeof data?.id === "string" && data.id ? data.id : null;
  if (!providerId) {
    console.error("[submitTemplateToMeta] resposta sem id", { status: res.status });
    return { ok: false, reason: "meta_error", detail: "Resposta da Meta sem identificador" };
  }
  const status = (typeof data?.status === "string" ? data.status : "submitted").toLowerCase();

  const client = opts.client ?? supabaseAdmin;
  const nowIso = new Date().toISOString();
  try {
    const { error: updateError } = await client
      .from("whatsapp_meta_templates")
      .update({ provider_template_id: providerId, status, submitted_at: nowIso, last_synced_at: nowIso })
      .eq("id", local.id);
    if (updateError) throw new Error("update_failed");
  } catch {
    console.error("[submitTemplateToMeta] Meta aceitou, mas gravação local falhou", { templateId: local.id });
    return {
      ok: false,
      reason: "persist_failed",
      provider_template_id: providerId,
      detail: "Enviado à Meta, mas não registrado localmente. Sincronize; não reenvie.",
    };
  }

  return { ok: true, provider_template_id: providerId, status };
}
