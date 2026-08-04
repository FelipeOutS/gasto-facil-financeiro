/**
 * WA-C3 — DAR BAIXA em CONTAS A PAGAR existentes via WhatsApp.
 *
 * Reconhece mensagens como:
 *   "paguei a internet"
 *   "marcar aluguel como pago"
 *   "dei baixa na academia"
 *   "a conta de luz foi paga"
 *   "quitar plano de saúde"
 *
 * Garantias estritas (definidas no plano WA-C3):
 *   - Não cria gasto, fatura, recorrência, memória nem alerta.
 *   - Update CONDICIONAL em `contas_a_pagar` com
 *     `id = contaId AND user_id = authorizedUserId AND status = 'pendente'`.
 *     Isso bloqueia conta de outro usuário, dupla confirmação e baixa
 *     em conta já paga.
 *   - Frases de gasto consumado ("paguei 50 no mercado", "gastei 30")
 *     NUNCA disparam baixa de conta — exige verbo de pagamento + termo
 *     SEM valor monetário; e mesmo assim só prossegue se houver conta
 *     PENDENTE compatível.
 *   - Não fecha todas as ocorrências de uma recorrência: cada baixa
 *     altera somente UMA linha de `contas_a_pagar`.
 *   - Sessão guarda apenas `{ kind, contaId, candidateContaIds,
 *     dataPagamento }` — nunca nome, valor, telefone, OCR, transcrição.
 *   - Logs: `event=wa_payable_account_payment` com `stage`,
 *     `candidatesCount`, `result` apenas. Sem nome, valor, vencimento,
 *     contaId, userId, telefone, texto ou transcrição.
 */
import * as _supa from "@/integrations/supabase/client.server";
import type { WhatsAppMessageRow, ProcessOutcome } from "./whatsapp.server";
import {
  findVencimentoByTerm,
  todayISOInAppTz,
  type ContaVencimentoRow,
} from "./contas-vencimento.server";
import { nowInAppTz } from "./cartao-fatura.server";
// WA-C11 3B.2.C.1 Block 4 — quota financeira para baixa de conta.
import {
  assertFinancialActionQuotaForWhatsApp,
  financialQuotaBlockedReply,
} from "@/server/whatsapp-financial-quota-gate.server";

// Live-binding para permitir mock.module() em testes (mesmo padrão WA-F3/WA-C2).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy(
  {},
  {
    get: (_t, prop) => (_supa.supabaseAdmin as never)[prop as never],
  },
);

// ---------- tipos / estados ----------

export type BaixaContaSession = {
  kind: "baixa_conta";
  contaId: string | null;
  candidateContaIds: string[] | null;
  dataPagamento: string | null; // YYYY-MM-DD em America/Sao_Paulo
};

export const BAIXA_CONTA_PENDING_STATES = [
  "conta_pagamento_aguardando_escolha",
  "conta_pagamento_aguardando_confirmacao",
  "conta_pagamento_aguardando_data",
] as const;

export type BaixaContaStatus = (typeof BAIXA_CONTA_PENDING_STATES)[number];

export function isBaixaContaSession(s: unknown): s is BaixaContaSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "baixa_conta";
}

// ---------- DI seam ----------

export type WhatsAppBaixaContaDeps = {
  gravarSessao: (
    userId: string,
    telefone: string,
    externalId: string | null,
    texto: string,
    recebidaEm: string,
    status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any,
    resposta: string,
    gastoId?: string,
  ) => Promise<{
    ok: boolean;
    sessionId: string | null;
    status: string | null;
    errorCode: string | null;
  }>;
  atualizarSessao: (
    id: string,
    status: string,
    session: any,
    resposta: string,
    gastoId?: string,
  ) => Promise<unknown>;
  fecharSessoesAnteriores: (
    userId: string,
    telefone: string,
    motivo: "salva" | "cancelada" | "expirada",
    gastoId?: string,
  ) => Promise<void>;
};

// ---------- log seguro ----------

type Stage =
  | "detected"
  | "account_found"
  | "awaiting_choice"
  | "awaiting_confirmation"
  | "paid"
  | "noop"
  | "already_updated"
  | "cancelled"
  | "failed"
  | "reminders_cancelled";

type Result =
  | "ok"
  | "not_found"
  | "ambiguous"
  | "conflict"
  | "error"
  | "inconsistent"
  | "readback_failed";

