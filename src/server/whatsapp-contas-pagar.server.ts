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

// Live-binding para permitir mock.module() em testes (mesmo padrão WA-F3/WA-C2).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, {
  get: (_t, prop) => (_supa.supabaseAdmin as never)[prop as never],
});

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
};

// ---------- log seguro ----------

type Stage =
  | "detected"
  | "account_found"
  | "awaiting_choice"
  | "awaiting_confirmation"
  | "paid"
  | "already_updated"
  | "cancelled"
  | "failed";

type Result = "ok" | "not_found" | "ambiguous" | "conflict" | "error";

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

function hasMonetaryValue(t: string): boolean {
  // R$ X, X,XX, 1.200, "50 reais", "20 mil"
  if (/r\$\s*\d/.test(t)) return true;
  if (/\b\d+[.,]\d{2}\b/.test(t)) return true;
  if (/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/.test(t)) return true;
  if (/\b\d+\s*(?:reais|real|mil)\b/.test(t)) return true;
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
export function detectMarkAsPaidIntent(textRaw: string): { termo: string } | null {
  const t = norm(textRaw);
  if (!t) return null;

  // Bloqueia gastos consumados (mesmo verbo "paguei", mas com valor).
  if (hasMonetaryValue(t)) return null;

  // Bloqueia fatura / cartão (competência WA-F1..F5).
  if (/\bfatura\b/.test(t)) return null;

  // Bloqueia intenção futura ("vou pagar", "ainda preciso pagar").
  if (/\bvou\s+pagar\b/.test(t) || /\bpreciso\s+pagar\b/.test(t)) return null;
  // Bloqueia consultas: "o que paguei", "quando paguei".
  if (/\bo\s+que\s+paguei\b/.test(t) || /\bquando\s+paguei\b/.test(t)) return null;

  // Padrões aceitos. Cada um extrai o `termo`.
  // 1) "paguei [a|o|minha|meu|essa|esse] <termo>"
  let m = t.match(/\bpaguei\s+(?:a|o|as|os|minha|meu|essa|esse|uma|um)?\s*([a-z0-9 ]{2,40})$/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo };
  }
  // 2) "quitei <termo>" / "quitar <termo>"
  m = t.match(/\bquit(?:ei|ar|a|e)\s+(?:a|o|as|os|minha|meu|essa|esse|uma|um)?\s*([a-z0-9 ]{2,40})$/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo };
  }
  // 3) "dei baixa (em|na|no|do|da) <termo>" / "dar baixa em <termo>"
  m = t.match(/\b(?:dei|dar|da)\s+baixa\s+(?:em|na|no|do|da|nos|nas)?\s*([a-z0-9 ]{2,40})$/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo };
  }
  // 4) "marcar <termo> como pago" / "marca <termo> como pago"
  m = t.match(/\bmarc(?:ar|a|e|ou)\s+(?:a|o|as|os|minha|meu|essa|esse)?\s*([a-z0-9 ]{2,40})\s+como\s+pag[ao]\b/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo };
  }
  // 5) "<termo> foi pago/paga" / "a conta de <termo> foi paga"
  m = t.match(/\b(?:a\s+conta\s+(?:de|do|da)\s+)?([a-z0-9 ]{2,40})\s+(?:foi|esta|ja\s+foi)\s+pag[ao]\b/);
  if (m && m[1]) {
    const termo = stripFillers(m[1]);
    if (termo) return { termo };
  }
  return null;
}

const FILLER_WORDS = new Set([
  "a","o","as","os","minha","meu","essa","esse","uma","um",
  "de","do","da","dos","das","conta","contas","mensalidade",
  "ja","já",
]);

