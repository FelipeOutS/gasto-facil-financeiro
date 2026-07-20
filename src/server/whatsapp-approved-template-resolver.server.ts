/**
 * WA-C11 FASE 4B.2.a — Resolver fail-closed do template Meta aprovado
 * para uma notification interna.
 *
 * SERVER-ONLY. NUNCA cria reservation. NUNCA cria attempt. NUNCA chama
 * Graph. NUNCA envia mensagem. Apenas resolve o par (metaName, language,
 * providerTemplateId, valores dos placeholders) ou devolve o motivo
 * sanitizado por que o template NÃO deve ser usado.
 *
 * Fallbacks proibidos: hello_world, en_US, template de outro evento,
 * texto livre, canary v1, pending, rejected, versão antiga.
 */

import {
  loadCanonicalForNotificationKey,
  type CatalogLoader,
  type CatalogTemplateRow,
} from "@/server/whatsapp-meta-templates-catalog.server";
import { computeTemplateFingerprint } from "@/server/whatsapp-meta-template-management.server";
import {
  resolveAllowedMapping,
  type AllowedMetaName,
  type AllowedNotificationKey,
} from "@/server/whatsapp-meta-template-mapping.server";
import {
  resolveAndSanitizePlaceholders,
  type PlaceholderInput,
} from "@/server/whatsapp-meta-template-placeholders.server";

export type ResolverNotificationInput = {
  notificationKey: string;
  placeholders: PlaceholderInput;
  /** Fingerprint esperada (calculada quando o template foi aprovado
   *  localmente e persistida em memória por quem chama o resolver). Se
   *  ausente, a validação fingerprint é pulada — a divergência aqui só
   *  reprova, nunca aprova. */
  expectedFingerprint?: string | null;
};

export type ResolverSuccess = {
  ok: true;
  metaName: AllowedMetaName;
  language: "pt_BR";
  category: "UTILITY";
  providerTemplateId: string;
  values: { 1: string; 2: string };
  labelFallbackUsed: boolean;
  labelReason: string;
};

export type ResolverFailure = {
  ok: false;
  reason: "template_not_approved";
  detail:
    | "not_allowed"
    | "not_found"
    | "wrong_language"
    | "wrong_category"
    | "wrong_version"
    | "not_approved"
    | "inactive"
    | "provider_id_missing"
    | "fingerprint_divergence"
    | "invalid_placeholders";
};

export type ResolverResult = ResolverSuccess | ResolverFailure;

function fail(detail: ResolverFailure["detail"]): ResolverFailure {
  return { ok: false, reason: "template_not_approved", detail };
}

export async function resolveApprovedTemplateForNotification(
  loader: CatalogLoader,
  input: ResolverNotificationInput,
): Promise<ResolverResult> {
  const map = resolveAllowedMapping(input.notificationKey);
  if (!map.ok) return fail("not_allowed");
  const local = await loadCanonicalForNotificationKey(loader, input.notificationKey);
  if (!local) return fail("not_found");
  return validateAndProject(local, map.entry.notificationKey, map.entry.metaName, input);
}

// Exposto para testes que já têm um CatalogTemplateRow em mão.
export function projectApprovedTemplate(
  local: CatalogTemplateRow,
  input: ResolverNotificationInput,
): ResolverResult {
  const map = resolveAllowedMapping(input.notificationKey);
  if (!map.ok) return fail("not_allowed");
  return validateAndProject(local, map.entry.notificationKey, map.entry.metaName, input);
}

function validateAndProject(
  local: CatalogTemplateRow,
  expectedNotificationKey: AllowedNotificationKey,
  expectedMetaName: AllowedMetaName,
  input: ResolverNotificationInput,
): ResolverResult {
  if (local.internal_key !== expectedNotificationKey) return fail("not_allowed");
  if (local.meta_name !== expectedMetaName) return fail("not_allowed");
  if (local.language !== "pt_BR") return fail("wrong_language");
  if (local.category !== "UTILITY") return fail("wrong_category");
  if (local.version !== 1) return fail("wrong_version");
  if (local.status !== "approved") return fail("not_approved");
  if (local.active !== true) return fail("inactive");
  if (!local.provider_template_id || local.provider_template_id.length === 0) {
    return fail("provider_id_missing");
  }
  if (input.expectedFingerprint) {
    const current = computeTemplateFingerprint({
      metaName: local.meta_name,
      language: local.language,
      category: local.category,
      body: local.body,
      footer: local.footer,
      components: local.components,
      placeholderSchema: local.placeholder_schema,
    });
    if (current !== input.expectedFingerprint) return fail("fingerprint_divergence");
  }
  const placeholders = resolveAndSanitizePlaceholders(input.placeholders);
  if (!placeholders.ok) return fail("invalid_placeholders");
  return {
    ok: true,
    metaName: expectedMetaName,
    language: "pt_BR",
    category: "UTILITY",
    providerTemplateId: local.provider_template_id,
    values: placeholders.values,
    labelFallbackUsed: placeholders.labelFallbackUsed,
    labelReason: placeholders.labelReason,
  };
}
