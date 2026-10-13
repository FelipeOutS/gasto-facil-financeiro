/**
 * Assistente de Compras — detecção de intenção (pura, sem I/O).
 * Compra no passado ("comprei", "paguei", "gastei") é GASTO e nunca entra aqui.
 * Supermercado, lembretes e comprovantes ficam fora do MVP.
 */
export type ShoppingIntent = { query: string; wantsBudget: boolean; wantsUsed: boolean };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const PAST_PURCHASE = /\b(comprei|paguei|gastei|parcelei|passei no cartao|foi no cartao|lancei|registrar? gasto)\b/;
const OTHER_FLOWS = /\b(lembrete|lembrar|lembra|agendar|agenda|comprovante|boleto|fatura|pix)\b/;
const GROCERY = /\b(supermercado|mercado|feira|hortifruti|acougue|padaria|arroz|feijao|leite|cafe|carne|frango|ovos?|acucar|oleo|detergente|sabao|papel higienico|cesta basica)\b/;
const TRIGGER = /\b(quero comprar|pretendo comprar|penso em comprar|vale a pena comprar|onde (?:esta|ta|fica|acho|encontro)? ?mais barato|mais barato|menor preco|melhor preco|quanto custa|preco d[oae]s?|pesquisa(?:r)? (?:o )?preco|procura(?:r)? (?:o )?preco|cabe no (?:meu )?orcamento)\b/;

/** Remove dados pessoais da busca: e-mails, sequências longas de dígitos (CPF/telefone/cartão). */
export function sanitizeQuery(raw: string): string {
  return raw
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, " ")
    .replace(/\b(?:\d{4}[ -]){3}\d{4}\b/g, " ")
    .replace(/\b\d{3}[.\-]?\d{3}[.\-]?\d{3}[.\-]?\d{2}\b/g, " ")
    .replace(/\b\d{8,}\b/g, " ")
    .replace(/[^\p{L}\p{N}\s.+\-/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

export function detectShoppingIntent(text: string): ShoppingIntent | null {
  const n = norm(text ?? "");
  if (!n || n.length > 400) return null;
  if (PAST_PURCHASE.test(n) || OTHER_FLOWS.test(n)) return null;
  if (!TRIGGER.test(n)) return null;
  if (GROCERY.test(n)) return null;
  const wantsBudget = /\b(cabe no (?:meu )?orcamento|consigo pagar|da pra pagar|posso comprar|cabe no bolso)\b/.test(n);
  const wantsUsed = /\b(usado|seminovo|recondicionado|refurbished|vitrine)\b/.test(n);
  let q = n
    // Cut instructions, not product specs (e.g. 13.6 inches or SSD/RAM).
    .split(/[,?;!]|\.(?=\s|$)|\s+(?:e\s+)?(?:pesquise|pesquisa|procure|busque|veja se|me mostra|me mostre|mostre|onde\b|cabe no\b|por favor\b)| e (?:se|quanto)\b| que cabe\b/)[0]
    .replace(/^(?:oi|ola|bom dia|boa tarde|boa noite)\s+/, "")
    .replace(/\b(?:eu )?(?:quero|pretendo|penso em|vale a pena) comprar\b/, "")
    .replace(/\b(?:quanto custa|preco d[oae]s?|pesquisa(?:r)? (?:o )?preco d[oae]s?|procura(?:r)? (?:o )?preco d[oae]s?|menor preco d[oae]s?|melhor preco d[oae]s?|mais barato)\b/, "")
    .replace(/^\s*(?:um|uma|uns|umas|o|a|os|as)\s+/, "")
    .replace(/\bde (\d+) ?gb\b/g, "$1gb")
    .replace(/\b(\d+) ?(gb|tb)\b/g, "$1$2");
  q = sanitizeQuery(q);
  if (q.length < 3 || !/\p{L}/u.test(q)) return null;
  return { query: q, wantsBudget, wantsUsed };
}
