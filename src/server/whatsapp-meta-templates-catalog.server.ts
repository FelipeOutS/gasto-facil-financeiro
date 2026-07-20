/**
 * WA-C11 FASE 4B.2.a — Catálogo server-only dos templates Meta.
 *
 * SERVER-ONLY. Acessa `public.whatsapp_meta_templates` exclusivamente via
 * service_role. Rejeita mass-assignment: qualquer atualização passa pelo
 * módulo de sync / submission, nunca por este catálogo.
 *
 * A tabela tem FORCE RLS; a única policy é `service_role manages meta
 * templates`. Anon e authenticated não conseguem ler nem escrever.
 */

import { resolveAllowedMapping, type AllowedNotificationKey } from "./whatsapp-meta-template-mapping.server";

export type CatalogTemplateRow = {
  id: string;
  internal_key: string;
  meta_name: string;
  language: string;
  category: string;
  version: number;
  status: string;
  active: boolean;
  provider_template_id: string | null;
  notification_key: string;
  body: string;
  footer: string | null;
  placeholder_schema: unknown;
  examples: unknown;
  components: unknown;
  last_synced_at: string | null;
  quality_score: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
};

export type CatalogLoader = {
  getByInternalKeyAndVersion(
    internalKey: string,
    version: number,
  ): Promise<CatalogTemplateRow | null>;
  getByMetaNameAndLanguage(
    metaName: string,
    language: string,
  ): Promise<CatalogTemplateRow | null>;
  listAll(): Promise<CatalogTemplateRow[]>;
};

/**
 * Constrói um loader que usa o `supabaseAdmin` (service_role). Importa
 * dinamicamente para manter este módulo seguro para importar dentro de
 * outros módulos server-only sem carregar `client.server` no import-time.
 */
export async function buildServiceRoleCatalogLoader(): Promise<CatalogLoader> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const columns =
    "id, internal_key, meta_name, language, category, version, status, active, provider_template_id, notification_key, body, footer, placeholder_schema, examples, components, last_synced_at, quality_score, rejection_reason, submitted_at, approved_at, rejected_at";

  return {
    async getByInternalKeyAndVersion(internalKey, version) {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_meta_templates")
        .select(columns)
        .eq("internal_key", internalKey)
        .eq("version", version)
        .maybeSingle();
      if (error) throw new Error(`catalog_read_failed:${error.code ?? "unknown"}`);
      return (data ?? null) as CatalogTemplateRow | null;
    },
    async getByMetaNameAndLanguage(metaName, language) {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_meta_templates")
        .select(columns)
        .eq("meta_name", metaName)
        .eq("language", language)
        .maybeSingle();
      if (error) throw new Error(`catalog_read_failed:${error.code ?? "unknown"}`);
      return (data ?? null) as CatalogTemplateRow | null;
    },
    async listAll() {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_meta_templates")
        .select(columns)
        .order("internal_key", { ascending: true });
      if (error) throw new Error(`catalog_read_failed:${error.code ?? "unknown"}`);
      return (data ?? []) as CatalogTemplateRow[];
    },
  };
}

/**
 * Carrega o template canônico correspondente a um evento interno permitido.
 * Retorna null se o evento não está na allowlist (jamais lança).
 */
export async function loadCanonicalForNotificationKey(
  loader: CatalogLoader,
  notificationKey: string,
): Promise<CatalogTemplateRow | null> {
  const map = resolveAllowedMapping(notificationKey);
  if (!map.ok) return null;
  return loader.getByInternalKeyAndVersion(map.entry.notificationKey as AllowedNotificationKey, map.entry.version);
}
