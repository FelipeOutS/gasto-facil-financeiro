/**
 * WA-C4 — EDITAR, ADIAR e CANCELAR contas a pagar via WhatsApp.
 *
 * Reconhece, em mensagens SEM valor monetário no caso de cancelamento e
 * SEM tokens de fatura/cartão, frases como:
 *   "mudar o vencimento da internet para dia 10"
 *   "adiar aluguel para 15/07"
 *   "o valor da academia agora é 99,90"
 *   "alterar categoria da conta de luz para Moradia"
 *   "renomear seguro para Seguro do Carro"
 *   "cancelar a academia" / "excluir internet" / "remover conta de luz"
 *
 * Garantias estritas (definidas no plano WA-C4):
 *   - Edita apenas `contas_a_pagar` com `user_id = authorizedUserId` e
 *     `status = 'pendente'` (conta paga é intocável, conta cancelada não
 *     pode ser baixada — herdamos isso do filtro `status='pendente'` que
 *     todos os helpers WA-C1/WA-C3 já aplicam).
 *   - Cancelamento NÃO remove a linha: apenas grava `status='cancelado'`,
 *     preservando histórico no banco. WA-C1 e WA-C3 já filtram
 *     `status='pendente'`, portanto cancelada deixa de aparecer
 *     automaticamente como pendente/atrasada e não pode receber baixa.
 *   - Recorrência: ao detectar `recorrencia_id`, pergunta escopo
 *     (Somente esta / Esta e as próximas pendentes). Nunca altera todas
 *     as ocorrências sem confirmação. Bulk atômico via UPDATE com
 *     `recorrencia_id = X AND status='pendente' AND data_vencimento >= ref`.
 *   - Cada confirmação atravessa um claim atômico (estado
 *     `conta_edicao_persistindo` na sessão) + readback antes de
 *     responder. Reentrega/concorrência: o `external_id` único da
 *     mensagem de confirmação bloqueia segunda execução.
 *   - Sessão guarda apenas dados mínimos (vide `EdicaoContaSession`).
 *   - Logs: `event=wa_payable_account_edit` com `stage`, `operation`,
 *     `candidatesCount`, `affectedCountBucket`, `result`. Sem nome,
 *     valor, data, categoria, contaId, userId, telefone, texto.
 */
import * as _supa from "@/integrations/supabase/client.server";
import type { WhatsAppMessageRow, ProcessOutcome } from "./whatsapp.server";
import {
  findVencimentoByTerm,
  todayISOInAppTz,
  type ContaVencimentoRow,
} from "./contas-vencimento.server";
import { nowInAppTz } from "./cartao-fatura.server";
import type {
  CategoriaPickerState,
  CategoriaPickerRow,
} from "./whatsapp-comprovantes.server";

// Live-binding para permitir mock.module() em testes (padrão WA-C3/WA-F3).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, {
  get: (_t, prop) => (_supa.supabaseAdmin as never)[prop as never],
});

// ---------- tipos / estados ----------

export type EdicaoOperation =
  | "due_date" | "amount" | "category" | "name" | "cancel";
export type RecurrenceScope = "single" | "future_pending";

export type EdicaoContaSession = {
  kind: "edicao_conta" | "cancelamento_conta";
  contaId: string | null;
  candidateContaIds: string[] | null;
  operation: EdicaoOperation | null;
  newDueDate: string | null;
  newAmountCentavos: number | null;
  newCategoryId: string | null;
  newCategoryLabel?: string | null;
  newName: string | null;
  recurrenceScope: RecurrenceScope | null;
  // contexto da conta selecionada para a prévia (não persiste em logs).
  contaNome?: string;
  contaVencimento?: string;
  contaValor?: number;
  recorrenciaId?: string | null;
  // sinaliza confirmação extra para data passada.
  awaitingPastDateConfirm?: boolean;
  // sinaliza confirmação extra para data passada.
  awaitingFutureDateConfirm?: boolean;
  // estado de paginação do picker de categoria.
  categoriaOptions?: CategoriaPickerState;
};

export const EDICAO_CONTA_PENDING_STATES = [
  "conta_edicao_aguardando_escolha",
  "conta_edicao_aguardando_campo",
  "conta_edicao_aguardando_valor",
  "conta_edicao_aguardando_vencimento",
  "conta_edicao_aguardando_categoria",
  "conta_edicao_aguardando_nome",
  "conta_edicao_aguardando_escopo_recorrencia",
  "conta_edicao_aguardando_confirmacao",
  "conta_cancelamento_aguardando_confirmacao",
  "conta_edicao_persistindo",
] as const;

export type EdicaoContaStatus = (typeof EDICAO_CONTA_PENDING_STATES)[number];

export function isEdicaoContaSession(s: unknown): s is EdicaoContaSession {
  if (!s || typeof s !== "object") return false;
  const k = (s as { kind?: unknown }).kind;
  return k === "edicao_conta" || k === "cancelamento_conta";
}

// ---------- DI seam ----------

