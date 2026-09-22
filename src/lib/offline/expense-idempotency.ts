type Row = Record<string, unknown>;
export const INCOME_FIELDS = [
  "user_id",
  "offline_client_id",
  "descricao",
  "valor",
  "data",
  "tipo",
  "recorrente",
  "mes",
  "ano",
  "cliente_id",
];
const FIELDS = [
  "estabelecimento",
  "cliente_id",
  "fornecedor_id",
  "horario",
  "origem",
  "gasto_fixo",
  "mes",
  "ano",
  "user_id",
  "offline_client_id",
  "descricao",
  "valor",
  "data",
  "categoria_id",
  "forma_pagamento",
  "cartao_id",
  "observacao",
  "tipo_gasto",
  "parcela_atual",
  "total_parcelas",
];

export function offlineRowKey(localId: string, index: number): string {
  return index === 0 ? localId : `${localId}:${index}`;
}

export function matchesOfflineRows(expected: Row[], actual: Row[], fields = FIELDS): boolean {
  if (!expected.length || expected.length !== actual.length) return false;
  return expected.every((row) => {
    const matches = actual.filter((saved) => saved.offline_client_id === row.offline_client_id);
    return (
      matches.length === 1 &&
      fields.every((field) => (row[field] ?? null) === (matches[0][field] ?? null))
    );
  });
}

/** A duplicate error alone is never evidence that this expense was persisted. */
export async function persistOfflineRows(
  expected: Row[],
  read: () => Promise<{ rows: Row[]; error?: string }>,
  insert: () => Promise<{ error?: string; code?: string; constraint?: string }>,
  options: { fields?: string[]; constraint?: string } = {},
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const before = await read();
  if (before.error) return { ok: false, error: before.error };
  if (before.rows.length)
    return matchesOfflineRows(expected, before.rows, options.fields)
      ? { ok: true, duplicate: true }
      : {
          ok: false,
          error:
            "Existe um lançamento diferente com este identificador. A pendência foi preservada para conferência.",
        };
  const written = await insert();
  if (!written.error) return { ok: true };
  if (written.code === "23505") {
    const constraint =
      written.constraint ?? written.error.match(/constraint ["']([^"']+)["']/i)?.[1];
    if (!options.constraint || constraint !== options.constraint)
      return { ok: false, error: written.error };
  }
  const after = await read();
  if (!after.error && matchesOfflineRows(expected, after.rows, options.fields))
    return { ok: true, duplicate: true };
  return { ok: false, error: written.error };
}
