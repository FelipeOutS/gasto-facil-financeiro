/** Normalize free-form brand names for matching, ignoring case and accents. */
export function normalizeName(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const BANK_ALIASES: Record<string, string> = {
  nubank: "nubank",
  "nu pagamentos": "nubank",
  nu: "nubank",
  "mercado pago": "mercadopago-branco",
  mercadopago: "mercadopago-branco",
  mp: "mercadopago-branco",
  inter: "banco-inter",
  "banco inter": "banco-inter",
  itau: "banco-itau",
  "itau unibanco": "banco-itau",
  "banco itau": "banco-itau",
  santander: "logo-santander",
  bradesco: "Banco_Bradesco",
  caixa: "logo-caixa",
  "caixa economica": "logo-caixa",
  "caixa economica federal": "logo-caixa",
  cef: "logo-caixa",
  "banco do brasil": "banco-do-brasil",
  bb: "banco-do-brasil",
  picpay: "picpay",
  neon: "neon",
  c6: "Logo_C6_Bank",
  "c6 bank": "Logo_C6_Bank",
  "will bank": "will-bank",
  will: "will-bank",
  atacadao: "atacadao",
  "cartao atacadao": "atacadao",
  assai: "assai-atacadista",
  "assai atacadista": "assai-atacadista",
  "cartao assai": "assai-atacadista",
  "cartao assai atacadista": "assai-atacadista",
};

/** Exact alias for issuer selection, without the word search used in free text. */
export function getExactBankSlug(name: string | undefined | null): string | null {
  return BANK_ALIASES[normalizeName(name)] ?? null;
}