export type WhatsAppEdicaoContaDeps = {
  gravarSessao: (
    userId: string, telefone: string, externalId: string | null,
    texto: string, recebidaEm: string, status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any, resposta: string, gastoId?: string,
  ) => Promise<{ ok: boolean; sessionId: string | null; status: string | null; errorCode: string | null }>;
  atualizarSessao: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: string, status: string, session: any, resposta: string, gastoId?: string,
  ) => Promise<unknown>;
  fecharSessoesAnteriores: (
    userId: string, telefone: string,
    motivo: "salva" | "cancelada" | "expirada", gastoId?: string,
  ) => Promise<void>;
  loadCategoriasParaPicker: (userId: string) => Promise<CategoriaPickerRow[]>;
  buildCategoriaListBody: (args: {
    userId: string;
    holder: { descricao?: string | null; categoriaSugerida?: string | null };
    cats: CategoriaPickerRow[];
  }) => Promise<{ body: string; options: CategoriaPickerState }>;
  resolveCategoriaPickerInput: (args: {
    userId: string;
    holder: {
      descricao?: string | null;
      categoriaSugerida?: string | null;
      categoriaOptions?: CategoriaPickerState;
    };
    cats: CategoriaPickerRow[];
    texto: string;
  }) => Promise<
    | { kind: "picked"; cat: CategoriaPickerRow }
    | { kind: "relist"; options: CategoriaPickerState; body: string }
    | { kind: "invalid" }
  >;
  detectCategoriaCommand: (texto: string) => { kind: "ask" } | { kind: "direct"; termo: string } | null;
};

// ---------- log seguro ----------

type Stage =
  | "detected" | "account_found" | "awaiting_choice"
  | "awaiting_scope" | "awaiting_confirmation"
  | "updated" | "cancelled" | "conflict" | "failed";
type Result = "ok" | "not_found" | "ambiguous" | "conflict" | "error";

function affectedBucket(n: number): "one" | "few" | "many" | null {
  if (n <= 0) return null;
  if (n === 1) return "one";
  if (n <= 5) return "few";
  return "many";
}

function logEvent(
  stage: Stage, operation: EdicaoOperation | null,
  candidatesCount: number, affected: number | null, result: Result,
) {
  console.info({
    event: "wa_payable_account_edit",
    stage,
    operation,
    candidatesCount,
    affectedCountBucket: affected == null ? null : affectedBucket(affected),
    result,
  });
}

