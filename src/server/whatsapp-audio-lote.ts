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
export type AudioAnalise =
  /** Não é gasto por voz (receita, consulta, comando…): segue o fluxo de texto como está. */
  | { kind: "passthrough" }
  /** Um gasto: texto reescrito com o valor explícito, para o parser de texto. */
  | { kind: "single"; texto: string }
  /** Intenção de gasto, mas nenhum número está na posição de valor. */
  | { kind: "ask_value" }
  /** Não dá para separar/entender com segurança. */
  | { kind: "unsafe" }
  | { kind: "lote"; itens: LoteItem[]; formaPagamento: LoteForma | null };

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


// ---------------------------------------------------------------------
// Leitura contextual para transcrições de voz ("gastei 20 no Uber e 30 na
// farmácia hoje"). Um número só vira dinheiro quando está NA POSIÇÃO DE
// VALOR de um lançamento: logo após o verbo de gasto, após "por", ou logo
// após a conjunção que abre o próximo gasto — e seguido de destino ("no",
// "na", "de"…), fim de frase, "hoje/ontem" ou vírgula. "R$ X" e "X reais"
// sempre contam. Datas, "dia 10", quantidades ("2 pizzas"), parcelas e
// "final 1234" nunca contam. Só é usado no caminho de áudio.
// ---------------------------------------------------------------------

