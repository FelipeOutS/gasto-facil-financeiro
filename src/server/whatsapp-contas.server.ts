/**
 * WA-C1 — Consulta de CONTAS A PAGAR / VENCIMENTOS PRÓXIMOS via
 * WhatsApp. Apenas leitura. Reusa `contas-vencimento.server.ts` —
 * nunca duplica regras nem toca em fatura de cartão, gasto, recorrência
 * ou memória de estabelecimento.
 *
 * Garantias (auditadas):
 *   - Não cria/atualiza/exclui conta, gasto, recorrência, cartão, fatura,
 *     parcela, alerta, lembrete ou memória.
 *   - Filtra por `userId` autorizado pelo gate canônico.
 *   - Log: nunca inclui valor, descrição, data, userId, telefone ou
 *     texto original.
 *   - Linguagem segura: "atraso" só é afirmado porque `contas_a_pagar`
 *     possui `status` confiável; caso contrário, usa "vencimento
 *     anterior previsto".
 */
import {
  findVencimentoByTerm,
  getVencimentosComStatusAnterior,
  getVencimentosPorPeriodo,
  monthRangeInAppTz,
  todayISOInAppTz,
  tomorrowISOInAppTz,
  weekRangeInAppTz,
  type ContaVencimentoRow,
} from "./contas-vencimento.server";
import { nowInAppTz } from "./cartao-fatura.server";

export const PAGE_SIZE = 5;

export type DueIntent =
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "week" }
  | { kind: "month"; yearMonth: string | null }
  | { kind: "overdue" }
  | { kind: "term"; termo: string };

export type DueResultStatus =
  | "answered"
  | "no_due_items"
  | "ambiguous_item"
  | "payment_status_unavailable"
  | "no_more_items";

export type DueSessionState = {
  kind: "consulta_vencimentos";
  mode: "today" | "tomorrow" | "week" | "month" | "term" | "overdue";
  page: number;
  referenceMonth: string | null;
};

