/**
 * P1 (14/10/2026) — Pedido de EDIÇÃO de receita/gasto existente.
 *
 * Antes desta guarda, "Quero editar uma receita de setembro de 2026" caía em
 * `isReceitaIntent` e abria o CADASTRO de uma receita nova. Edição de
 * lançamentos antigos ainda não existe pelo WhatsApp (só a edição do
 * lançamento recém-registrado, pelo botão "Editar" ligado à linha real).
 * Esta guarda é pura e read-only: nunca abre sessão, nunca escreve.
 */

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EDIT_VERB =
  /\b(editar|edita|edite|alterar|altera|altere|corrigir|corrige|corrija|mudar|muda|mude|modificar|modifique|atualizar|atualize)\b/;
const RECEITA = /\b(receitas?|rendas?|entradas?|salario|recebimentos?)\b/;
const GASTO = /\b(gastos?|despesas?|compras?)\b/;
const LANCAMENTO = /\blancamentos?\b/;
// Contas a pagar têm fluxo de edição próprio — não interceptar.
const CONTA = /\b(contas?|boletos?|fatura|cartao|categoria|meta|lembrete|agenda)\b/;

export type EditarLancamentoTipo = "receita" | "gasto" | "lancamento";

export function detectEditarLancamentoExistente(texto: string): EditarLancamentoTipo | null {
  const t = norm(texto);
  if (!t || !EDIT_VERB.test(t)) return null;
  if (CONTA.test(t)) return null;
  if (RECEITA.test(t)) return "receita";
  if (GASTO.test(t)) return "gasto";
  if (LANCAMENTO.test(t)) return "lancamento";
  return null;
}

export function respostaEdicaoIndisponivel(tipo: EditarLancamentoTipo): string {
  const nome = tipo === "receita" ? "receitas" : tipo === "gasto" ? "gastos" : "lançamentos";
  return [
    `A edição de ${nome} já registrados ainda não está disponível pelo WhatsApp. ✏️`,
    "",
    "Não criei nem alterei nenhum lançamento.",
    "",
    "• Logo depois de registrar, use o botão “Editar” da confirmação.",
    "• Para lançamentos anteriores, edite pelo site ou app do Gasto Inteligente.",
  ].join("\n");
}
