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
import {
  CARD_CONFIRM_FALLBACK,
  CARD_DUP_FALLBACK,
  CARD_EDIT_FALLBACK,
  CARD_EDIT_QUESTION,
  CARD_NEW_FALLBACK,
  CARD_POS_FALLBACK,
} from "./whatsapp-cartao-messages";
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
  // Menu principal → mesmo número que a pessoa digitaria no menu em texto.
  menu_gastos: "1",
  menu_cartoes: "2",
  menu_contas: "3",
  menu_receitas: "4",
  menu_planejamento: "5",
  menu_resumos: "6",
  menu_ajuda: "7",
  menu_comandos: "8",
  // GI Agenda (mesma frase que a pessoa digitaria).
  menu_agenda: "minha agenda",
  // Submenus → mesma frase natural já entendida pelo pipeline.
  gastos_registrar: "registrar gasto",
  gastos_mes: "meus gastos do mês",
  gastos_semana: "gastos desta semana",
  gastos_consultar: "meus gastos",
  cartoes_cadastrar: "cadastrar cartão",
  cartoes_fatura: "minha fatura",
  cartoes_proxima: "próxima fatura",
  cartoes_futuras: "faturas futuras",
  cartoes_limite: "limite do meu cartão",
  contas_nova: "cadastrar conta",
  contas_proximas: "próximas contas",
  contas_recorrentes: "contas recorrentes",
  contas_atrasadas: "contas atrasadas",
  receitas_registrar: "registrar receita",
  receitas_mes: "receitas do mês",
  plan_metas: "minhas metas",
  plan_orcamento: "meu orçamento",
  resumo_hoje: "quanto gastei hoje",
  resumo_semana: "resumo da semana",
  resumo_mes: "resumo do mês",
  // Cadastro de cartão (Flow ou conversa). Cancelar → "não" para cancelar
  // só o cadastro, sem cair no reinício geral da conversa.
  card_reg_confirm: "cadastrar",
  card_reg_adjust: "ajustar",
  card_reg_cancel: "não",
  card_reg_spend: "lançar gasto",
  card_reg_later: "agora não",
  card_dup_use: "usar existente",
  card_dup_rename: "alterar nome",
  card_edit_nome: "nome",
  card_edit_limite: "limite",
  card_edit_fechamento: "fechamento",
  card_edit_vencimento: "vencimento",
  // Gasto com cartão não cadastrado.
  card_new_register: "cadastrar cartão",
  card_new_continue: "continuar sem cadastrar",
};

/** Prefixo de ID para escolha de cartão: o resto é o rótulo mascarado. */
export const CARD_PICK_PREFIX = "card_pick:";

/** Cabeçalho que identifica o menu principal (ver consulta.ajuda). */
export const MAIN_MENU_MARKER = "📌 O que deseja fazer?";