function logEvent(stage: Stage, candidatesCount: number, result: Result) {
  console.info({
    event: "wa_payable_account_payment",
    stage,
    candidatesCount,
    result,
  });
}

// ---------- normalização ----------

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMonetaryValue(textRaw: string): boolean {
  // Roda sobre o texto BRUTO — normalização tira vírgulas e quebra "89,90".
  const t = textRaw.toLowerCase();
  if (/r\$\s*\d/.test(t)) return true;
  if (/\b\d+[.,]\d{2}\b/.test(t)) return true;
  if (/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/.test(t)) return true;
  if (/\b\d+\s*(?:reais|real|mil)\b/.test(t)) return true;
  // Número solto após verbo de pagamento (ex.: "paguei 42 no almoço").
  if (/\b(paguei|gastei|comprei)\s+\d+/.test(t)) return true;
  return false;
}

// ---------- detector ----------

/**
 * Detecta intenção de DAR BAIXA em conta pendente. Estrito por design:
 *   - Exige verbo explícito (paguei/quitei/dar baixa/marcar como pago/foi pago).
 *   - NÃO dispara quando há valor monetário (é gasto consumado).
 *   - NÃO dispara em "paguei no Pix", "paguei com cartão" sem objeto.
 *   - NÃO dispara em "vou pagar a internet" (intenção futura ≠ baixa).
 *
 * Retorna `{ termo }` quando reconhece — termo é o nome candidato a
 * casar com `contas_a_pagar.nome` no helper de busca.
 */
export function detectMarkAsPaidIntent(
  textRaw: string,
): { termo: string; paymentDate: string | null } | null {
  if (!textRaw || !textRaw.trim()) return null;
  // Bloqueia gastos consumados ANTES da normalização (vírgulas seriam removidas).
  if (hasMonetaryValue(textRaw)) return null;
  const t0 = norm(textRaw);
  if (!t0) return null;

  // Bloqueia fatura / cartão (competência WA-F1..F5).
  if (/\bfatura\b/.test(t0)) return null;

  // Bloqueia intenção futura ("vou pagar", "ainda preciso pagar").
  if (/\bvou\s+pagar\b/.test(t0) || /\bpreciso\s+pagar\b/.test(t0)) return null;
  // Bloqueia consultas: "o que paguei", "quando paguei".
  if (/\bo\s+que\s+paguei\b/.test(t0) || /\bquando\s+paguei\b/.test(t0)) return null;

  // WA-C3.1 — separa a data ANTES de casar o termo, para aceitar
  // "paguei a internet ontem", "dei baixa na academia em 03/07", etc.
  const { dateText, cleaned: t } = extractAndStripDate(t0);

  // Padrões aceitos. Cada um extrai o `termo`.
  // 1) "paguei [a|o|minha|meu|essa|esse] <termo>"
  let m = t.match(/\bpaguei\s+(?:(?:a|o|as|os|minha|meu|essa|esse|uma|um)\s+)?([a-z0-9 ]{2,40})$/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo, paymentDate: dateText };
  }
  // 2) "quitei <termo>" / "quitar <termo>"
  m = t.match(
    /\bquit(?:ei|ar|a|e)\s+(?:(?:a|o|as|os|minha|meu|essa|esse|uma|um)\s+)?([a-z0-9 ]{2,40})$/,
  );
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo, paymentDate: dateText };
  }
  // 3) "dei baixa (em|na|no|do|da) <termo>" / "dar baixa em <termo>"
  m = t.match(/\b(?:dei|dar|da)\s+baixa\s+(?:(?:em|na|no|do|da|nos|nas)\s+)?([a-z0-9 ]{2,40})$/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo, paymentDate: dateText };
  }
  // 4) "marcar <termo> como pago" / "marca <termo> como pago"
  m = t.match(
    /\bmarc(?:ar|a|e|ou)\s+(?:(?:a|o|as|os|minha|meu|essa|esse)\s+)?([a-z0-9 ]{2,40})\s+como\s+pag[ao]\b/,
  );
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo, paymentDate: dateText };
  }
  // 5) "<termo> foi pago/paga" / "a conta de <termo> foi paga"
  //    WA-C3.2 — preserva o nome composto inteiro (ex.: "conta de luz",
  //    "plano de saúde"). O regex aceita um artigo inicial opcional, mas
  //    NÃO consome "conta de" como prefixo descartável: ele entra no termo.
  m = t.match(
    /\b(?:(?:a|o|as|os|minha|meu|essa|esse)\s+)?([a-z0-9][a-z0-9 ]{1,40})\s+(?:foi|esta|ja\s+foi)\s+pag[ao]\b/,
  );
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo, paymentDate: dateText };
  }
  return null;
}

