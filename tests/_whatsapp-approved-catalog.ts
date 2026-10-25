import type {
  CatalogLoader,
  CatalogTemplateRow,
} from "../src/server/whatsapp-meta-templates-catalog.server";
export function approvedCatalog(status = "approved", active = true): CatalogLoader {
  return {
    async getByInternalKeyAndVersion(key, version) {
      return {
        id: "fixture",
        internal_key: key,
        notification_key: key,
        meta_name: `${key}_v1`,
        version,
        language: "pt_BR",
        category: "UTILITY",
        status,
        active,
        provider_template_id: "123",
        body: "Data {{1}}: {{2}}",
        footer: null,
        components: [],
        placeholder_schema: {},
        examples: {},
        last_synced_at: null,
        quality_score: null,
        rejection_reason: null,
        submitted_at: null,
        approved_at: null,
        rejected_at: null,
      } satisfies CatalogTemplateRow;
    },
    async getByMetaNameAndLanguage() {
      return null;
    },
    async listAll() {
      return [];
    },
  };
}