type Row = { id: string; title: string; description?: string };
/** Submenus: cabeçalho do texto-guia (dispatchMenuOption) → ações. */
const SUBMENUS: Array<{ header: string; button: string; rows: Row[] }> = [
  {
    header: "📝 Gastos",
    button: "Ver opções",
    rows: [
      { id: "gastos_registrar", title: "➕ Registrar gasto" },
      { id: "gastos_mes", title: "📅 Gastos do mês" },
      { id: "gastos_semana", title: "📆 Gastos da semana" },
      { id: "gastos_consultar", title: "🔎 Consultar gastos" },
    ],
  },
  {
    header: "💳 Cartões",
    button: "Ver opções",
    rows: [
      { id: "cartoes_cadastrar", title: "➕ Cadastrar cartão" },
      { id: "cartoes_fatura", title: "💳 Minha fatura" },
      { id: "cartoes_proxima", title: "📅 Próxima fatura" },
      { id: "cartoes_futuras", title: "🗓️ Faturas futuras" },
      { id: "cartoes_limite", title: "💰 Limite disponível" },
    ],
  },
  {
    header: "📄 Contas",
    button: "Ver opções",
    rows: [
      { id: "contas_nova", title: "➕ Nova conta" },
      { id: "contas_proximas", title: "📋 Próximas contas" },
      { id: "contas_recorrentes", title: "🔁 Contas recorrentes" },
      { id: "contas_atrasadas", title: "⏰ Contas atrasadas" },
    ],
  },
  {
    header: "💰 Receitas",
    button: "Ver opções",
    rows: [
      { id: "receitas_registrar", title: "➕ Registrar receita" },
      { id: "receitas_mes", title: "📊 Receitas do mês" },
    ],
  },
  {
    header: "🎯 Planejamento",
    button: "Ver opções",
    rows: [
      { id: "plan_metas", title: "🎯 Minhas metas" },
      { id: "plan_orcamento", title: "📊 Meu orçamento" },
    ],
  },
  {
    header: "📊 Resumos",
    button: "Ver opções",
    rows: [
      { id: "resumo_hoje", title: "📅 Hoje" },
      { id: "resumo_semana", title: "📆 Esta semana" },
      { id: "resumo_mes", title: "🗓️ Este mês" },
    ],
  },
];

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
  // GI Agenda: ID estável com o item; tratado por handleAgendaIntent.
  if (/^agenda_(?:done|cancel|edit|view):/.test(v)) return v;
  if (v.startsWith(CARD_PICK_PREFIX)) return v.slice(CARD_PICK_PREFIX.length).trim();
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
            title: clip(`📅 ${nomeMesYm(o).split("/")[0]}`, MAX_BTN_TITLE),
          })),
          { id: `${FATURA_COMP_PREFIX}outro`, title: "🗓️ Outro mês" },
        ],
      };
    }
  }

  // Cadastro de cartão: blocos "Responda: ..." viram botões/lista.
  const cardButtons: Array<[string, Array<{ id: string; title: string }>]> = [
    [
      CARD_CONFIRM_FALLBACK,
      [
        { id: "card_reg_confirm", title: "✅ Cadastrar" },
        { id: "card_reg_adjust", title: "✏️ Ajustar" },
        { id: "card_reg_cancel", title: "❌ Cancelar" },
      ],
    ],
    [
      CARD_DUP_FALLBACK,
      [
        { id: "card_dup_use", title: "💳 Usar existente" },
        { id: "card_dup_rename", title: "✏️ Alterar nome" },
        { id: "card_reg_cancel", title: "❌ Cancelar" },
      ],
    ],
    [
      CARD_POS_FALLBACK,
      [
        { id: "card_reg_spend", title: "➕ Lançar gasto" },
        { id: "card_reg_later", title: "Agora não" },
      ],
    ],
    [
      CARD_NEW_FALLBACK,
      [
        { id: "card_new_register", title: "➕ Cadastrar cartão" },
        { id: "card_new_continue", title: "➡️ Sem cadastrar" },
        { id: "expense_cancel", title: "❌ Cancelar" },
      ],
    ],
  ];
  for (const [fallback, buttons] of cardButtons) {
    if (body.includes(fallback)) {
      return { type: "button", body: body.replace(fallback, "").trim(), buttons };
    }
  }
  if (body.includes(CARD_EDIT_QUESTION) && body.includes(CARD_EDIT_FALLBACK)) {
    return {
      type: "list",
      body: body.replace(CARD_EDIT_FALLBACK, "").trim(),
      buttonText: "Escolher",
      rows: [
        { id: "card_edit_nome", title: "💳 Nome" },
        { id: "card_edit_limite", title: "💰 Limite" },
        { id: "card_edit_fechamento", title: "📅 Fechamento" },
        { id: "card_edit_vencimento", title: "🗓️ Vencimento" },
      ],
    };
  }

  // Confirmação de gasto: Confirmar / Ajustar / Cancelar. O bloco
  // "Responda: 1/2/3" só existe para o fallback textual e sai do corpo.
  if (body.includes(EXPENSE_CONFIRM_FALLBACK)) {
    const semFallback = body.replace(EXPENSE_CONFIRM_FALLBACK, "").trim();
    return {
      type: "button",
      body: semFallback,
      buttons: [
        { id: "expense_confirm", title: "✅ Confirmar" },
        { id: "expense_adjust", title: "✏️ Ajustar" },
        { id: "expense_cancel", title: "❌ Cancelar" },
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
        { id: "expense_edit_description", title: "💬 Descrição" },
        { id: "expense_edit_category", title: "🏷️ Categoria" },
        { id: "expense_edit_value", title: "💰 Valor" },
        { id: "expense_edit_date", title: "📅 Data" },
        { id: "expense_edit_payment", title: "💳 Pagamento" },
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
        { id: "payment_pix", title: "💠 Pix" },
        { id: "payment_cash", title: "💵 Dinheiro" },
        { id: "payment_debit", title: "🏦 Débito" },
        { id: "payment_credit", title: "💳 Cartão de crédito" },
      ],
    };
  }

  // Menu principal → lista nativa curta ("Ver menu").
  if (body.includes(MAIN_MENU_MARKER)) {
    return {
      type: "list",
      body: "Como posso te ajudar? 👇",
      buttonText: "Ver menu",
      rows: [
        { id: "menu_gastos", title: "💸 Gastos" },
        { id: "menu_cartoes", title: "💳 Cartões" },
        { id: "menu_contas", title: "🧾 Contas" },
        { id: "menu_receitas", title: "💰 Receitas" },
        { id: "menu_planejamento", title: "🎯 Planejamento" },
        { id: "menu_resumos", title: "📊 Resumos" },
        { id: "menu_agenda", title: "📅 Agenda e lembretes" },
        { id: "menu_ajuda", title: "❓ Ajuda" },
        { id: "menu_comandos", title: "⚡ Comandos rápidos" },
      ],
    };
  }

  // Submenus (texto-guia de cada grupo) → lista com as principais ações.
  const sub = SUBMENUS.find((m) => body.startsWith(m.header));
  if (sub) {
    return { type: "list", body, buttonText: sub.button, rows: sub.rows };
  }

  // Escolha de cartão: 2–3 → botões; 4+ → lista. Só o rótulo mascarado.
  if (n.includes("qual cartao voce usou?")) {
    const cards = body
      .split("\n")
      .map((l) => /^\s*•\s*(.+)$/.exec(l)?.[1]?.trim())
      .filter((x): x is string => !!x);
    if (cards.length >= 2 && cards.length <= 3) {
      return {
        type: "button",
        body,
        buttons: cards.map((c) => ({ id: `${CARD_PICK_PREFIX}${c}`, title: `💳 ${c}` })),
      };
    }
    if (cards.length >= 4 && cards.length <= 10) {
      return {
        type: "list",
        body,
        buttonText: "Escolher cartão",
        rows: cards.map((c) => ({ id: `${CARD_PICK_PREFIX}${c}`, title: `💳 ${c}` })),
      };
    }
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