// ---------- normalização ----------

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!;:"']+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function hasMonetaryValue(textRaw: string): boolean {
  const t = textRaw.toLowerCase();
  if (/r\$\s*\d/.test(t)) return true;
  if (/\b\d+[.,]\d{2}\b/.test(t)) return true;
  if (/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/.test(t)) return true;
  if (/\b\d+\s*(?:reais|real|mil)\b/.test(t)) return true;
  return false;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`;
}

// ---------- detector ----------

export type EdicaoIntent = {
  operation: EdicaoOperation;
  termo: string;
  dateText?: string | null;
  amountText?: string | null;
  newCategoryName?: string | null;
  newName?: string | null;
};

const ARTIGOS_INICIAIS = /^(?:a|o|as|os|minha|meu|essa|esse|uma|um|da|do|de|na|no|conta|contas)\s+/;
function stripLeadingArticles(s: string): string {
  let v = s.trim();
  while (ARTIGOS_INICIAIS.test(v)) v = v.replace(ARTIGOS_INICIAIS, "");
  return v.trim();
}

// extrai uma expressão de data e devolve { dateText, rest } com o restante
// da frase sem essa expressão. Reusa o mesmo conjunto de WA-C3.1.
function extractDate(t: string): { dateText: string | null; rest: string } {
  const patterns: RegExp[] = [
    /\b(?:em|para|pro|pra|no)?\s*\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{2,4})?\b/,
    /\b(?:em|para|pro|pra|no|na)?\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    /\b(?:no\s+|para\s+o\s+|pro\s+|pra\s+o\s+)?dia\s+\d{1,2}(?:\s+do\s+mes\s+que\s+vem)?\b/,
    /\bamanha\b/, /\bhoje\b/, /\bontem\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return { dateText: m[0].trim(), rest: t.replace(re, " ").replace(/\s+/g, " ").trim() };
  }
  return { dateText: null, rest: t };
}

// parser de data novo (mesmo vocabulário de WA-C3.1).
const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
function parseDate(text: string, hoje: Date = nowInAppTz()): string | null {
  const t = norm(text);
  if (!t) return null;
  if (/\bhoje\b/.test(t)) return todayISOInAppTz(hoje);
  if (/\bontem\b/.test(t)) {
    const d = new Date(hoje); d.setDate(d.getDate() - 1); return todayISOInAppTz(d);
  }
  if (/\bamanha\b/.test(t)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1); return todayISOInAppTz(d);
  }
  let m = t.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{2,4}))?\b/);
  if (m) {
    const dia = +m[1]; const mes = MESES[m[2]];
    if (mes && dia >= 1 && dia <= 31) {
      let ano = m[3] ? +m[3] : hoje.getFullYear();
      if (ano < 100) ano = 2000 + ano;
      const last = new Date(ano, mes, 0).getDate();
      return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, last)).padStart(2, "0")}`;
    }
  }
  m = t.match(/\bdia\s+(\d{1,2})\s+do\s+mes\s+que\s+vem\b/);
  if (m) {
    const dia = +m[1];
    if (dia >= 1 && dia <= 31) {
      const next = new Date(hoje); next.setDate(1); next.setMonth(next.getMonth() + 1);
      const y = next.getFullYear(); const mm = next.getMonth() + 1;
      const last = new Date(y, mm, 0).getDate();
      return `${y}-${String(mm).padStart(2, "0")}-${String(Math.min(dia, last)).padStart(2, "0")}`;
    }
  }
  m = t.match(/\bdia\s+(\d{1,2})\b/);
  if (m) {
    const dia = +m[1];
    if (dia >= 1 && dia <= 31) {
      const y = hoje.getFullYear(); const mm = hoje.getMonth() + 1;
      const last = new Date(y, mm, 0).getDate();
      return `${y}-${String(mm).padStart(2, "0")}-${String(Math.min(dia, last)).padStart(2, "0")}`;
    }
  }
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const dia = +m[1]; const mes = +m[2];
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = m[3] ? +m[3] : hoje.getFullYear();
      if (ano < 100) ano = 2000 + ano;
      const last = new Date(ano, mes, 0).getDate();
      return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, last)).padStart(2, "0")}`;
    }
  }
  return null;
}

// parser de valor (formato brasileiro: 99,90 / 1.250 / 1.250,50 / R$ 1.250,50).
// IGNORA tokens como "dia 10", "3 parcelas", "cartão final 42".
function parseAmountToCentavos(textRaw: string): number | null {
  let t = textRaw.toLowerCase();
  // remove tokens irrelevantes ANTES (datas, parcelas, finais de cartão).
  t = t.replace(/\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{2,4})?\b/g, " ")
       .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
       .replace(/\bdia\s+\d{1,2}\b/g, " ")
       .replace(/\b\d+\s*x\b/g, " ")
       .replace(/\b\d+\s*(?:parcelas?|vezes?)\b/g, " ")
       .replace(/\bfinal\s+\d{2,4}\b/g, " ")
       .replace(/\bcartao\s+\d+\b/g, " ");
  // Padrões com vírgula decimal ou separador de milhar.
  const reFull = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+(?:\.\d{3})+|\d+)\s*(reais|real|mil)?/g;
  let best = -1;
  let m: RegExpExecArray | null;
  while ((m = reFull.exec(t)) !== null) {
    const raw = m[2];
    const unit = m[3] ?? "";
    let n: number;
    if (raw.includes(",")) {
      n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    } else if (/\.\d{3}/.test(raw)) {
      n = parseFloat(raw.replace(/\./g, ""));
    } else {
      n = parseFloat(raw);
    }
    if (isNaN(n)) continue;
    if (unit === "mil") n *= 1000;
    // ignora números de 1-2 dígitos sem qualquer marcador R$/reais/decimal — possivelmente "dia".
    const hasMarker = !!m[1] || unit !== "" || raw.includes(",") || /\.\d{3}/.test(raw);
    if (!hasMarker && n < 100) continue;
    if (n > 0 && n > best) best = n;
  }
  if (best <= 0) return null;
  return Math.round(best * 100);
}

const ACCOUNT_TERM_BLOCKLIST = new Set(["fatura", "cartao", "cartão"]);
function hasBlocklistedTerm(t: string): boolean {
  const tn = ` ${norm(t)} `;
  for (const w of ACCOUNT_TERM_BLOCKLIST) {
    if (tn.includes(` ${w} `)) return true;
  }
  return false;
}

/** Extrai a intenção de edição (sem casar contas). Retorna null se não bate. */
export function detectEdicaoContaIntent(textRaw: string): EdicaoIntent | null {
  if (!textRaw || !textRaw.trim()) return null;
  if (hasBlocklistedTerm(textRaw)) return null;
  const t = norm(textRaw);

  // Cancelar / Excluir / Remover — não permite valor monetário (evita "cancelar 50").
  let m = t.match(/^(?:cancelar|excluir|remover|apagar)\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    if (!termo) return null;
    // remove sufixos como "de julho" — preservamos para busca incluir.
    return { operation: "cancel", termo };
  }

  // Renomear ... para NOME
  m = t.match(/^(?:renomear|mudar\s+(?:o\s+)?nome\s+(?:da|do|de)|alterar\s+(?:o\s+)?nome\s+(?:da|do|de))\s+(.+?)\s+para\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const novoNome = textRaw
      .toLowerCase()
      .replace(/^\s*(?:renomear|mudar\s+(?:o\s+)?nome\s+(?:da|do|de)|alterar\s+(?:o\s+)?nome\s+(?:da|do|de))\s+.+?\s+para\s+/i, "")
      .trim();
    // Restaura caixa original do trecho após "para".
    const idx = textRaw.toLowerCase().lastIndexOf(" para ");
    const newNameOriginal = idx >= 0 ? textRaw.slice(idx + 6).trim() : novoNome;
    if (!termo || !newNameOriginal || !validateNewName(newNameOriginal)) return null;
    return { operation: "name", termo, newName: newNameOriginal };
  }

  // Categoria
  m = t.match(/^(?:alterar|mudar|trocar|atualizar|colocar|coloca|coloque|muda|altera)\s+(?:a\s+)?categoria\s+(?:da|do|de)\s+(.+?)(?:\s+para\s+(.+))?$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const cat = m[2] ? m[2].trim() : null;
    if (!termo) return null;
    return { operation: "category", termo, newCategoryName: cat };
  }
  // "X em <categoria>" / "X muda categoria para <categoria>"
  m = t.match(/^(?:coloca|coloque|colocar|por)\s+(.+?)\s+(?:em|na|no)\s+(.+)$/);
  if (m && /^categoria/.test(m[1]) === false) {
    // Heurística leve: descarta para evitar falsos positivos.
  }

  // Valor: "o valor da X agora é V" / "mudar X para V (reais)" / "X agora custa V"
  m = t.match(/^(?:o\s+)?valor\s+(?:da|do|de)\s+(.+?)\s+(?:agora\s+)?(?:e|eh|é|fica|sera|será|passa\s+a\s+ser)\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const amountText = m[2];
    if (!termo) return null;
    if (!parseAmountToCentavos(amountText)) return null;
    return { operation: "amount", termo, amountText };
  }
  m = textRaw.match(/^(?:mudar|alterar|atualizar|trocar)\s+(?:o\s+valor\s+(?:da|do|de)\s+)?(.+?)\s+para\s+(.+)$/i);
  if (m) {
    const termoRaw = m[1];
    const tail = m[2];
    // descarta se a cauda parece data (sem valor monetário).
    const cents = parseAmountToCentavos(tail);
    if (cents) {
      const termo = stripLeadingArticles(norm(termoRaw));
      if (termo) return { operation: "amount", termo, amountText: tail };
    }
  }
  m = t.match(/^(.+?)\s+agora\s+custa\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const amountText = m[2];
    if (termo && parseAmountToCentavos(amountText)) {
      return { operation: "amount", termo, amountText };
    }
  }

  // Vencimento: "mudar o vencimento da X para DATA", "adiar X para DATA",
  // "antecipar X para DATA", "X vence agora DATA"
  m = t.match(/^(?:mudar|alterar|atualizar|trocar|ajustar)\s+(?:o\s+)?vencimento\s+(?:da|do|de)\s+(.+?)\s+para\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const { dateText } = extractDate(norm(m[2]));
    if (termo && dateText) return { operation: "due_date", termo, dateText };
  }
  m = t.match(/^(?:adiar|postergar|antecipar)\s+(.+?)\s+para\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const { dateText } = extractDate(norm(m[2]));
    if (termo && dateText) return { operation: "due_date", termo, dateText };
  }
  m = t.match(/^(.+?)\s+vence\s+agora\s+(.+)$/);
  if (m) {
    const termo = stripLeadingArticles(m[1]);
    const { dateText } = extractDate(norm(m[2]));
    if (termo && dateText) return { operation: "due_date", termo, dateText };
  }

  return null;
}

function validateNewName(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  // não pode ser somente pontuação/dígitos/data.
  if (/^[\s\d/\-.,:]+$/.test(trimmed)) return false;
  return true;
}

// ---------- helpers de busca / persistência ----------

function termoSemSufixoMes(termo: string): string {
  // Remove cauda "de janeiro", "de fevereiro" etc., comum em "excluir internet de julho".
  return termo.replace(
    /\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*$/i,
    "",
  ).trim();
}

async function buscarContaPorId(userId: string, contaId: string): Promise<ContaVencimentoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("id,nome,valor,data_vencimento,status,data_pagamento,categoria_id,recorrente,frequencia_recorrencia,recorrencia_id")
    .eq("user_id", userId).eq("id", contaId).maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    nome: String(data.nome ?? ""),
    valor: Number(data.valor ?? 0) || 0,
    dataVencimento: String(data.data_vencimento ?? ""),
    status: (String(data.status ?? "pendente") === "pago" ? "pago" : "pendente"),
    dataPagamento: data.data_pagamento ?? null,
    categoriaId: data.categoria_id ?? null,
    recorrente: Boolean(data.recorrente ?? false),
    frequenciaRecorrencia: data.frequencia_recorrencia ?? null,
  };
}

async function getRecorrenciaIdDaConta(contaId: string, userId: string): Promise<string | null> {
  // Defesa em profundidade: além do contaId já validado upstream, escopamos
  // explicitamente por user_id para impedir qualquer leitura cruzada caso a
  // função venha a ser invocada em outro contexto.
  const { data } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("recorrencia_id")
    .eq("id", contaId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.recorrencia_id as string | null) ?? null;
}

// ---------- preview / mensagens ----------

function previewSingle(op: EdicaoOperation, conta: ContaVencimentoRow, sess: EdicaoContaSession, scope?: RecurrenceScope): string {
  const head = "Confere pra mim? 👀";
  const linhas: string[] = [head, "", `• Conta: ${conta.nome}`];
  if (op === "due_date") {
    linhas.push(`• Vencimento atual: ${fmtDateBR(conta.dataVencimento)}`);
    linhas.push(`• Novo vencimento: ${sess.newDueDate ? fmtDateBR(sess.newDueDate) : "—"}`);
  } else if (op === "amount") {
    linhas.push(`• Valor atual: ${fmtBRL(conta.valor)}`);
    linhas.push(`• Novo valor: ${sess.newAmountCentavos ? fmtBRL(sess.newAmountCentavos / 100) : "—"}`);
  } else if (op === "category") {
    linhas.push(`• Nova categoria: ${sess.newCategoryLabel ?? "—"}`);
  } else if (op === "name") {
    linhas.push(`• Nome atual: ${conta.nome}`);
    linhas.push(`• Novo nome: ${sess.newName ?? "—"}`);
  }
  if (scope) {
    linhas.push(`• Escopo: ${scope === "single" ? "somente esta conta" : "esta conta e as próximas pendentes"}`);
    if (scope === "future_pending") linhas.push("");
    if (scope === "future_pending") linhas.push("Contas já pagas não serão alteradas.");
  }
  linhas.push("");
  linhas.push('Responda "sim" para confirmar ou "cancelar" para desistir.');
  return linhas.join("\n");
}

function previewCancelamento(conta: ContaVencimentoRow, scope?: RecurrenceScope): string {
  const linhas = [
    "Confirma o cancelamento desta conta?",
    "",
    `• ${conta.nome}`,
    `• Vencimento: ${fmtDateBR(conta.dataVencimento)}`,
  ];
  if (scope) {
    linhas.push(`• Escopo: ${scope === "single" ? "somente esta conta" : "esta conta e as próximas pendentes"}`);
  }
  linhas.push("");
  linhas.push("A conta deixará de aparecer como pendente.");
  linhas.push("");
  linhas.push('Responda "sim" para confirmar ou "cancelar" para desistir.');
  return linhas.join("\n");
}

function askRecurrenceScope(): string {
  return [
    "Essa conta faz parte de uma recorrência.",
    "",
    "O que deseja alterar?",
    "1. Somente esta conta",
    "2. Esta e as próximas contas pendentes",
    "",
    'Responda "1", "2" ou "cancelar".',
  ].join("\n");
}

function ambiguousList(rows: ContaVencimentoRow[], termo: string, op: EdicaoOperation): string {
  const verbo = op === "cancel" ? "cancelar" : "alterar";
  const linhas = rows.slice(0, 5).map((r, i) =>
    `${i + 1}. ${r.nome} — vencimento ${fmtDateBR(r.dataVencimento)}`,
  ).join("\n");
  return [
    `Encontrei mais de uma conta pendente de ${termo}.`,
    "",
    `Escolha qual deseja ${verbo}:`,
    linhas,
    "",
    'Responda com o número ou "cancelar".',
  ].join("\n");
}

function askFutureDateConfirm(iso: string): string {
  return [
    `A data ${fmtDateBR(iso)} ainda não chegou.`,
    "",
    'Confirma o novo vencimento mesmo assim? Responda "sim" ou "cancelar".',
  ].join("\n");
}

function askPastDateConfirm(iso: string): string {
  return [
    `A data ${fmtDateBR(iso)} já passou.`,
    "",
    'Confirma o novo vencimento mesmo assim? Responda "sim" ou "cancelar".',
  ].join("\n");
}

function statusPagaResposta(): string {
  return "Essa conta já está marcada como paga e não pode ser alterada por aqui.";
}

// ---------- persistência ----------

async function applyUpdate(
  userId: string, sess: EdicaoContaSession,
): Promise<{ ok: boolean; affected: number; error?: string }> {
  const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
  if (!conta) return { ok: false, affected: 0, error: "not_found" };
  if (conta.status === "pago") return { ok: false, affected: 0, error: "already_paid" };

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (sess.operation === "due_date" && sess.newDueDate) {
    payload.data_vencimento = sess.newDueDate;
    const [y, mm] = sess.newDueDate.split("-"); payload.mes = +mm; payload.ano = +y;
  } else if (sess.operation === "amount" && sess.newAmountCentavos) {
    payload.valor = sess.newAmountCentavos / 100;
  } else if (sess.operation === "category" && sess.newCategoryId) {
    payload.categoria_id = sess.newCategoryId;
  } else if (sess.operation === "name" && sess.newName) {
    payload.nome = sess.newName;
  } else if (sess.kind === "cancelamento_conta") {
    payload.status = "cancelado";
  } else {
    return { ok: false, affected: 0, error: "invalid_state" };
  }

  // ESCOPO ÚNICO — update condicional na linha selecionada.
  if (sess.recurrenceScope !== "future_pending") {
    const q = supabaseAdmin
      .from("contas_a_pagar")
      .update(payload)
      .eq("id", sess.contaId)
      .eq("user_id", userId)
      .eq("status", "pendente")
      .select("id");
    const { data, error } = await q;
    if (error) return { ok: false, affected: 0, error: "db_error" };
    const arr = Array.isArray(data) ? data : data ? [data] : [];
    return { ok: arr.length > 0, affected: arr.length };
  }

  // ESCOPO FUTURO — bulk atômico por recorrencia_id, status='pendente',
  // data_vencimento >= data da conta selecionada.
  if (!sess.recorrenciaId || !sess.contaVencimento) {
    return { ok: false, affected: 0, error: "invalid_state" };
  }
  // Nome/cancelamento aplicam a todas; vencimento/valor/categoria também.
  const q = supabaseAdmin
    .from("contas_a_pagar")
    .update(payload)
    .eq("user_id", userId)
    .eq("recorrencia_id", sess.recorrenciaId)
    .eq("status", "pendente")
    .gte("data_vencimento", sess.contaVencimento)
    .select("id");
  const { data, error } = await q;
  if (error) return { ok: false, affected: 0, error: "db_error" };
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  return { ok: arr.length > 0, affected: arr.length };
}

// ---------- handler principal ----------

export async function processarEdicaoConta(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string } | null;
  deps: WhatsAppEdicaoContaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const isHardCancel =
    /\b(cancelar|cancela|cancelado|cancelada)\b/i.test(texto) && decisao !== "confirm";
  const sess = (sessao?.session ?? null) as EdicaoContaSession | null;
  const status = sessao?.status ?? null;

  // Cancelamento em qualquer estado de edição (palavra "cancelar" enquanto
  // o usuário estava editando — diferente do cancelar conta, que vem
  // como nova intenção via detector).
  if (sessao && sess && status && isHardCancel && status !== "conta_cancelamento_aguardando_confirmacao") {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    const resposta = "Tudo bem, não alterei nada.";
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada", sess as never, resposta,
    );
    logEvent("cancelled", sess.operation, 0, null, "ok");
    return { status: "cancelada", resposta };
  }

  // ============ Sem sessão: NOVA INTENÇÃO ============
  if (!sessao) {
    const intent = detectEdicaoContaIntent(texto);
    if (!intent) return { status: "sem_pendencia", resposta: "" };
    logEvent("detected", intent.operation, 0, null, "ok");

    const termoBusca = termoSemSufixoMes(intent.termo);
    const rows = await findVencimentoByTerm(userId, termoBusca);
    if (rows.length === 0) {
      logEvent("account_found", intent.operation, 0, null, "not_found");
      return {
        status: "consulta",
        resposta:
          "Não encontrei uma conta pendente com esse nome.\n\n" +
          'Você pode consultar suas contas com "o que vence esta semana?".',
      };
    }
    if (rows.length > 1) {
      const session: EdicaoContaSession = {
        kind: intent.operation === "cancel" ? "cancelamento_conta" : "edicao_conta",
        contaId: null,
        candidateContaIds: rows.slice(0, 5).map((r) => r.id),
        operation: intent.operation,
        newDueDate: intent.dateText ? parseDate(intent.dateText) : null,
        newAmountCentavos: intent.amountText ? parseAmountToCentavos(intent.amountText) : null,
        newCategoryId: null,
        newCategoryLabel: intent.newCategoryName ?? null,
        newName: intent.newName ?? null,
        recurrenceScope: null,
      };
      const resposta = ambiguousList(rows, intent.termo, intent.operation);
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_escolha", session as never, resposta,
      );
      logEvent("awaiting_choice", intent.operation, rows.length, null, "ambiguous");
      return { status: "pendente", resposta };
    }

    // 1 candidata: monta sessão e segue para próximo passo (escopo se recorrente, ou prévia/categoria).
    return await avancarApos1Candidata(userId, msg, texto, recebidaEm, rows[0], intent, deps);
  }

  // ============ COM SESSÃO ATIVA ============
  if (!sess) return { status: "sem_pendencia", resposta: "" };

  // Escolha numérica entre candidatos.
  if (status === "conta_edicao_aguardando_escolha") {
    const idx = parseInt(texto.trim(), 10);
    if (!isFinite(idx) || idx < 1 || idx > (sess.candidateContaIds?.length ?? 0)) {
      const resposta = 'Não entendi. Responda com o número da conta ou "cancelar".';
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_escolha", sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const chosenId = sess.candidateContaIds![idx - 1];
    const conta = await buscarContaPorId(userId, chosenId);
    if (!conta) {
      logEvent("failed", sess.operation, 0, null, "not_found");
      const resposta = "Conta não encontrada.";
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "cancelada", sess as never, resposta,
      );
      return { status: "consulta", resposta };
    }
    if (conta.status === "pago") {
      logEvent("failed", sess.operation, 1, null, "conflict");
      const resposta = statusPagaResposta();
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "cancelada", sess as never, resposta,
      );
      return { status: "consulta", resposta };
    }
    const intent: EdicaoIntent = {
      operation: sess.operation!, termo: conta.nome,
      dateText: null, amountText: null,
      newCategoryName: sess.newCategoryLabel ?? null,
      newName: sess.newName ?? null,
    };
    // Hidrata sess com a conta escolhida e segue.
    return await avancarApos1Candidata(userId, msg, texto, recebidaEm, conta, intent, deps, sess);
  }

  // Escolha do escopo de recorrência.
  if (status === "conta_edicao_aguardando_escopo_recorrencia") {
    const t = texto.trim().toLowerCase();
    let scope: RecurrenceScope | null = null;
    if (t === "1" || /\bsomente\b/.test(t) || /\besta\s+conta\b/.test(t) || /\bsó\s+esta\b/.test(t)) {
      scope = "single";
    } else if (t === "2" || /\bproxim/.test(t) || /\bfutur/.test(t) || /\bdemais\b/.test(t)) {
      scope = "future_pending";
    }
    if (!scope) {
      const resposta = 'Responda com "1" para somente esta conta, "2" para esta e as próximas pendentes, ou "cancelar".';
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_escopo_recorrencia", sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
    if (!conta) {
      return await failOut(userId, msg, texto, recebidaEm, deps, sess);
    }
    return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, { ...sess, recurrenceScope: scope }, deps);
  }

  // Coleta de novos valores (faltavam no comando original).
  if (status === "conta_edicao_aguardando_vencimento") {
    const novo = parseDate(texto);
    if (!novo) {
      const resposta = 'Não entendi a data. Tente "dia 10", "15/07" ou "ontem".';
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_vencimento", sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
    if (!conta) return await failOut(userId, msg, texto, recebidaEm, deps, sess);
    return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, { ...sess, newDueDate: novo }, deps);
  }
  if (status === "conta_edicao_aguardando_valor") {
    const cents = parseAmountToCentavos(texto);
    if (!cents) {
      const resposta = 'Informe um valor válido (ex.: "99,90" ou "R$ 1.250,00").';
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_valor", sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
    if (!conta) return await failOut(userId, msg, texto, recebidaEm, deps, sess);
    return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, { ...sess, newAmountCentavos: cents }, deps);
  }
  if (status === "conta_edicao_aguardando_nome") {
    const novo = texto.trim();
    if (!validateNewName(novo)) {
      const resposta = "Esse nome não parece válido. Tente algo como “Internet Residencial”.";
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_nome", sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
    if (!conta) return await failOut(userId, msg, texto, recebidaEm, deps, sess);
    return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, { ...sess, newName: novo }, deps);
  }

  // Picker de categoria.
  if (status === "conta_edicao_aguardando_categoria") {
    const cats = await deps.loadCategoriasParaPicker(userId);
    const r = await deps.resolveCategoriaPickerInput({
      userId,
      holder: {
        descricao: sess.contaNome ?? null,
        categoriaSugerida: sess.newCategoryLabel ?? null,
        categoriaOptions: sess.categoriaOptions,
      },
      cats, texto,
    });
    if (r.kind === "picked") {
      const conta = sess.contaId ? await buscarContaPorId(userId, sess.contaId) : null;
      if (!conta) return await failOut(userId, msg, texto, recebidaEm, deps, sess);
      const next: EdicaoContaSession = {
        ...sess,
        newCategoryId: r.cat.id,
        newCategoryLabel: r.cat.nome,
        categoriaOptions: undefined,
      };
      return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, next, deps);
    }
    if (r.kind === "relist") {
      const next: EdicaoContaSession = { ...sess, categoriaOptions: r.options };
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_categoria", next as never, r.body,
      );
      return { status: "pendente", resposta: r.body };
    }
    const aviso = "Não entendi. Informe o número, o nome da categoria, “mais” para ver outras opções ou “cancelar”.";
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_categoria", sess as never, aviso,
    );
    return { status: "pendente", resposta: aviso };
  }

  // Confirmação extra de data passada/futura.
  if ((sess.awaitingFutureDateConfirm || sess.awaitingPastDateConfirm) && status === "conta_edicao_aguardando_confirmacao") {
    // Tratamento normal por "confirm/cancel" abaixo.
  }

  // Confirmação final (edição) ou cancelamento (cancelar conta).
  if (status === "conta_edicao_aguardando_confirmacao" || status === "conta_cancelamento_aguardando_confirmacao") {
    if (decisao !== "confirm") {
      // qualquer outra resposta vira "não entendi".
      const resposta = 'Responda "sim" para confirmar ou "cancelar" para desistir.';
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        status, sess as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    // Claim atômico: marca persistindo e tenta gravar a mensagem de
    // confirmação com external_id (índice único). Se outra réplica já
    // gravou, abortamos sem alterar nada.
    const claim = await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_persistindo", sess as never, "Aplicando alteração…",
    );
    if (!claim.ok && claim.errorCode === "23505") {
      // duplicada (reentrega) — silencioso, sem efeito.
      logEvent("conflict", sess.operation, 0, null, "conflict");
      return { status: "duplicada", resposta: "" };
    }

    const result = await applyUpdate(userId, sess);
    if (!result.ok) {
      logEvent("failed", sess.operation, 0, 0, result.error === "already_paid" ? "conflict" : "error");
      const resposta = result.error === "already_paid"
        ? statusPagaResposta()
        : "Não consegui aplicar a alteração agora. Tente novamente em instantes.";
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "cancelada", sess as never, resposta,
      );
      return { status: "falha", resposta };
    }

    // Readback: para single, basta o `affected>0`. Para future_pending,
    // confirma com count.
    const isCancel = sess.kind === "cancelamento_conta";
    const resposta = isCancel
      ? respCancelamentoSucesso(sess, result.affected)
      : respEdicaoSucesso(sess, result.affected);
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "salva", sess as never, resposta,
    );
    logEvent(isCancel ? "cancelled" : "updated", sess.operation, 1, result.affected, "ok");
    return { status: "salva", resposta };
  }

  // Estado inesperado.
  return { status: "sem_pendencia", resposta: "" };
}

function respEdicaoSucesso(sess: EdicaoContaSession, affected: number): string {
  const muitos = sess.recurrenceScope === "future_pending" && affected > 1;
  const cabec = muitos
    ? `Alterações aplicadas em ${affected} ocorrências pendentes.`
    : "Pronto, alteração aplicada.";
  return cabec;
}
function respCancelamentoSucesso(sess: EdicaoContaSession, affected: number): string {
  const muitos = sess.recurrenceScope === "future_pending" && affected > 1;
  return muitos
    ? `${affected} ocorrências pendentes foram canceladas.`
    : "Conta cancelada com sucesso.";
}

async function failOut(
  userId: string, msg: WhatsAppMessageRow, texto: string, recebidaEm: string,
  deps: WhatsAppEdicaoContaDeps, sess: EdicaoContaSession,
): Promise<ProcessOutcome> {
  const resposta = "Não consegui localizar essa conta. Tente novamente.";
  await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "cancelada", sess as never, resposta,
  );
  return { status: "consulta", resposta };
}

async function avancarApos1Candidata(
  userId: string, msg: WhatsAppMessageRow, texto: string, recebidaEm: string,
  conta: ContaVencimentoRow, intent: EdicaoIntent,
  deps: WhatsAppEdicaoContaDeps,
  base: EdicaoContaSession | null = null,
): Promise<ProcessOutcome> {
  // Bloqueia paga IMEDIATAMENTE.
  if (conta.status === "pago") {
    logEvent("failed", intent.operation, 1, null, "conflict");
    const resposta = statusPagaResposta();
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada", { kind: "edicao_conta", contaId: conta.id } as never, resposta,
    );
    return { status: "consulta", resposta };
  }

  const recId = await getRecorrenciaIdDaConta(conta.id, userId);

  const sess: EdicaoContaSession = {
    kind: intent.operation === "cancel" ? "cancelamento_conta" : "edicao_conta",
    contaId: conta.id,
    candidateContaIds: null,
    operation: intent.operation,
    newDueDate: intent.dateText ? parseDate(intent.dateText) : (base?.newDueDate ?? null),
    newAmountCentavos: intent.amountText ? parseAmountToCentavos(intent.amountText) : (base?.newAmountCentavos ?? null),
    newCategoryId: base?.newCategoryId ?? null,
    newCategoryLabel: intent.newCategoryName ?? base?.newCategoryLabel ?? null,
    newName: intent.newName ?? base?.newName ?? null,
    recurrenceScope: null,
    contaNome: conta.nome,
    contaVencimento: conta.dataVencimento,
    contaValor: conta.valor,
    recorrenciaId: recId,
  };

  // Se for recorrente, perguntar escopo ANTES de qualquer prévia.
  if (recId) {
    const resposta = askRecurrenceScope();
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_escopo_recorrencia", sess as never, resposta,
    );
    logEvent("awaiting_scope", intent.operation, 1, null, "ok");
    return { status: "pendente", resposta };
  }
  sess.recurrenceScope = "single";
  return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, sess, deps);
}

async function mostrarPreviewOuColetar(
  userId: string, msg: WhatsAppMessageRow, texto: string, recebidaEm: string,
  conta: ContaVencimentoRow, sess: EdicaoContaSession,
  deps: WhatsAppEdicaoContaDeps,
): Promise<ProcessOutcome> {
  const op = sess.operation!;
  // Cancelamento: preview direto.
  if (sess.kind === "cancelamento_conta") {
    const resposta = previewCancelamento(conta, sess.recurrenceScope ?? undefined);
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_cancelamento_aguardando_confirmacao", sess as never, resposta,
    );
    logEvent("awaiting_confirmation", op, 1, null, "ok");
    return { status: "pendente", resposta };
  }
  // Coleta o que falta.
  if (op === "due_date" && !sess.newDueDate) {
    const resposta = `Para quando devo mover o vencimento de ${conta.nome}?`;
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_vencimento", sess as never, resposta,
    );
    return { status: "pendente", resposta };
  }
  if (op === "amount" && !sess.newAmountCentavos) {
    const resposta = `Qual é o novo valor de ${conta.nome}? (ex.: 99,90)`;
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_valor", sess as never, resposta,
    );
    return { status: "pendente", resposta };
  }
  if (op === "name" && !sess.newName) {
    const resposta = `Qual o novo nome de ${conta.nome}?`;
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_nome", sess as never, resposta,
    );
    return { status: "pendente", resposta };
  }
  if (op === "category" && !sess.newCategoryId) {
    // Se veio categoria textual, tenta resolver direto. Senão, mostra lista.
    const cats = await deps.loadCategoriasParaPicker(userId);
    if (sess.newCategoryLabel) {
      const r = await deps.resolveCategoriaPickerInput({
        userId,
        holder: { descricao: conta.nome, categoriaSugerida: null, categoriaOptions: undefined },
        cats, texto: sess.newCategoryLabel,
      });
      if (r.kind === "picked") {
        const next: EdicaoContaSession = {
          ...sess, newCategoryId: r.cat.id, newCategoryLabel: r.cat.nome,
        };
        return await mostrarPreviewOuColetar(userId, msg, texto, recebidaEm, conta, next, deps);
      }
    }
    const { body, options } = await deps.buildCategoriaListBody({
      userId,
      holder: { descricao: conta.nome, categoriaSugerida: null },
      cats,
    });
    const next: EdicaoContaSession = { ...sess, categoriaOptions: options };
    const resposta = `Qual categoria devo usar?\n\n${body}`;
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_edicao_aguardando_categoria", next as never, resposta,
    );
    return { status: "pendente", resposta };
  }
  // Vencimento: checa passado/futuro antes da prévia normal.
  if (op === "due_date" && sess.newDueDate) {
    const today = todayISOInAppTz();
    if (sess.newDueDate < today && !sess.awaitingPastDateConfirm) {
      const resposta = askPastDateConfirm(sess.newDueDate);
      const next: EdicaoContaSession = { ...sess, awaitingPastDateConfirm: true };
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_edicao_aguardando_confirmacao", next as never, resposta,
      );
      logEvent("awaiting_confirmation", op, 1, null, "ok");
      return { status: "pendente", resposta };
    }
  }

  // Prévia final.
  const resposta = previewSingle(op, conta, sess, sess.recurrenceScope ?? undefined);
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "conta_edicao_aguardando_confirmacao", sess as never, resposta,
  );
  logEvent("awaiting_confirmation", op, 1, null, "ok");
  return { status: "pendente", resposta };
}
