/**
 * Reconhecimento estrito de pedidos de LISTAGEM de cartões ("quais cartões
 * tenho cadastrados?"). Função pura: só aceita frases compostas por palavras
 * de uma lista fechada, contendo "cartoes" e um marcador de consulta.
 * Qualquer palavra de ação (cadastrar, fatura, pagar, gastei...), número ou
 * termo fora da lista faz a frase NÃO ser listagem — segue o fluxo normal.
 */
const PERMITIDAS = new Set([
  "quais", "qual", "que", "sao", "os", "meus", "eu", "tenho", "possuo",
  "cadastrados", "registrados", "mostre", "mostra", "mostrar", "me", "listar",
  "liste", "lista", "ver", "todos", "de", "credito", "cartoes", "por", "favor",
  "aqui", "quero", "no", "app", "gostaria", "os", "seus", "ai",
]);
const MARCADORES = new Set([
  "quais", "que", "meus", "mostre", "mostra", "mostrar", "listar", "liste", "lista", "ver", "tenho", "possuo",
]);

export function isListarCartoesIntent(texto: string): boolean {
  const t = (texto ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[?!.,;:¿¡"'“”]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80 || /\d/.test(t)) return false;
  const tokens = t.split(" ");
  if (tokens.length > 10 || !tokens.includes("cartoes")) return false;
  if (!tokens.every((w) => PERMITIDAS.has(w))) return false;
  return tokens.some((w) => MARCADORES.has(w));
}
