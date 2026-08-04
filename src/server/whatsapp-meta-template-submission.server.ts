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
  buildMessageTemplatesUrl
} from "@/server/whatsapp-meta-template-management.server";
import type { CatalogTemplateRow, CatalogLoader } from "@/server/whatsapp-meta-templates-catalog.server";

function isSubmissionEnabled(): boolean {
  return process.env.WHATSAPP_META_SUBMISSION_ENABLED === "true";
}

function readAccessToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

export type SubmissionResult = 
  | { ok: false; reason: "disabled" | "already_submitted" | "payload_error" | "meta_error" | "token_missing" | "forbidden" | "not_found"; detail?: string }
  | { ok: true; provider_template_id: string; status: string };

/**
 * Submete um único template rascunho para a Meta.
 */
export async function submitTemplateToMeta(
  local: CatalogTemplateRow,
  opts: { fetchFn?: typeof fetch } = {}
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

  try {
    const res = await fetchFn(url.url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prepared.payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[submitTemplateToMeta] Erro Meta:", data);
      return { ok: false, reason: "meta_error", detail: data?.error?.message || "Erro desconhecido" };
    }

    // Sucesso: Meta retorna { id: "...", status: "PENDING" | "APPROVED" ... }
    const providerId = data.id;
    const status = (data.status || "submitted").toLowerCase();

    // Persiste no banco local
    const { error: updateError } = await supabaseAdmin
      .from("whatsapp_meta_templates")
      .update({
        provider_template_id: providerId,
        status: status,
        submitted_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString()
      })
      .eq("id", local.id);

    if (updateError) {
      console.error("[submitTemplateToMeta] Erro ao atualizar banco:", updateError);
    }

    return { ok: true, provider_template_id: providerId, status };
  } catch (err) {
    console.error("[submitTemplateToMeta] Exceção:", err);
    return { ok: false, reason: "meta_error", detail: String(err) };
  }
}