function stripFillers(raw: string): string {
  const words = raw.trim().split(/\s+/).filter((w) => !FILLER_WORDS.has(w));
  const out = words.join(" ").trim();
  return out;
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
    const d = new Date(hoje); d.setDate(d.getDate() - 1);
    return todayISOInAppTz(d);
  }
  // "dia 5" — assume mês corrente.
  let m = t.match(/\bdia\s+(\d{1,2})\b/);
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
  // "DD/MM" ou "DD/MM/YYYY"
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
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
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada", (sessao.session as never), resposta,
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
    // 1 candidata → confirmação direta.
    if (rows.length === 1) {
      const row = rows[0];
      const dataPag = todayISOInAppTz();
      const session: BaixaContaSession = {
        kind: "baixa_conta",
        contaId: row.id,
        candidateContaIds: null,
        dataPagamento: dataPag,
      };
      const resposta = previewSingle(row, dataPag);
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "conta_pagamento_aguardando_confirmacao",
        session as never, resposta,
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
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "conta_pagamento_aguardando_escolha",
      session as never, resposta,
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
        sessao.id, "conta_pagamento_aguardando_escolha", session as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const conta = await buscarContaPorId(userId, chosenId);
    if (!conta) {
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
      const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
      await deps.gravarSessao(
        userId, msg.telefone, msg.external_id, texto, recebidaEm,
        "sem_pendencia", session as never, resposta,
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
      sessao.id, "conta_pagamento_aguardando_confirmacao", novaSession as never, resposta,
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
          sessao.id, "conta_pagamento_aguardando_data", session as never, resposta,
        );
        return { status: "pendente", resposta };
      }
      // Data válida não-futura: volta para confirmação normal.
      const conta = session.contaId ? await buscarContaPorId(userId, session.contaId) : null;
      if (!conta) {
        await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
        const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
        await deps.gravarSessao(
          userId, msg.telefone, msg.external_id, texto, recebidaEm,
          "sem_pendencia", session as never, resposta,
        );
        logEvent("already_updated", 0, "conflict");
        return { status: "consulta", resposta };
      }
      const resposta = previewSingle(conta, novaData);
      await deps.atualizarSessao(
        sessao.id, "conta_pagamento_aguardando_confirmacao", session as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    const resposta = 'Não entendi. Responda "sim" para confirmar a data futura ou "cancelar".';
    await deps.atualizarSessao(
      sessao.id, "conta_pagamento_aguardando_data", session as never, resposta,
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
          sessao.id, "conta_pagamento_aguardando_data", session as never, resposta,
        );
        return { status: "pendente", resposta };
      }
      const conta = session.contaId ? await buscarContaPorId(userId, session.contaId) : null;
      if (!conta) {
        await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
        const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
        await deps.gravarSessao(
          userId, msg.telefone, msg.external_id, texto, recebidaEm,
          "sem_pendencia", session as never, resposta,
        );
        logEvent("already_updated", 0, "conflict");
        return { status: "consulta", resposta };
      }
      const resposta = previewSingle(conta, novaData);
      await deps.atualizarSessao(
        sessao.id, "conta_pagamento_aguardando_confirmacao", session as never, resposta,
      );
      return { status: "pendente", resposta };
    }
    if (decisao === "confirm") {
      return await persistirBaixa({ userId, msg, texto, recebidaEm, session, sessao, deps });
    }
    const resposta =
      'Não entendi. Responda "sim" para confirmar, informe outra data ou "cancelar".';
    await deps.atualizarSessao(
      sessao.id, "conta_pagamento_aguardando_confirmacao", session as never, resposta,
    );
    return { status: "pendente", resposta };
  }

  return { status: "sem_pendencia", resposta: "" };
}

// ---------- persistência ----------

async function persistirBaixa(args: {
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
  const nowIso = new Date().toISOString();
  // Update CONDICIONAL: id + user_id + status=pendente. Garante:
  //   - conta de outro usuário NÃO é alterada
  //   - dupla confirmação concorrente não dá baixa duas vezes
  //   - conta já paga não é tocada
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .update({
      status: "pago",
      data_pagamento: session.dataPagamento,
      updated_at: nowIso,
    })
    .eq("id", session.contaId)
    .eq("user_id", userId)
    .eq("status", "pendente")
    .select("id, nome, valor, data_vencimento, data_pagamento")
    .maybeSingle();

  if (error) {
    logEvent("failed", 0, "error");
    await deps.atualizarSessao(
      sessao.id, "conta_pagamento_aguardando_confirmacao", session as never,
      "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    );
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }
  if (!data) {
    // Sem linha alterada — outro processo já deu baixa, OU a conta sumiu.
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    const resposta = "Essa conta já foi atualizada ou não está mais pendente.";
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "sem_pendencia", session as never, resposta,
    );
    logEvent("already_updated", 0, "conflict");
    return { status: "consulta", resposta };
  }

  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
  const finalSession = { ...session, status: "salva" } as unknown;
  await deps.atualizarSessao(sessao.id, "salva", finalSession as never, "ok");

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