/**
 * WA-C3.1 — extrai e remove a primeira ocorrência de uma expressão de data
 * do texto normalizado. Mantém o restante da frase intacto para o casamento
 * de termo. NÃO remove palavras internas que poderiam fazer parte do nome
 * da conta (apenas tokens reconhecidos como data).
 */
function extractAndStripDate(textNorm: string): { dateText: string | null; cleaned: string } {
  const patterns: RegExp[] = [
    // "em 5 de julho [de 2026]" / "5 de julho"
    /\b(?:em\s+)?\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{2,4})?\b/,
    // "em DD/MM[/YYYY]" / "no DD/MM[/YYYY]"
    /\b(?:em|no|na)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    // "DD/MM[/YYYY]" — solto
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    // "no dia N do mes que vem" / "dia N do mes que vem"
    /\b(?:no\s+)?dia\s+\d{1,2}\s+do\s+mes\s+que\s+vem\b/,
    // "no dia N" / "dia N"
    /\b(?:no\s+)?dia\s+\d{1,2}\b/,
    // advérbios isolados
    /\bamanha\b/,
    /\bhoje\b/,
    /\bontem\b/,
  ];
  for (const re of patterns) {
    const m = textNorm.match(re);
    if (m) {
      const cleaned = textNorm.replace(re, " ").replace(/\s+/g, " ").trim();
      return { dateText: m[0], cleaned };
    }
  }
  return { dateText: null, cleaned: textNorm };
}

/**
 * WA-C3.2 — apenas tokens de "borda" descartáveis: artigos, pronomes e
 * marcadores periféricos ("já"). NÃO remove "conta", "de", "do", "da",
 * "dos", "das" — elas fazem parte de nomes legítimos ("conta de luz",
 * "plano de saúde", "seguro do carro").
 */
const EDGE_FILLERS = new Set([
  "a",
  "o",
  "as",
  "os",
  "minha",
  "meu",
  "essa",
  "esse",
  "uma",
  "um",
  "ja",
  "já",
]);

function stripFillers(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  while (words.length && EDGE_FILLERS.has(words[0])) words.shift();
  while (words.length && EDGE_FILLERS.has(words[words.length - 1])) words.pop();
  return words.join(" ").trim();
}

