/** Normaliza strings para chaves estáveis (lower, sem acentos, sem espaços extras). */
export function normalizeForKey(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
