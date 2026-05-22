/**
 * Normaliza nomes de empresas/estabelecimentos para resolução de logo.
 *
 * Remove acentos, ruído de pagamento e palavras genéricas, mantendo
 * o núcleo identificável da marca.
 */

const STOP_WORDS = new Set([
  "pagamento", "compra", "compras", "pix", "boleto", "transferencia",
  "debito", "credito", "cartao", "cartão", "mercado", "loja", "ltda",
  "sa", "s/a", "eireli", "me", "comercio", "comércio", "assinatura",
  "mensalidade", "plano", "brl", "br", "the", "of", "and",
  "aplicativo", "app", "site", "web", "conta", "login", "acesso",
  "portal", "minha", "meu", "oficial", "online", "store",
]);

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMerchantName(input: string | null | undefined): string {
  if (!input) return "";
  const base = stripDiacritics(String(input).toLowerCase())
    .replace(/\*+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";
  const tokens = base.split(" ").filter((t) => t && !STOP_WORDS.has(t));
  // se removeu tudo, fica com o que tinha
  const cleaned = tokens.length ? tokens.join(" ") : base;
  return cleaned.trim();
}

/** Versão "slug" sem espaços, útil para palpitar domínios. */
export function slugifyMerchantName(input: string | null | undefined): string {
  return normalizeMerchantName(input).replace(/\s+/g, "");
}