export type DueResult = {
  status: DueResultStatus;
  resposta: string;
  nextSession?: DueSessionState | null;
};

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDM(iso: string): string {
  // YYYY-MM-DD -> DD/MM
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function logDueQuery(args: {
  intent:
    | "due_today"
    | "due_tomorrow"
    | "due_week"
    | "due_month"
    | "due_overdue"
    | "due_term"
    | "due_page";
  itemsReturnedCount: number;
  result: DueResultStatus;
}) {
  console.info({
    event: "wa_due_date_query",
    intent: args.intent,
    itemsReturnedCount: args.itemsReturnedCount,
    result: args.result,
  });
}

const MES_NOMES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function parseMonthFromText(t: string): string | null {
  // "julho", "em julho", "mes que vem", "proximo mes", "este mes".
  const hoje = nowInAppTz();
  if (/\b(este|esse|deste|do)\s+mes\b/.test(t) || /\bmes\s+atual\b/.test(t)) {
    return monthRangeInAppTz(null, hoje).yearMonth;
  }
  if (/\bmes\s+que\s+vem\b/.test(t) || /\bproximo\s+mes\b/.test(t)) {
    const d = new Date(hoje);
    d.setMonth(d.getMonth() + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  for (let i = 0; i < MES_NOMES.length; i += 1) {
    const re = new RegExp(`\\b${MES_NOMES[i]}\\b`);
    if (re.test(t)) {
      const y = hoje.getFullYear();
      // se o mês já passou neste ano, assume próximo ano.
      const candidate = i + 1;
      const useY = candidate < hoje.getMonth() + 1 ? y + 1 : y;
      return `${useY}-${String(candidate).padStart(2, "0")}`;
    }
  }
  // "07/2026" ou "07-2026"
  const m = t.match(/\b(0?[1-9]|1[0-2])[\/\-](\d{4})\b/);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  return null;
}

const FATURA_KEYWORDS =
  /\bfatura\b|\bcart(?:ao|oes)\b|\bnubank\b|\binter\b|\bitau\b|\bbradesco\b|\bsantander\b|\bcaixa\b/;

/**
 * Detecta intenção de consulta de vencimentos/contas a pagar. Retorna
 * null se a mensagem não é claramente sobre vencimento. NUNCA captura
 * "fatura do cartão" — isso é WA-F1..F5.
 */
export function detectDueIntent(texto: string): DueIntent | null {
  const t = norm(texto);
  if (!t) return null;

  // Bloqueia mensagens com valor monetário (são gastos, não consultas).
  if (/r\$\s*\d/.test(t) || /\d+[.,]\d{2}\b/.test(t)) return null;

  // Bloqueia perguntas sobre fatura de cartão (WA-F1..F5).
  if (FATURA_KEYWORDS.test(t)) return null;

  // Bloqueia perguntas de gasto/receita/saldo — competência de WA-G4.
  if (
    /\bgast(?:ei|ar|o|os|ou)\b/.test(t) ||
    /\brecebi\b/.test(t) ||
    /\bganhei\b/.test(t) ||
    /\bsobra\b/.test(t) ||
    /\bsaldo\b/.test(t)
  ) {
    return null;
  }

  // Vocabulário típico de contas a pagar. Sem ele, NÃO ativa este módulo.
  const billsLex =
    /\bvenc(?:e|er|imento|imentos)\b/.test(t) ||
    /\bvencendo\b/.test(t) ||
    /\bvenceu\b/.test(t) ||
    /\bpagar\b/.test(t) ||
    /\bconta(?:s)?\b/.test(t) ||
    /\bcompromiss[oa]s?\b/.test(t) ||
    /\batrasad[ao]s?\b/.test(t) ||
    /\bboleto(?:s)?\b/.test(t);

  if (!billsLex) return null;

  // "vencimentos atrasados" / "o que venceu" / "tenho atrasada"
  if (
    /\batrasad[ao]s?\b/.test(t) ||
    /\bo\s+que\s+venceu\b/.test(t) ||
    /\bvenceu\s+e\s+(?:eu\s+)?nao\s+paguei\b/.test(t) ||
    /\bconta(?:s)?\s+vencidas?\b/.test(t)
  ) {
    return { kind: "overdue" };
  }

  // "vence hoje" / "conta(s) para pagar hoje"
  if (
    /\bvence\s+hoje\b/.test(t) ||
    /\bhoje\s+vence\b/.test(t) ||
    (/\b(o\s+que|tem\s+(?:conta|algo))\b.*\bhoje\b/.test(t) && /\bpagar|vence/.test(t)) ||
    /\bconta(?:s)?\s+para\s+pagar\s+hoje\b/.test(t) ||
    /\bvencimentos?\s+(?:de\s+)?hoje\b/.test(t)
  ) {
    return { kind: "today" };
  }

  // "vence amanha"
  if (
    /\bvence\s+amanha\b/.test(t) ||
    /\bamanha\s+vence\b/.test(t) ||
    /\bconta(?:s)?\s+(?:vencendo|para\s+pagar)\s+amanha\b/.test(t) ||
    (/\b(?:o\s+que|tem)\b.*\bamanha\b/.test(t) && /\bvenc|pagar\b/.test(t)) ||
    /\bvencimentos?\s+(?:de\s+)?amanha\b/.test(t)
  ) {
    return { kind: "tomorrow" };
  }

  // "essa semana" / "ate domingo" — só dispara junto com bills lex.
  if (
    /\b(essa|esta|nesta|nessa)\s+semana\b/.test(t) ||
    /\bate\s+domingo\b/.test(t) ||
    /\bsemana\s+atual\b/.test(t)
  ) {
    return { kind: "week" };
  }

  // Mês — exige bills lex (já garantido acima) + indicador de mês.
  const mesYM = parseMonthFromText(t);
  if (
    mesYM ||
    /\bcontas?\s+do\s+mes\b/.test(t) ||
    /\bminhas\s+contas\s+do\s+mes\b/.test(t) ||
    /\bquanto\s+(?:tenho|vou)\s+(?:que\s+|de\s+)?pagar\s+(?:este|esse|nesse|no)\s+mes\b/.test(t)
  ) {
    return { kind: "month", yearMonth: mesYM };
  }


  // "quais contas tenho para pagar" / "minhas contas" / "o que tenho para pagar"
  if (
    /\bquais\s+contas\s+(?:eu\s+)?tenho\b/.test(t) ||
    /\bminhas\s+contas\b/.test(t) ||
    /\b(?:o\s+que|quanto)\s+(?:eu\s+)?tenho\s+(?:para|pra)\s+pagar\b/.test(t) ||
    /\bcontas?\s+a\s+pagar\b/.test(t) ||
    /\bvencimentos?\s+proximos?\b/.test(t)
  ) {
    return { kind: "month", yearMonth: null };
  }

  // "quando vence X" / "qual o proximo vencimento da X"
  let m = t.match(/\bquando\s+vence\s+(?:a|o|meu|minha)?\s*([a-z0-9 ]{2,40})$/);
  if (m && m[1].trim()) return { kind: "term", termo: m[1].trim() };
  m = t.match(/\bproximo\s+vencimento\s+(?:da|do|de)\s+([a-z0-9 ]{2,40})$/);
  if (m && m[1].trim()) return { kind: "term", termo: m[1].trim() };
  m = t.match(/\bvencimento\s+(?:da|do|de)\s+([a-z0-9 ]{2,40})$/);
  if (m && m[1].trim()) return { kind: "term", termo: m[1].trim() };

  return null;
}

function renderHeader(mode: DueIntent["kind"], ym: string | null): string {
  if (mode === "today") return "Você tem os seguintes vencimentos previstos para hoje:";
  if (mode === "tomorrow") return "Você tem os seguintes vencimentos previstos para amanhã:";
  if (mode === "week") return "Seus próximos vencimentos desta semana:";
  if (mode === "month") {
    const [y, m] = (ym ?? monthRangeInAppTz().yearMonth).split("-").map(Number);
    const nome = MES_NOMES[(m ?? 1) - 1] ?? "";
    return `Seus compromissos previstos para ${nome} de ${y}:`;
  }
  return "Compromissos previstos:";
}

function renderItens(rows: ContaVencimentoRow[], includeDate: boolean): string {
  return rows
    .map((r) => {
      const left = includeDate
        ? `• ${fmtDM(r.dataVencimento)} — ${r.nome}`
        : `• ${r.nome}`;
      return `${left} — ${fmtBRL(r.valor)}`;
    })
    .join("\n");
}

function totalOf(rows: ContaVencimentoRow[]): number {
  return rows.reduce((acc, r) => acc + (Number.isFinite(r.valor) ? r.valor : 0), 0);
}

/**
 * Constrói a resposta paginada (PAGE_SIZE itens por página). Retorna
 * `nextSession` quando ainda há páginas restantes; caso contrário null.
 */
function paginate(
  rows: ContaVencimentoRow[],
  mode: DueSessionState["mode"],
  page: number,
  referenceMonth: string | null,
  header: string,
  includeDate: boolean,
  totalLabel: string,
): { body: string; nextSession: DueSessionState | null } {
  const totalAll = totalOf(rows);
  const start = page * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);
  const lines: string[] = [header, "", renderItens(slice, includeDate)];
  const remaining = rows.length - (start + slice.length);
  if (page === 0) {
    lines.push("", `${totalLabel}: ${fmtBRL(totalAll)}`);
  }
  if (remaining > 0) {
    lines.push("", `Digite "ver mais" para continuar (${remaining} restantes).`);
    return {
      body: lines.join("\n"),
      nextSession: {
        kind: "consulta_vencimentos",
        mode,
        page: page + 1,
        referenceMonth,
      },
    };
  }
  return { body: lines.join("\n"), nextSession: null };
}

/**
 * Handler principal: resolve intent → consulta helper → monta resposta.
 * Não persiste sessão; isso fica a cargo do pipeline (whatsapp.server).
 */
export async function handleDueIntent(
  userId: string,
  intent: DueIntent,
): Promise<DueResult> {
  const hoje = nowInAppTz();

  if (intent.kind === "today") {
    const iso = todayISOInAppTz(hoje);
    const rows = await getVencimentosPorPeriodo(userId, iso, iso);
    if (rows.length === 0) {
      const out: DueResult = {
        status: "no_due_items",
        resposta: "Não encontrei vencimentos previstos para hoje.",
      };
      logDueQuery({ intent: "due_today", itemsReturnedCount: 0, result: out.status });
      return out;
    }
    const { body, nextSession } = paginate(
      rows, "today", 0, null,
      `Você tem ${rows.length} vencimento${rows.length > 1 ? "s" : ""} previsto${rows.length > 1 ? "s" : ""} para hoje:`,
      false,
      "Total previsto para hoje",
    );
    const out: DueResult = { status: "answered", resposta: body, nextSession };
    logDueQuery({ intent: "due_today", itemsReturnedCount: rows.length, result: out.status });
    return out;
  }

  if (intent.kind === "tomorrow") {
    const iso = tomorrowISOInAppTz(hoje);
    const rows = await getVencimentosPorPeriodo(userId, iso, iso);
    if (rows.length === 0) {
      const out: DueResult = {
        status: "no_due_items",
        resposta: "Não encontrei vencimentos previstos para amanhã.",
      };
      logDueQuery({ intent: "due_tomorrow", itemsReturnedCount: 0, result: out.status });
      return out;
    }
    const { body, nextSession } = paginate(
      rows, "tomorrow", 0, null,
      `Você tem ${rows.length} vencimento${rows.length > 1 ? "s" : ""} previsto${rows.length > 1 ? "s" : ""} para amanhã:`,
      false,
      "Total previsto para amanhã",
    );
    const out: DueResult = { status: "answered", resposta: body, nextSession };
    logDueQuery({ intent: "due_tomorrow", itemsReturnedCount: rows.length, result: out.status });
    return out;
  }

  if (intent.kind === "week") {
    const { startISO, endISO } = weekRangeInAppTz(hoje);
    const rows = await getVencimentosPorPeriodo(userId, startISO, endISO);
    if (rows.length === 0) {
      const out: DueResult = {
        status: "no_due_items",
        resposta: "Não encontrei vencimentos previstos para esta semana.",
      };
      logDueQuery({ intent: "due_week", itemsReturnedCount: 0, result: out.status });
      return out;
    }
    const { body, nextSession } = paginate(
      rows, "week", 0, null,
      renderHeader("week", null),
      true,
      "Total previsto na semana",
    );
    const out: DueResult = { status: "answered", resposta: body, nextSession };
    logDueQuery({ intent: "due_week", itemsReturnedCount: rows.length, result: out.status });
    return out;
  }

  if (intent.kind === "month") {
    const { startISO, endISO, yearMonth } = monthRangeInAppTz(intent.yearMonth, hoje);
    const rows = await getVencimentosPorPeriodo(userId, startISO, endISO);
    if (rows.length === 0) {
      const out: DueResult = {
        status: "no_due_items",
        resposta: "Não encontrei compromissos previstos para esse mês.",
      };
      logDueQuery({ intent: "due_month", itemsReturnedCount: 0, result: out.status });
      return out;
    }
    const { body, nextSession } = paginate(
      rows, "month", 0, yearMonth,
      renderHeader("month", yearMonth),
      true,
      "Total previsto no mês",
    );
    const out: DueResult = { status: "answered", resposta: body, nextSession };
    logDueQuery({ intent: "due_month", itemsReturnedCount: rows.length, result: out.status });
    return out;
  }

  if (intent.kind === "overdue") {
    const ref = todayISOInAppTz(hoje);
    const rows = await getVencimentosComStatusAnterior(userId, ref);
    if (rows.length === 0) {
      const out: DueResult = {
        status: "no_due_items",
        resposta:
          "Não encontrei contas com vencimento anterior em aberto. " +
          "Tudo registrado aparece como pago ou em dia.",
      };
      logDueQuery({ intent: "due_overdue", itemsReturnedCount: 0, result: out.status });
      return out;
    }
    // Como `contas_a_pagar.status` é confiável ('pendente'/'pago'),
    // podemos afirmar "atraso" com segurança.
    const { body, nextSession } = paginate(
      rows, "overdue", 0, null,
      `Você tem ${rows.length} conta${rows.length > 1 ? "s" : ""} em atraso (vencimento anterior e ainda em aberto):`,
      true,
      "Total em atraso",
    );
    const out: DueResult = { status: "answered", resposta: body, nextSession };
    logDueQuery({ intent: "due_overdue", itemsReturnedCount: rows.length, result: out.status });
    return out;
  }

  // term
  const rows = await findVencimentoByTerm(userId, intent.termo);
  if (rows.length === 0) {
    const out: DueResult = {
      status: "no_due_items",
      resposta:
        `Não encontrei nenhuma conta a pagar com "${intent.termo}".\n\n` +
        `Confira o nome cadastrado em Contas a Pagar.`,
    };
    logDueQuery({ intent: "due_term", itemsReturnedCount: 0, result: out.status });
    return out;
  }
  const nomes = Array.from(new Set(rows.map((r) => r.nome)));
  if (nomes.length > 1) {
    const lista = nomes.slice(0, 5).map((n, i) => `${i + 1}. ${n}`).join("\n");
    const out: DueResult = {
      status: "ambiguous_item",
      resposta:
        `Encontrei mais de uma conta com "${intent.termo}". Qual delas?\n\n` +
        lista +
        `\n\nResponda com o nome completo.`,
    };
    logDueQuery({ intent: "due_term", itemsReturnedCount: nomes.length, result: out.status });
    return out;
  }
  const nome = nomes[0];
  const proxima = rows[0]; // já ordenado por data_vencimento ASC
  const out: DueResult = {
    status: "answered",
    resposta:
      `A próxima conta de ${nome} vence em ${fmtDM(proxima.dataVencimento)}, ` +
      `no valor previsto de ${fmtBRL(proxima.valor)}.`,
  };
  logDueQuery({ intent: "due_term", itemsReturnedCount: 1, result: out.status });
  return out;
}

/**
 * Paginação a partir de uma sessão temporária. Reconsulta o helper
 * para evitar guardar IDs/valores na sessão. Determinístico via ORDER
 * BY (data, nome) garantido pelo helper.
 */
export async function handleDuePagination(
  userId: string,
  state: DueSessionState,
): Promise<DueResult> {
  const hoje = nowInAppTz();
  let rows: ContaVencimentoRow[] = [];
  if (state.mode === "today") {
    const iso = todayISOInAppTz(hoje);
    rows = await getVencimentosPorPeriodo(userId, iso, iso);
  } else if (state.mode === "tomorrow") {
    const iso = tomorrowISOInAppTz(hoje);
    rows = await getVencimentosPorPeriodo(userId, iso, iso);
  } else if (state.mode === "week") {
    const { startISO, endISO } = weekRangeInAppTz(hoje);
    rows = await getVencimentosPorPeriodo(userId, startISO, endISO);
  } else if (state.mode === "month") {
    const { startISO, endISO } = monthRangeInAppTz(state.referenceMonth, hoje);
    rows = await getVencimentosPorPeriodo(userId, startISO, endISO);
  } else if (state.mode === "overdue") {
    rows = await getVencimentosComStatusAnterior(userId, todayISOInAppTz(hoje));
  } else {
    // term — não paginamos.
    rows = [];
  }
  const start = state.page * PAGE_SIZE;
  if (start >= rows.length) {
    const out: DueResult = {
      status: "no_more_items",
      resposta: "Não há mais vencimentos para mostrar.",
      nextSession: null,
    };
    logDueQuery({ intent: "due_page", itemsReturnedCount: 0, result: out.status });
    return out;
  }
  const slice = rows.slice(start, start + PAGE_SIZE);
  const remaining = rows.length - (start + slice.length);
  const includeDate = state.mode !== "today" && state.mode !== "tomorrow";
  const lines: string[] = [
    "Continuando os vencimentos:",
    "",
    renderItens(slice, includeDate),
  ];
  let nextSession: DueSessionState | null = null;
  if (remaining > 0) {
    lines.push("", `Digite "ver mais" para continuar (${remaining} restantes).`);
    nextSession = { ...state, page: state.page + 1 };
  }
  const out: DueResult = {
    status: "answered",
    resposta: lines.join("\n"),
    nextSession,
  };
  logDueQuery({ intent: "due_page", itemsReturnedCount: slice.length, result: out.status });
  return out;
}
