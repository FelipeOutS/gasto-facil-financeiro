/**
 * Normaliza nomes de empresas/estabelecimentos para resolução de logo.
 *
 * Remove acentos, ruído de pagamento e palavras genéricas, mantendo
 * o núcleo identificável da marca.
 */

const STOP_WORDS = new Set([
  // pagamento / transação
  "pagamento",
  "pgto",
  "compra",
  "compras",
  "pix",
  "boleto",
  "transferencia",
  "transf",
  "ted",
  "doc",
  "debito",
  "credito",
  "cartao",
  // jurídico
  "ltda",
  "sa",
  "eireli",
  "me",
  "mei",
  "epp",
  "comercio",
  "industria",
  "servicos",
  "servico",
  // canais
  "mercado",
  "loja",
  "store",
  "shop",
  "assinatura",
  "mensalidade",
  "plano",
  "aplicativo",
  "app",
  "site",
  "web",
  "online",
  "conta",
  "login",
  "acesso",
  "portal",
  "minha",
  "meu",
  "oficial",
  // país / moeda
  "brl",
  "br",
  "brasil",
  // inglês comum
  "the",
  "of",
  "and",
  "inc",
  "llc",
  "corp",
  "co",
  // genéricos que costumam vir junto de nomes
  "pedido",
  "pedidos",
  "trip",
  "ride",
  "rides",
  "marketplace",
  "bill",
  "billing",
  "subscription",
  "storage",
]);

/** Quando o nome aparece SOZINHO, mantemos. Senão, removemos. */
const SOFT_STOP_WORDS = new Set([
  "supermercado",
  "restaurante",
  "lanchonete",
  "padaria",
  "farmacia",
  "drogaria",
  "posto",
]);

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMerchantName(input: string | null | undefined): string {
  if (!input) return "";
  let base = stripDiacritics(String(input).toLowerCase());

  // Domínios: extrai o miolo antes de qualquer "/" ou ".com.."
  // Ex.: "apple.com/bill" → "apple"; "netflix.com" → "netflix"
  base = base.replace(
    /\b([a-z0-9-]+)\.(com|net|org|io|dev|app|co|gov)(\.[a-z]{2})?(\/[^ ]*)?/g,
    " $1 ",
  );

  base = base
    .replace(/\*+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    // Separa letras grudadas em dígitos: "raia2975" → "raia 2975"; "lj0098" → "lj 0098"
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    // Remove números isolados (códigos de loja, ids, etc.)
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";

  let tokens = base.split(" ").filter((t) => t && !STOP_WORDS.has(t));

  // Remove soft-stop apenas se há outras palavras (mantém "Supermercado X",
  // mas elimina "Supermercado" sozinho do meio de um nome composto).
  if (tokens.length > 1) {
    tokens = tokens.filter((t) => !SOFT_STOP_WORDS.has(t));
  }

  const cleaned = tokens.length ? tokens.join(" ") : base;
  return cleaned.trim();
}

/** Versão "slug" sem espaços, útil para palpitar domínios. */
export function slugifyMerchantName(input: string | null | undefined): string {
  return normalizeMerchantName(input).replace(/\s+/g, "");
}
