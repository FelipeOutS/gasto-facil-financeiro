/**
 * WA-C10.4 — Mapeamento determinístico código FEBRABAN → nome do banco.
 *
 * A entrada é SEMPRE o código de 3 dígitos extraído pelo parser
 * determinístico (`tryParseBoleto` → `parsed.banco`, primeiros 3 dígitos
 * do barcode validado). Nunca aceitar nome vindo de OCR/Gemini.
 *
 * Contrato:
 *  - código válido conhecido → nome canônico (ex.: "Banco do Brasil").
 *  - código válido desconhecido → o próprio código de 3 dígitos.
 *  - código inválido/ausente  → null (fallback manual não inventa banco).
 *
 * Formato de saída (nome puro) segue o padrão já observado em
 * `contas_a_pagar.banco_emissor` (ex.: "Banco do Brasil", "Sabesp").
 */

const BANCOS_BR: Readonly<Record<string, string>> = Object.freeze({
  "001": "Banco do Brasil",
  "033": "Santander",
  "041": "Banrisul",
  "070": "BRB",
  "077": "Inter",
  "085": "Cooperativa Central Ailos",
  "104": "Caixa Econômica Federal",
  "197": "Stone",
  "208": "BTG Pactual",
  "212": "Banco Original",
  "218": "BS2",
  "237": "Bradesco",
  "260": "Nubank",
  "290": "PagBank",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú",
  "364": "Gerencianet",
  "380": "PicPay",
  "389": "Mercantil do Brasil",
  "422": "Safra",
  "623": "Pan",
  "637": "Sofisa",
  "655": "Votorantim",
  "735": "Neon",
  "745": "Citibank",
  "746": "Modal",
  "748": "Sicredi",
  "756": "Sicoob",
});

/**
 * Retorna o nome canônico do banco emissor para persistir em
 * `contas_a_pagar.banco_emissor`.
 *
 * NUNCA falha: código desconhecido devolve o próprio código,
 * código inválido devolve null.
 */
export function formatBancoEmissor(codigo?: string | null): string | null {
  if (!codigo || typeof codigo !== "string") return null;
  if (!/^\d{3}$/.test(codigo)) return null;
  return BANCOS_BR[codigo] ?? codigo;
}
