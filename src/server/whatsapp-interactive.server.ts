/**
 * Mensagens interativas do WhatsApp (reply buttons ≤3 e listas ≤10).
 *
 * Princípio: o botão é só um atalho. Cada ID estável é convertido para o
 * MESMO texto que a pessoa digitaria (`replyIdToTexto`), e esse texto entra
 * no pipeline atual. Assim texto e botão produzem exatamente o mesmo
 * resultado financeiro, reaproveitando sessão, autorização, quotas e
 * rastreio de envio. Se o envio interativo falhar, o webhook manda o texto.
 */
import { FATURA_COMP_PREFIX } from "./whatsapp-fatura-escolha.server";
import { EXPENSE_CONFIRM_FALLBACK } from "./whatsapp-messages";
import { nomeMesYm } from "@/lib/fatura-competencia";

export type InteractiveButtons = {
  type: "button";
  body: string;
  buttons: Array<{ id: string; title: string }>;
};
export type InteractiveList = {
  type: "list";
  body: string;
  buttonText: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};
export type InteractiveReply = InteractiveButtons | InteractiveList;

/** IDs fixos → texto canônico já entendido pelo pipeline. */
export const REPLY_ID_TEXT: Record<string, string> = {
  confirm_yes: "sim",
  confirm_no: "não",
  payment_pix: "pix",
  payment_cash: "dinheiro",
  payment_debit: "débito",
  payment_credit: "cartão",
  recurrence_yes: "sim",
  recurrence_no: "não",
  // Confirmação de gasto. Cancelar → "não" para cair no MESMO cancelamento
  // do gasto (e não no reinício geral da conversa).
  expense_confirm: "sim",
  expense_adjust: "ajustar",
  expense_cancel: "não",
  expense_edit_description: "ajustar descrição",
  expense_edit_category: "ajustar categoria",
  expense_edit_value: "ajustar valor",
  expense_edit_date: "ajustar data",
  expense_edit_payment: "ajustar pagamento",
};

const MAX_BODY = 1024;
const MAX_BTN_TITLE = 20;
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESC = 72;

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

/** Converte o ID recebido em `button_reply`/`list_reply` no texto equivalente. */
export function replyIdToTexto(id: string, title?: string): string {
  const v = (id ?? "").trim();
  if (REPLY_ID_TEXT[v]) return REPLY_ID_TEXT[v];
  if (v.startsWith(FATURA_COMP_PREFIX)) return v; // tratado por tratarEscolhaFatura
  const opt = /^opt_(\d{1,2})$/.exec(v);
  if (opt) return opt[1];
  return (title ?? "").trim() || v;
}

/**
 * Decide se a resposta textual ganha botões/lista. Só reconhece perguntas
 * existentes — nunca muda o texto nem o fluxo.
 */
