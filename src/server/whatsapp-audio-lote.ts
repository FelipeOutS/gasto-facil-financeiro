/**
 * Áudio com mais de um gasto ("gastei 20 no Uber e 30 na farmácia hoje").
 *
 * Só separa: cada parte passa pelo MESMO parser de texto. Nada é inventado —
 * se alguma parte não tiver valor e descrição, ou misturar gasto e receita,
 * devolve `unsafe` e o caller pede para enviar um por vez.
 * Data e forma de pagamento ditas uma vez valem para todas as partes que não
 * tiverem as próprias.
 */
import { parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";

export type LoteItem = { nome: string; valor: number; data: string; categoriaSugestao?: string | null };
export type LoteForma = "pix" | "dinheiro" | "debito" | "credito";
export type LoteSplit =
  | { kind: "none" }
  | { kind: "unsafe" }
  | { kind: "lote"; itens: LoteItem[]; formaPagamento: LoteForma | null };

// Só conta valores monetários explícitos ("R$ 20,00" ou "20 reais"), nunca
// datas, quantidades ou números de parcelas.
const MONEY = /r\$\s*\d[\d.]*(?:,\d{1,2})?|\b\d[\d.]*(?:,\d{1,2})?\s*reais\b/gi;
const SEPARADOR =
  /\s*(?:,|;|\be\b|\bmais\b|\btamb[eé]m\b)\s+(?=(?:(?:eu\s+)?(?:gastei|paguei|comprei)\s+)?(?:r\$\s*)?\d)/i;
const TEM_DATA = /\b(hoje|ontem|anteontem|\d{1,2}\/\d{1,2}|dia\s+\d{1,2})\b/i;
const RECEITA = /\b(recebi|ganhei|entrou|caiu|sal[aá]rio)\b/i;

type Parser = typeof parseWhatsAppExpenseMessage;

export function splitLoteGastos(
  texto: string,
  cartoes: Parameters<Parser>[1] = [],
  parser: Parser = parseWhatsAppExpenseMessage,
): LoteSplit {
  const valores = texto.match(MONEY) ?? [];
  if (valores.length < 2) return { kind: "none" };
  if (RECEITA.test(texto)) return { kind: "unsafe" };
  const partes = texto.split(SEPARADOR).map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return { kind: "none" };

  const todo = parser(texto, cartoes);
  const formaGeral = todo.notas.includes("Forma de pagamento não identificada")
    ? null
    : (todo.formaPagamento as LoteForma);

  const itens: LoteItem[] = [];
  for (const parte of partes) {
    if ((parte.match(MONEY) ?? []).length !== 1) return { kind: "unsafe" };
    const p = parser(parte, cartoes);
    if (!p.valor || p.valor <= 0 || !p.nome || p.nome.trim().length < 2) return { kind: "unsafe" };
    itens.push({
      nome: p.nome.trim(),
      valor: p.valor,
      data: TEM_DATA.test(parte) ? p.data : todo.data,
      categoriaSugestao: p.categoriaSugestao,
    });
  }
  return { kind: "lote", itens, formaPagamento: formaGeral };
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const DATA = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const FORMA_LABEL: Record<string, string> = {
  transferencia: "Transferência",
  boleto: "Boleto",
  outro: "Outro",
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Cartão de crédito",
};

export function textoListaLote(itens: LoteItem[], categoria: (nome: string) => string): string {
  return itens
    .map((it, i) => `${i + 1}. ${it.nome} — ${BRL(it.valor)} — ${categoria(it.nome)} — ${DATA(it.data)}`)
    .join("\n");
}

export const loteMsgs = {
  perguntaForma(lista: string, n: number) {
    return [
      `🎙️ Entendi ${n} gastos no seu áudio:`,
      ``,
      lista,
      ``,
      `Como você pagou? Responda Pix, dinheiro ou débito (vale para todos).`,
      `Se foi no cartão de crédito ou cada um foi de um jeito, responda Cancelar e envie um gasto por vez.`,
    ].join("\n");
  },
  confirmacao(lista: string, n: number, forma: string) {
    return [
      `🎙️ Entendi ${n} gastos no seu áudio:`,
      ``,
      lista,
      `💳 Pagamento: ${FORMA_LABEL[forma] ?? forma} (todos)`,
      ``,
      `Responda Confirmar para salvar todos, Ajustar para corrigir ou Cancelar.`,
    ].join("\n");
  },
  creditoNaoSuportado() {
    return `Para cartão de crédito, preciso saber o cartão de cada gasto. Responda Cancelar e envie um gasto por vez, ou diga Pix, dinheiro ou débito.`;
  },
  naoEntendido(n: number) {
    return `Ainda aguardo sua resposta sobre os ${n} gastos do áudio. Responda Confirmar, Ajustar ou Cancelar.`;
  },
  ajustar() {
    return `Tudo bem, não salvei nada. Envie de novo (por áudio ou texto) com a correção — um gasto por vez, se preferir.`;
  },
  cancelado() {
    return `Cancelado. Nenhum dos gastos do áudio foi salvo.`;
  },
  unsafe() {
    return `Entendi mais de um lançamento no áudio, mas não consegui separar com segurança. Envie um gasto ou receita por vez, por exemplo: "gastei 20 no Uber hoje".`;
  },
  salvos(lista: string, n: number) {
    return [`✅ Salvei ${n} gastos:`, ``, lista].join("\n");
  },
  parcial(lista: string, ok: number, total: number) {
    return [
      `Salvei ${ok} de ${total} gastos:`,
      ``,
      lista,
      ``,
      `Não consegui salvar os demais agora. Responda Confirmar para tentar de novo — os já salvos não serão duplicados.`,
    ].join("\n");
  },
};