const VERBO_GASTO = /\b(gastei|paguei|comprei|torrei|desembolsei|gastamos|pagamos|compramos)\b/i;
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?`;
const ANTES_VALOR = String.raw`(?:gastei|paguei|comprei|torrei|desembolsei|gastamos|pagamos|compramos|por|\be|\bmais|,)`;
const DEPOIS_VALOR = String.raw`(?=\s+(?:no|na|nos|nas|em|de|do|da|dos|das|com|pro|pra|para|pelo|pela|hoje|ontem|anteontem)\b|\s*,|\s*$|\s+e\b)`;

type Valor = { start: number; end: number; valor: number };

function toNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function acharValores(t: string): Valor[] {
  const out: Valor[] = [];
  const add = (start: number, end: number, raw: string) => {
    if (out.some((v) => start < v.end && end > v.start)) return;
    const valor = toNumber(raw);
    if (Number.isFinite(valor) && valor > 0) out.push({ start, end, valor });
  };
  // explícitos: "R$ 20", "20 reais"
  for (const m of t.matchAll(new RegExp(String.raw`r\$\s*(${NUM})`, "gi"))) {
    add(m.index!, m.index! + m[0].length, m[1]);
  }
  for (const m of t.matchAll(new RegExp(String.raw`\b(${NUM})\s*reais\b`, "gi"))) {
    add(m.index!, m.index! + m[0].length, m[1]);
  }
  // contextuais: número na posição de valor
  const ctx = new RegExp(String.raw`${ANTES_VALOR}\s+(?:(?:eu\s+)?(?:gastei|paguei|comprei)\s+)?(${NUM})(?![\d/.,]*\d)(?!\s*(?:\/|x\b|vezes|parcelas?|unidades?|itens?|reais))${DEPOIS_VALOR}`, "gi");
  for (const m of t.matchAll(ctx)) {
    const raw = m[1];
    const start = m.index! + m[0].lastIndexOf(raw);
    add(start, start + raw.length, raw);
  }
  return out.sort((a, b) => a.start - b.start);
}

const BRL_NUM = (v: number) => v.toFixed(2).replace(".", ",");

/** Mês/ano atuais em São Paulo (para "dia 10" sem mês). */
function hojeSP(): { dia: number; mes: number } {
  const [d, m] = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  })
    .format(new Date())
    .split("/");
  return { dia: Number(d), mes: Number(m) };
}

/** Reescreve um trecho com UM valor em "R$ V <resto>" para o parser de texto. */
function canonico(trecho: string, v: Valor, base: number): string | null {
  const a = v.start - base;
  const b = v.end - base;
  let resto = (trecho.slice(0, a).replace(/\b(por|r\$)\s*$/i, "") + " " + trecho.slice(b).replace(/^\s*reais\b/i, ""))
    .replace(/\b(cart[aã]o\s+)?final\s+\d{4}\b/gi, "cartão")
    .replace(/\bdia\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi, "$1");
  // "dia 10" sem mês: só aceita se já passou neste mês; senão é ambíguo.
  const soDia = resto.match(/\bdia\s+(\d{1,2})\b(?!\s*\/)/i);
  if (soDia) {
    const h = hojeSP();
    const d = Number(soDia[1]);
    if (d < 1 || d > h.dia) return null;
    resto = resto.replace(soDia[0], `${String(d).padStart(2, "0")}/${String(h.mes).padStart(2, "0")}`);
  }
  resto = resto.replace(/^\s*(e|mais|,)\s+/i, "").replace(/\s+/g, " ").trim();
  // Datas/números que sobrarem vêm DEPOIS do valor: o parser usa o primeiro número.
  return `R$ ${BRL_NUM(v.valor)} ${resto}`.trim();
}

const SEP_ENTRE = /(?:,|\s(?:e|mais|tamb[eé]m)\s)/gi;

export function analisarGastoPorVoz(
  texto: string,
  cartoes: Parameters<Parser>[1] = [],
  parser: Parser = parseWhatsAppExpenseMessage,
): AudioAnalise {
  const t = texto.trim();
  if (!VERBO_GASTO.test(t) || RECEITA.test(t)) {
    // Receita, consulta ou comando: comportamento atual. Vários valores com
    // receita continuam sem separação às cegas.
    if (RECEITA.test(t) && VERBO_GASTO.test(t)) return { kind: "unsafe" };
    return { kind: "passthrough" };
  }
  const valores = acharValores(t);
  if (valores.length === 0) return /\d/.test(t) ? { kind: "ask_value" } : { kind: "passthrough" };
  if (valores.length === 1) {
    const c = canonico(t, valores[0], 0);
    return c ? { kind: "single", texto: c } : { kind: "unsafe" };
  }
  // Vários valores: corta no último separador entre um valor e o próximo.
  const cortes: number[] = [];
  for (let i = 0; i < valores.length - 1; i++) {
    const entre = t.slice(valores[i].end, valores[i + 1].start);
    const seps = [...entre.matchAll(SEP_ENTRE)];
    if (seps.length === 0) return { kind: "unsafe" };
    cortes.push(valores[i].end + seps[seps.length - 1].index!);
  }
  const limites = [0, ...cortes, t.length];
  const datasGlobais = canonico(t.slice(valores[valores.length - 1].end), { start: 0, end: 0, valor: 1 }, 0);
  const todo = datasGlobais ? parser(datasGlobais, cartoes) : null;
  if (!todo) return { kind: "unsafe" };
  const formaGeral = todo.notas.includes("Forma de pagamento não identificada")
    ? null
    : (todo.formaPagamento as LoteForma);
  const itens: LoteItem[] = [];
  for (let i = 0; i < valores.length; i++) {
    const ini = limites[i];
    const trecho = t.slice(ini, limites[i + 1]);
    const c = canonico(trecho, valores[i], ini);
    if (!c) return { kind: "unsafe" };
    const p = parser(c, cartoes);
    if (!p.valor || Math.abs(p.valor - valores[i].valor) > 0.001 || !p.nome || p.nome.trim().length < 2) {
      return { kind: "unsafe" };
    }
    itens.push({
      nome: p.nome.trim(),
      valor: p.valor,
      data: TEM_DATA.test(trecho) ? p.data : todo.data,
      categoriaSugestao: p.categoriaSugestao,
    });
  }
  return { kind: "lote", itens, formaPagamento: formaGeral };
}
