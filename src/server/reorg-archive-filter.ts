/**
 * Registros arquivados pela limpeza total ("zerar tudo") ficam com
 * `reorg_archived_at` preenchido em faturas_cartao, contas_a_pagar,
 * contas_a_receber, transferencias_internas e recorrencias. O site já os
 * esconde por RLS restritiva, mas o servidor (service role) ignora RLS: toda
 * leitura/atualização dessas tabelas no servidor encadeia
 * ``. Garantido por tests/reorg-archive-filter.test.ts.
 *
 * Enquanto a coluna não existir no banco real, o filtro é um no-op seguro
 * (`id IS NOT NULL`). Ligar REORG_ARCHIVE_SCHEMA_DEPLOYED somente junto com a
 * aplicação de docs/migrations-candidate/whatsapp-reorganizacao-full-reset.sql.
 */
export const REORG_ARCHIVE_SCHEMA_DEPLOYED = false;

export const REORG_ARCHIVED_TABLES = [
  "faturas_cartao",
  "contas_a_pagar",
  "contas_a_receber",
  "transferencias_internas",
  "recorrencias",
] as const;

export function reorgAtivoFilter(deployed: boolean): readonly [string, string, string] {
  return deployed ? ["reorg_archived_at", "is", "null"] : ["id", "not.is", "null"];
}

export const REORG_ATIVO_FILTER = reorgAtivoFilter(REORG_ARCHIVE_SCHEMA_DEPLOYED);