// ---------- ajuste de data ----------

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Extrai uma data alternativa de pagamento. Retorna `today | yesterday | iso`. */
function parseDataPagamento(textRaw: string, hoje: Date = nowInAppTz()): string | null {
  const t = norm(textRaw);
  if (!t) return null;
  if (/\bhoje\b/.test(t)) return todayISOInAppTz(hoje);
  if (/\bontem\b/.test(t)) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 1);
    return todayISOInAppTz(d);
  }
  if (/\bamanha\b/.test(t)) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 1);
    return todayISOInAppTz(d);
  }
  // "em 5 de julho [de 2026]" / "5 de julho"
  let m = t.match(
    /\b(?:em\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{2,4}))?\b/,
  );
  if (m) {
    const dia = Number(m[1]);
    const mes = MESES[m[2]];
    if (mes && dia >= 1 && dia <= 31) {
      let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
      if (ano < 100) ano = 2000 + ano;
      const last = new Date(ano, mes, 0).getDate();
      const d = Math.min(dia, last);
      return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // "dia N do mes que vem" / "no dia N do mes que vem"
  m = t.match(/\b(?:no\s+)?dia\s+(\d{1,2})\s+do\s+mes\s+que\s+vem\b/);
  if (m) {
    const dia = Number(m[1]);
    if (dia >= 1 && dia <= 31) {
      const next = new Date(hoje);
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const y = next.getFullYear();
      const mm = next.getMonth() + 1;
      const last = new Date(y, mm, 0).getDate();
      const d = Math.min(dia, last);
      return `${y}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // "no dia 5" / "dia 5" — assume mês corrente.
  m = t.match(/\b(?:no\s+)?dia\s+(\d{1,2})\b/);
  if (m) {
    const dia = Number(m[1]);
    if (dia >= 1 && dia <= 31) {
      const y = hoje.getFullYear();
      const mm = hoje.getMonth() + 1;
      const lastDay = new Date(y, mm, 0).getDate();
      const d = Math.min(dia, lastDay);
      return `${y}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // "DD/MM" ou "DD/MM/YYYY" (aceita prefixo "em"/"no").
  m = t.match(/\b(?:em|no|na)?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
      if (ano < 100) ano = 2000 + ano;
      const last = new Date(ano, mes, 0).getDate();
      const d = Math.min(dia, last);
      return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function isFutureISO(iso: string, hoje: Date = nowInAppTz()): boolean {
  return iso > todayISOInAppTz(hoje);
}

// ---------- formatação ----------

function previewSingle(row: ContaVencimentoRow, dataPagamento: string): string {
  return [
    "Encontrei esta conta pendente:",
    "",
    `• ${row.nome} — ${fmtBRL(row.valor)}`,
    `• Vencimento: ${fmtDateBR(row.dataVencimento)}`,
    `• Data de pagamento: ${fmtDateBR(dataPagamento)}`,
    "",
    'Confirma marcar como paga? Responda "sim", informe outra data (ex.: "ontem" ou "03/07") ou "cancelar".',
  ].join("\n");
}

function ambiguousList(rows: ContaVencimentoRow[], termo: string): string {
  // Sem valor nesta etapa, conforme especificação.
  const linhas = rows
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.nome} — vencimento ${fmtDateBR(r.dataVencimento)}`)
    .join("\n");
  return [
    `Encontrei mais de uma conta pendente de ${termo}.`,
    "",
    "Escolha uma para dar baixa:",
    linhas,
    "",
    'Responda com o número ou "cancelar".',
  ].join("\n");
}

function askFutureConfirm(iso: string): string {
  return [
    `A data ${fmtDateBR(iso)} ainda não chegou.`,
    "",
    'Confirma marcar como paga nessa data futura? Responda "sim" ou "cancelar".',
  ].join("\n");
}

// ---------- busca segura ----------

async function buscarContaPorId(
  userId: string,
  contaId: string,
): Promise<ContaVencimentoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .select(
      "id,nome,valor,data_vencimento,status,data_pagamento,categoria_id,recorrente,frequencia_recorrencia",
    )
    .eq("user_id", userId)
    .eq("id", contaId)
    .eq("status", "pendente")
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    nome: String(data.nome ?? ""),
    valor: Number(data.valor ?? 0) || 0,
    dataVencimento: String(data.data_vencimento ?? ""),
    status: "pendente",
    dataPagamento: data.data_pagamento ?? null,
    categoriaId: data.categoria_id ?? null,
    recorrente: Boolean(data.recorrente ?? false),
    frequenciaRecorrencia: data.frequencia_recorrencia ?? null,
  };
}

// ---------- handler principal ----------

export async function processarBaixaConta(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string } | null;
  deps: WhatsAppBaixaContaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const isHardCancel =
    /\b(cancelar|cancela|cancelado|cancelada)\b/i.test(texto) || decisao === "cancel";

  // Cancelamento em qualquer estado.
  if (sessao && isHardCancel) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    const resposta = "Tudo bem, não marquei nenhuma conta como paga.";
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "cancelada",
      sessao.session as never,
      resposta,
    );
    logEvent("cancelled", 0, "ok");
    return { status: "cancelada", resposta };
  }

  // ============ ENTRADA SEM SESSÃO ============
  if (!sessao) {
    const intent = detectMarkAsPaidIntent(texto);
    if (!intent) return { status: "sem_pendencia", resposta: "" };
    logEvent("detected", 0, "ok");
    const rows = await findVencimentoByTerm(userId, intent.termo);
    if (rows.length === 0) {
      logEvent("account_found", 0, "not_found");
      return {
        status: "consulta",
        resposta:
          "Não encontrei uma conta pendente com esse nome.\n\n" +
          'Você pode consultar suas contas com "o que vence esta semana?".',
      };
    }
    // 1 candidata → confirmação direta (ou confirmação extra se data futura).
    if (rows.length === 1) {
      const row = rows[0];
      // WA-C3.1 — usa data extraída da própria frase quando houver.
      const parsedFromIntent = intent.paymentDate ? parseDataPagamento(intent.paymentDate) : null;
      const dataPag = parsedFromIntent ?? todayISOInAppTz();
      const session: BaixaContaSession = {
        kind: "baixa_conta",
        contaId: row.id,
        candidateContaIds: null,
        dataPagamento: dataPag,
      };
      if (isFutureISO(dataPag)) {
        const resposta = askFutureConfirm(dataPag);
        await deps.gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "conta_pagamento_aguardando_data",
          session as never,
          resposta,
        );
        logEvent("awaiting_confirmation", 1, "ok");
        return { status: "pendente", resposta };
      }
      const resposta = previewSingle(row, dataPag);
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "conta_pagamento_aguardando_confirmacao",
        session as never,
        resposta,
      );
      logEvent("awaiting_confirmation", 1, "ok");
      return { status: "pendente", resposta };
    }
    // Mais de uma → desambiguação.
    const session: BaixaContaSession = {
      kind: "baixa_conta",
      contaId: null,
      candidateContaIds: rows.slice(0, 5).map((r) => r.id),
      dataPagamento: null,
    };
    const resposta = ambiguousList(rows, intent.termo);
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "conta_pagamento_aguardando_escolha",
      session as never,
      resposta,
    );
    logEvent("awaiting_choice", rows.length, "ambiguous");
    return { status: "pendente", resposta };
  }

  // ============ COM SESSÃO ATIVA ============
  const session = sessao.session as BaixaContaSession | null;
  if (!session || !isBaixaContaSession(session)) {
    return { status: "sem_pendencia", resposta: "" };
  }

  // ---- escolha entre múltiplos candidatos ----
  if (sessao.status === "conta_pagamento_aguardando_escolha") {
    const ids = session.candidateContaIds ?? [];
    const numMatch = norm(texto).match(/^(\d{1,2})$/);
    let chosenId: string | null = null;
    if (numMatch) {
      const idx = Number(numMatch[1]) - 1;
      if (idx >= 0 && idx < ids.length) chosenId = ids[idx];
    }
    if (!chosenId) {
      const resposta = `Não entendi. Responda com o número da conta (ex.: 1) ou "cancelar".`;
      await deps.atualizarSessao(
        sessao.id,
        "conta_pagamento_aguardando_escolha",
        session as never,
        resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = await buscarContaPorId(userId, chosenId);
    if (!conta) {
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
      const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "sem_pendencia",
        session as never,
        resposta,
      );
      logEvent("already_updated", 0, "conflict");
      return { status: "consulta", resposta };
    }
    const dataPag = todayISOInAppTz();
    const novaSession: BaixaContaSession = {
      kind: "baixa_conta",
      contaId: conta.id,
      candidateContaIds: null,
      dataPagamento: dataPag,
    };
    const resposta = previewSingle(conta, dataPag);
    await deps.atualizarSessao(
      sessao.id,
      "conta_pagamento_aguardando_confirmacao",
      novaSession as never,
      resposta,
    );
    logEvent("awaiting_confirmation", 1, "ok");
    return { status: "pendente", resposta };
  }

  // ---- confirmação direta de data futura ----
  if (sessao.status === "conta_pagamento_aguardando_data") {
    if (decisao === "confirm") {
      return await persistirBaixa({ userId, msg, texto, recebidaEm, session, sessao, deps });
    }
    // Qualquer outra coisa = nova tentativa de data ou cancelamento implícito.
    const novaData = parseDataPagamento(texto);
    if (novaData) {
      session.dataPagamento = novaData;
      if (isFutureISO(novaData)) {
        const resposta = askFutureConfirm(novaData);
        await deps.atualizarSessao(
          sessao.id,
          "conta_pagamento_aguardando_data",
          session as never,
          resposta,
        );
        return { status: "pendente", resposta };
      }
      // Data válida não-futura: volta para confirmação normal.
      const conta = session.contaId ? await buscarContaPorId(userId, session.contaId) : null;
      if (!conta) {
        await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
        const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
        await deps.gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "sem_pendencia",
          session as never,
          resposta,
        );
        logEvent("already_updated", 0, "conflict");
        return { status: "consulta", resposta };
      }
      const resposta = previewSingle(conta, novaData);
      await deps.atualizarSessao(
        sessao.id,
        "conta_pagamento_aguardando_confirmacao",
        session as never,
        resposta,
      );
      return { status: "pendente", resposta };
    }
    const resposta = 'Não entendi. Responda "sim" para confirmar a data futura ou "cancelar".';
    await deps.atualizarSessao(
      sessao.id,
      "conta_pagamento_aguardando_data",
      session as never,
      resposta,
    );
    return { status: "pendente", resposta };
  }

  // ---- confirmação ----
  if (sessao.status === "conta_pagamento_aguardando_confirmacao") {
    // Ajuste de data antes da confirmação tem prioridade.
    const novaData = parseDataPagamento(texto);
    if (novaData && decisao !== "confirm") {
      session.dataPagamento = novaData;
      if (isFutureISO(novaData)) {
        const resposta = askFutureConfirm(novaData);
        await deps.atualizarSessao(
          sessao.id,
          "conta_pagamento_aguardando_data",
          session as never,
          resposta,
        );
        return { status: "pendente", resposta };
      }
      const conta = session.contaId ? await buscarContaPorId(userId, session.contaId) : null;
      if (!conta) {
        await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
        const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
        await deps.gravarSessao(
          userId,
          msg.telefone,
          msg.external_id,
          texto,
          recebidaEm,
          "sem_pendencia",
          session as never,
          resposta,
        );
        logEvent("already_updated", 0, "conflict");
        return { status: "consulta", resposta };
      }
      const resposta = previewSingle(conta, novaData);
      await deps.atualizarSessao(
        sessao.id,
        "conta_pagamento_aguardando_confirmacao",
        session as never,
        resposta,
      );
      return { status: "pendente", resposta };
    }
    if (decisao === "confirm") {
      return await persistirBaixa({ userId, msg, texto, recebidaEm, session, sessao, deps });
    }
    const resposta =
      'Não entendi. Responda "sim" para confirmar, informe outra data ou "cancelar".';
    await deps.atualizarSessao(
      sessao.id,
      "conta_pagamento_aguardando_confirmacao",
      session as never,
      resposta,
    );
    return { status: "pendente", resposta };
  }

  return { status: "sem_pendencia", resposta: "" };
}

// ---------- persistência ----------

// Exportado a partir do WA-C11 3B.2.C.1 Block 4 para permitir testes
// direcionados do quota gate financeiro sem simular todo o fluxo do
// handler `processarBaixaConta`. Continua sendo chamado apenas pelo
// próprio módulo em produção.
export async function persistirBaixa(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: BaixaContaSession;
  sessao: { id: string; status: string; session: unknown; recebida_em: string };
  deps: WhatsAppBaixaContaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  if (!session.contaId || !session.dataPagamento) {
    logEvent("failed", 0, "error");
    return { status: "erro", resposta: "Não consegui identificar a conta. Pode começar de novo?" };
  }

  // WA-C11 3B.2.C.1 Block 4 — fail-closed sem `external_id`: idempotência
  // da quota depende dele. Não abre RPC, não altera conta. Log sanitizado.
  const externalMessageId = msg.external_id ?? null;
  if (!externalMessageId || externalMessageId.trim().length === 0) {
    console.error("[whatsapp] persistirBaixa missing externalMessageId");
    logEvent("failed", 0, "error");
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }

  // WA-C11 3B.2.C.1 Block 4 — quota financeira ANTES da RPC de baixa.
  // A RPC `whatsapp_baixa_conta_atomic` já é idempotente (noop quando
  // conta já paga com gasto vinculado); usamos `session.contaId` como
  // discriminador determinístico da idempotency key financeira.
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId,
    actionType: "bill_payment",
    discriminator: session.contaId,
  });
  if (!gateOutcome.allowed) {
    logEvent("failed", 0, "error");
    return { status: "erro", resposta: financialQuotaBlockedReply(gateOutcome) };
  }

  // WA-3.30 — baixa ATÔMICA via RPC public.whatsapp_baixa_conta_atomic.
  // Na mesma transação: cria gasto correspondente + marca conta como pago
  // + grava contas_a_pagar.gasto_id. Se qualquer passo falhar, tudo é
  // desfeito. Idempotência:
  //   - conta já paga com gasto_id válido => 'noop' (sem novo gasto)
  //   - conta paga sem gasto_id => 'inconsistent' (erro controlado, não
  //     cria gasto silenciosamente)
  //   - conta ainda pendente => 'paid' (gasto criado + vínculo)
  //   - conta não localizada => 'not_found'
  const { data: rpcData, error } = await supabaseAdmin.rpc("whatsapp_baixa_conta_atomic", {
    p_user_id: userId,
    p_conta_id: session.contaId,
    p_data_pagamento: session.dataPagamento,
    p_origem: "whatsapp",
  });

  if (error) {
    logEvent("failed", 0, "error");
    await deps.atualizarSessao(
      sessao.id,
      "conta_pagamento_aguardando_confirmacao",
      session as never,
      "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    );
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const rpcResult = String(row?.result ?? "");
  const gastoIdRet = row?.gasto_id as string | null | undefined;

  if (rpcResult === "not_found" || rpcResult === "not_pending") {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "sem_pendencia",
      session as never,
      resposta,
    );
    logEvent("already_updated", 0, "conflict");
    return { status: "consulta", resposta };
  }

  if (rpcResult === "inconsistent") {
    // Conta marcada como paga sem gasto vinculado — não criamos gasto
    // silenciosamente. Requer remediação manual.
    logEvent("failed", 0, "inconsistent");
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    const resposta =
      "Encontrei uma inconsistência nessa conta (já paga mas sem gasto vinculado). " +
      "Peça para revisarem manualmente.";
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "sem_pendencia",
      session as never,
      resposta,
    );
    return { status: "erro", resposta };
  }

  if (rpcResult === "noop") {
    // Já paga com vínculo válido — idempotente, não cria novo gasto.
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
    const finalSession = { ...session, status: "salva", gastoId: gastoIdRet ?? null } as unknown;
    await deps.atualizarSessao(sessao.id, "salva", finalSession as never, "ok");
    const resposta = "Essa conta já estava paga com o gasto registrado. Sem alteração.";
    logEvent("noop", 0, "ok");
    return { status: "salva", resposta };
  }

  if (rpcResult !== "paid") {
    logEvent("failed", 0, "error");
    return {
      status: "erro",
      resposta: "Não consegui concluir a baixa. Pode tentar de novo daqui a pouco?",
    };
  }

  // Readback obrigatório: confirmar que conta.gasto_id foi gravado e que o
  // gasto existe antes de finalizar a sessão.
  const { data: readback, error: readbackErr } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("id, nome, valor, data_pagamento, status, gasto_id")
    .eq("id", session.contaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    readbackErr ||
    !readback ||
    readback.status !== "pago" ||
    !readback.gasto_id ||
    readback.gasto_id !== gastoIdRet
  ) {
    logEvent("failed", 0, "readback_failed");
    return {
      status: "erro",
      resposta: "Não consegui confirmar a baixa. Pode tentar de novo daqui a pouco?",
    };
  }
  const data = readback;

  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
  const finalSession = { ...session, status: "salva" } as unknown;
  await deps.atualizarSessao(sessao.id, "salva", finalSession as never, "ok");

  // WA-C9.1 — cancela lembretes pendentes daquela conta (best-effort, nunca
  // bloqueia a baixa). Reusa `cancelByEntity` via helper centralizado.
  try {
    const { cancelarLembretesDaConta } = await import("./whatsapp-contas-lembretes.server");
    const { clearLembreteConta } = await import("./whatsapp-short-context.server");
    const n = await cancelarLembretesDaConta(userId, session.contaId);
    clearLembreteConta(msg.telefone);
    if (n > 0) logEvent("reminders_cancelled", n > 5 ? 6 : n, "ok");
  } catch {
    // silencioso: lembretes são auxiliares; baixa já está persistida.
  }

  const nome = String(data.nome ?? "").trim() || "Conta";
  const valor = Number(data.valor ?? 0) || 0;
  const resposta = [
    "Pronto! Marquei como paga ✅",
    "",
    `${nome} — ${fmtBRL(valor)}`,
    `Pagamento: ${fmtDateBR(session.dataPagamento)}.`,
  ].join("\n");
  logEvent("paid", 1, "ok");
  return { status: "salva", resposta };
}