export function buildInteractiveFromReply(resposta: string): InteractiveReply | null {
  const body = (resposta ?? "").trim();
  if (!body || body.length > MAX_BODY) return null;
  const n = body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // Escolha de fatura (crédito sem cartão cadastrado).
  if (n.includes("em qual fatura essa compra vai cair")) {
    const ym = extractFaturaOptions(body);
    if (ym.length === 2) {
      return {
        type: "button",
        body,
        buttons: [
          ...ym.map((o) => ({
            id: `${FATURA_COMP_PREFIX}${o}`,
            title: clip(nomeMesYm(o).split("/")[0], MAX_BTN_TITLE),
          })),
          { id: `${FATURA_COMP_PREFIX}outro`, title: "Outro mês" },
        ],
      };
    }
  }

  // Confirmação de gasto: Confirmar / Ajustar / Cancelar. O bloco
  // "Responda: 1/2/3" só existe para o fallback textual e sai do corpo.
  if (body.includes(EXPENSE_CONFIRM_FALLBACK)) {
    const semFallback = body.replace(EXPENSE_CONFIRM_FALLBACK, "").trim();
    return {
      type: "button",
      body: semFallback,
      buttons: [
        { id: "expense_confirm", title: "Confirmar" },
        { id: "expense_adjust", title: "Ajustar" },
        { id: "expense_cancel", title: "Cancelar" },
      ],
    };
  }

  // Qual campo ajustar (5 opções → lista).
  if (n.startsWith("o que voce quer ajustar?")) {
    return {
      type: "list",
      body: "O que você quer ajustar?",
      buttonText: "Escolher",
      rows: [
        { id: "expense_edit_description", title: "Descrição" },
        { id: "expense_edit_category", title: "Categoria" },
        { id: "expense_edit_value", title: "Valor" },
        { id: "expense_edit_date", title: "Data" },
        { id: "expense_edit_payment", title: "Pagamento" },
      ],
    };
  }

  // Forma de pagamento (4 opções → lista).
  if (n.includes("responda com: pix, dinheiro, debito ou cartao")) {
    return {
      type: "list",
      body,
      buttonText: "Forma de pagamento",
      rows: [
        { id: "payment_pix", title: "Pix" },
        { id: "payment_cash", title: "Dinheiro" },
        { id: "payment_debit", title: "Débito" },
        { id: "payment_credit", title: "Cartão de crédito" },
      ],
    };
  }

  // Confirmações sim/não (gasto, receita, recorrência).
  if (/responda sim ou (nao|diga)/.test(n)) {
    return {
      type: "button",
      body,
      buttons: [
        { id: "confirm_yes", title: "Sim" },
        { id: "confirm_no", title: "Não" },
      ],
    };
  }

  // Listas numeradas (menu, escolha de cartão, seleção de contas).
  const rows = extractNumberedOptions(body);
  if (rows.length >= 2 && rows.length <= 10 && /(numero|responda|escolha|digite)/.test(n)) {
    return {
      type: "list",
      body,
      buttonText: "Ver opções",
      rows: rows.map((r) => ({
        id: `opt_${r.num}`,
        title: clip(r.label, MAX_ROW_TITLE),
        description: r.label.length > MAX_ROW_TITLE ? clip(r.label, MAX_ROW_DESC) : undefined,
      })),
    };
  }
  return null;
}

/** Tira os meses YYYY-MM sugeridos do texto da pergunta de fatura. */
function extractFaturaOptions(body: string): string[] {
  const MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const out: string[] = [];
  for (const m of body.matchAll(/"fatura de ([a-zç]+) de (\d{4})"/gi)) {
    const i = MESES.indexOf(m[1].toLowerCase());
    if (i >= 0) out.push(`${m[2]}-${String(i + 1).padStart(2, "0")}`);
  }
  return out;
}

/** "1. Gastos", "2) Cartões", "3️⃣ Contas", "• 4 - Receitas" → {num,label}. */
export function extractNumberedOptions(body: string): Array<{ num: number; label: string }> {
  const out: Array<{ num: number; label: string }> = [];
  for (const line of body.split("\n")) {
    const m = /^\s*(?:[•*-]\s*)?(\d{1,2})(?:\uFE0F?\u20E3|[.)\-–:])\s*(.+)$/.exec(line);
    if (!m) continue;
    const num = Number(m[1]);
    const label = m[2].replace(/[*_~]/g, "").trim();
    if (!label || out.some((o) => o.num === num)) continue;
    out.push({ num, label });
  }
  // Exige sequência começando em 1 (evita confundir valores/datas).
  return out.length && out[0].num === 1 && out.every((o, i) => o.num === i + 1) ? out : [];
}

/** Monta o objeto `interactive` da Graph API. */
export function toGraphInteractive(i: InteractiveReply): Record<string, unknown> {
  if (i.type === "button") {
    return {
      type: "button",
      body: { text: i.body },
      action: {
        buttons: i.buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: clip(b.title, MAX_BTN_TITLE) },
        })),
      },
    };
  }
  return {
    type: "list",
    body: { text: i.body },
    action: {
      button: clip(i.buttonText, MAX_BTN_TITLE),
      sections: [
        {
          title: "Opções",
          rows: i.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: clip(r.title, MAX_ROW_TITLE),
            ...(r.description ? { description: clip(r.description, MAX_ROW_DESC) } : {}),
          })),
        },
      ],
    },
  };
}
