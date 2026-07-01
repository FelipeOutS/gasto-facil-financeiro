/**
 * WA-C7.2.b — State machine completa para pagamentos para pessoa.
 *
 * Substitui o fluxo "single shot" da WA-C7.2.a por uma máquina de estados
 * que cobre:
 *
 *  1) Race condition concorrente — claim atômico em `whatsapp_messages`
 *     com status `pp_persistindo` ANTES de inserir em `gastos`. Como a
 *     tabela tem unique index parcial em `external_id`, um segundo
 *     webhook paralelo recebe `23505` e devolve resposta idempotente
 *     sem criar segundo gasto.
 *
 *  2) Integração com Contas a Pagar (M-2 completo):
 *     - 0 contas pendentes  → cria gasto direto (claim atômico).
 *     - 1 conta + valor bate → pergunta "marcar como paga? sim/não".
 *     - 1 conta            → pergunta "foi essa conta? sim/não".
 *     - N contas           → pergunta "qual delas você pagou?".
 *     Em todos os casos, "marcar como paga" reusa `processarBaixaConta`
 *     (WA-C3) — zero duplicação de lógica financeira.
 *
 *  3) Conversa gradual quando faltam dados:
 *     - sem valor          → `pp_aguardando_valor`
 *     - sem descrição      → `pp_aguardando_descricao` (pulável)
 *     - sem favorecido     → `pp_aguardando_favorecido` (tenta memória curta)
 *
 *  4) Cancelar / menu / timeout — todos os estados entram em
 *     `PAGAR_PESSOA_PENDING_STATES`, são fechados pelo reset global da
 *     WA-C6 e expiram pelo TTL padrão (30min) de `buscarSessaoAtiva`.
 *
 * Segurança: logs só com `event/stage/result/candidatesCount/hasValue/
 * hasDescricao/favorecidoMatched`. Nunca nome, valor, conta_id, user_id,
 * telefone ou chave Pix. Toda query filtra `user_id`.
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  ProcessOutcome,
  WhatsAppMessageRow,
  SaveSessionResult,
  UpdateSessionResult,
} from "./whatsapp.server";
import {
  parsePagarPessoa,
  parsePagarPixInline,
  maskPixKey,
  type PagarPessoaParsed,
  type PagarPixInlineParsed,
  type PixKeyType,
} from "./whatsapp-pix-parser";
import {
  findFavorecidosByNome,
  findFavorecidoByPixKey,
  createFavorecido,
  updateFavorecidoPix,
  rotuloTipoPix,
  type FavorecidoRow,
} from "./whatsapp-favorecidos.server";
import {
  findVencimentoByTerm,
  todayISOInAppTz,
  type ContaVencimentoRow,
} from "./contas-vencimento.server";
import {
  recordFavorecido,
  getLastFavorecido,
} from "./whatsapp-short-context.server";
import {
  processarBaixaConta,
  type WhatsAppBaixaContaDeps,
  type BaixaContaSession,
} from "./whatsapp-contas-pagar.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = _supabaseAdmin;

// ============================================================
// Estados e tipos
// ============================================================

export const PAGAR_PESSOA_PENDING_STATES = [
  "pp_aguardando_favorecido",
  "pp_aguardando_valor",
  "pp_aguardando_descricao",
  "pp_aguardando_confirmar_conta",
  "pp_aguardando_escolha_conta",
  "pp_aguardando_confirmar_pix_inline",
  "pp_aguardando_desambig_fav_pix",
  "pp_persistindo",
] as const;

export type PagarPessoaStatus = (typeof PAGAR_PESSOA_PENDING_STATES)[number];

export type PagarPessoaSession = {
  kind: "pagar_pessoa";
  nome: string | null;
  valorCentavos: number | null;
  descricao: string | null;
  formaPagamento: "pix" | "outro";
  favorecidoId: string | null;
  /**
   * Chave Pix pendente do fluxo inline. Só é persistida no favorecido
   * na confirmação. NUNCA é exibida em plain-text (usar `maskPixKey`)
   * nem logada.
   */
  pendingPixKey: string | null;
  pendingPixKeyType: PixKeyType | null;
  /** Quando há 1 conta candidata, esse é o id em consideração. */
  contaId: string | null;
  /** Quando há N contas candidatas, ids ordenados como apresentados. */
  candidateContaIds: string[] | null;
  /** Marcador (sem PII) — sabemos que o valor informado bate com a conta. */
  valorBateConta: boolean;
  /** Texto original recebido (já normalizado pelo curto-circuito de memória). */
  mensagemOriginal: string;
};


export function isPagarPessoaSession(s: unknown): s is PagarPessoaSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "pagar_pessoa";
}

// ============================================================
// DI seam
// ============================================================

export type WhatsAppPagarPessoaDeps = {
  gravarSessao: (
    userId: string, telefone: string, externalId: string | null,
    texto: string, recebidaEm: string, status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any, resposta: string, gastoId?: string,
  ) => Promise<SaveSessionResult>;
  atualizarSessao: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: string, status: string, session: any, resposta: string, gastoId?: string,
  ) => Promise<UpdateSessionResult>;
  fecharSessoesAnteriores: (
    userId: string, telefone: string,
    motivo: "salva" | "cancelada" | "expirada", gastoId?: string,
  ) => Promise<void>;
  baixaContaDeps: WhatsAppBaixaContaDeps;
};

// ============================================================
// Helpers
// ============================================================

function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function logEvent(
  stage: string,
  result: "ok" | "fail" | "not_found" | "race" | "conflict",
  extras: Record<string, string | number | boolean | null> = {},
) {
  console.info({
    event: "wa_pagar_pessoa_flow",
    stage,
    result,
    ...extras,
  });
}

function todayISO(): string {
  return todayISOInAppTz();
}

const OUTROS_LEGACY = "outros";

async function resolveOutrosCategoriaId(
  userId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  if (!Array.isArray(data) || data.length === 0) return null;
  const outros = data.find(
    (c: { legacy_id?: string | null; nome?: string }) =>
      c.legacy_id === OUTROS_LEGACY ||
      (c.nome ?? "").toLowerCase().trim() === "outros",
  );
  return (outros as { id: string } | undefined)?.id ?? null;
}

// ============================================================
// Parsers auxiliares (valor e descrição em mensagens isoladas)
// ============================================================

function parseValorIsolado(texto: string): number | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  // R$ 50 / R$ 50,00 / 50 reais / 50,90 / 50
  const re1 = /r\$?\s*([\d.]+(?:,\d{1,2})?)/i;
  const m1 = t.match(re1);
  if (m1) return parseBRL(m1[1]);
  const re2 = /\b(\d+(?:[.,]\d{1,2})?)\s*reais?\b/i;
  const m2 = t.match(re2);
  if (m2) return parseBRL(m2[1]);
  const re3 = /^(\d{1,6}(?:[.,]\d{1,2})?)$/;
  const m3 = t.match(re3);
  if (m3) return parseBRL(m3[1]);
  return null;
}

function parseBRL(s: string): number | null {
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100);
}

const SKIP_DESCRICAO_RE =
  /^\s*(pular|sem\s+motivo|sem\s+descricao|sem\s+descrição|nao|não|n|nenhum|nenhuma|ok)\s*$/i;

const NOME_PESSOA_RE =
  /^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.-]{1,30}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.-]{1,30}){0,2})\s*$/;

function capitalizarNome(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function parseNomeIsolado(texto: string): string | null {
  const m = (texto ?? "").trim().match(NOME_PESSOA_RE);
  if (!m) return null;
  return capitalizarNome(m[1]);
}

// ============================================================
// Textos
// ============================================================

const T = {
  perguntarValor(nome: string | null): string {
    return nome
      ? `Quanto foi o pagamento para ${nome}?`
      : `Quanto foi o pagamento?`;
  },
  perguntarDescricao(): string {
    return `Qual foi o motivo? (ou responda "pular")`;
  },
  perguntarFavorecido(): string {
    return `Quem você pagou?`;
  },
  confirmarContaUnica(
    nome: string,
    conta: ContaVencimentoRow,
    valorBate: boolean,
  ): string {
    const cab = valorBate
      ? `Encontrei uma conta pendente para ${nome} com esse mesmo valor:`
      : `Encontrei uma conta pendente para ${nome}:`;
    const pergunta = valorBate
      ? `Deseja marcar essa conta como paga?`
      : `Foi essa conta que você acabou de pagar?`;
    return [
      cab,
      ``,
      `${conta.nome} — ${formatBRL(Math.round(conta.valor * 100))}`,
      ``,
      pergunta,
      `1. Sim, marcar como paga`,
      `2. Não, registrar novo gasto`,
      `3. Cancelar`,
    ].join("\n");
  },
  escolherEntreContas(
    nome: string,
    contas: ContaVencimentoRow[],
  ): string {
    const linhas = contas.map(
      (c, i) =>
        `${i + 1}. ${c.nome} — ${formatBRL(Math.round(c.valor * 100))}`,
    );
    return [
      `Encontrei mais de uma conta pendente para ${nome}. Qual delas você pagou?`,
      ``,
      ...linhas,
      `${contas.length + 1}. Registrar novo gasto`,
      `${contas.length + 2}. Cancelar`,
    ].join("\n");
  },
  gastoRegistrado(args: {
    valor: number;
    nome: string;
    descricao: string | null;
  }): string {
    const desc = args.descricao ? ` — ${args.descricao}` : "";
    return [
      `Anotado! ${formatBRL(args.valor)} pago para ${args.nome}${desc}. ✅`,
      ``,
      `Já está registrado no Gasto Inteligente.`,
    ].join("\n");
  },
  duplicado(): string {
    return "Esse pagamento já tinha sido registrado. Está tudo certo. ✅";
  },
  ainda_processando(): string {
    return "Já estou processando esse pagamento. Em instantes te confirmo.";
  },
  cancelado(): string {
    return "Tudo bem, não registrei esse pagamento.";
  },
  erroGenerico(): string {
    return "Não consegui registrar agora. Pode tentar de novo daqui a pouco?";
  },
  naoEntendiNumero(maxOpcao: number): string {
    return `Não entendi. Responda com o número da opção (1 a ${maxOpcao}) ou "cancelar".`;
  },
};

export const PP_MESSAGES_FOR_TESTS = T;

// ============================================================
// Persistência do gasto avulso (com claim atômico)
// ============================================================

type PersistResult =
  | { kind: "ok"; gastoId: string }
  | { kind: "race_duplicate"; gastoId: string | null }
  | { kind: "race_in_progress" }
  | { kind: "error" };

/**
 * Tenta gravar a sessão `pp_persistindo` ANTES de inserir o gasto.
 * Aproveita o unique index parcial em `whatsapp_messages.external_id`:
 * se outro webhook paralelo já reservou o slot, recebemos `23505` e
 * devolvemos `race_in_progress`/`race_duplicate` em vez de criar um
 * segundo gasto.
 *
 * Quando não há `external_id`, segue direto para o insert do gasto
 * (sem claim — não há como detectar duplicidade de retry nesse caso).
 */
async function persistirGastoComClaim(args: {
  userId: string;
  telefone: string;
  externalId: string | null;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<PersistResult> {
  const { userId, telefone, externalId, texto, recebidaEm, session, deps } = args;
  const nome = session.nome ?? "";
  const valor = session.valorCentavos ?? 0;
  if (!nome || valor <= 0) return { kind: "error" };

  // Pré-check de idempotência (retries sequenciais sem race ativa).
  if (externalId) {
    const { data: prev } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, status, parsed")
      .eq("external_id", externalId)
      .maybeSingle();
    const parsed = (prev?.parsed ?? {}) as { kind?: string };
    if (prev && parsed.kind === "pagar_pessoa") {
      if (prev.status === "salva" && prev.gasto_id) {
        logEvent("idempotent_replay", "ok");
        return { kind: "race_duplicate", gastoId: prev.gasto_id as string };
      }
      if (prev.status === "pp_persistindo") {
        logEvent("race_in_progress_detected", "race");
        return { kind: "race_in_progress" };
      }
    }
  }

  // Claim atômico. Mesmo external_id → 23505 (unique violation).
  let claimedSessionId: string | null = null;
  if (externalId) {
    const claim = await deps.gravarSessao(
      userId,
      telefone,
      externalId,
      texto,
      recebidaEm,
      "pp_persistindo",
      session,
      "",
    );
    if (!claim.ok) {
      if (claim.errorCode === "23505") {
        // Outro processo paralelo claimou o slot. Releia para descobrir
        // se já saiu (salva) ou ainda está em andamento.
        const { data: again } = await supabaseAdmin
          .from("whatsapp_messages")
          .select("id, gasto_id, status, parsed")
          .eq("external_id", externalId)
          .maybeSingle();
        const p = (again?.parsed ?? {}) as { kind?: string };
        if (again && p.kind === "pagar_pessoa") {
          if (again.status === "salva" && again.gasto_id) {
            return { kind: "race_duplicate", gastoId: again.gasto_id as string };
          }
          return { kind: "race_in_progress" };
        }
        return { kind: "race_in_progress" };
      }
      logEvent("claim_failed", "fail");
      return { kind: "error" };
    }
    claimedSessionId = claim.sessionId;
  }

  // Insere o gasto.
  const catId = await resolveOutrosCategoriaId(userId);
  if (!catId) {
    logEvent("categoria_outros_missing", "fail");
    if (claimedSessionId) {
      await deps.atualizarSessao(
        claimedSessionId, "falha", session, T.erroGenerico(),
      );
    }
    return { kind: "error" };
  }

  const hoje = new Date();
  const data = hoje.toISOString().slice(0, 10);
  const y = hoje.getFullYear();
  const mo = hoje.getMonth() + 1;
  const descricaoFinal = session.descricao ?? `Pagamento para ${nome}`;
  const obs =
    `WhatsApp: pagamento para ${nome}${session.descricao ? ` — ${session.descricao}` : ""}`.slice(0, 240);

  const { data: row, error } = await supabaseAdmin
    .from("gastos")
    .insert({
      user_id: userId,
      categoria_id: catId,
      descricao: descricaoFinal.slice(0, 120),
      estabelecimento: nome.slice(0, 120),
      valor,
      data,
      mes: mo,
      ano: y,
      forma_pagamento: session.formaPagamento,
      cartao_id: null,
      tipo_gasto: "unico",
      total_parcelas: null,
      observacao: obs,
      origem: "whatsapp",
      confirmado: true,
      fornecedor_id: session.favorecidoId ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    logEvent("insert_failed", "fail");
    if (claimedSessionId) {
      await deps.atualizarSessao(
        claimedSessionId, "falha", session, T.erroGenerico(),
      );
    }
    return { kind: "error" };
  }

  const gastoId = row.id as string;

  if (claimedSessionId) {
    await deps.atualizarSessao(
      claimedSessionId,
      "salva",
      { ...session, kind: "pagar_pessoa" },
      T.gastoRegistrado({ valor, nome, descricao: session.descricao }),
      gastoId,
    );
  } else {
    // Sem external_id (caminho secundário): grava sessão final agora.
    await deps.gravarSessao(
      userId, telefone, externalId, texto, recebidaEm, "salva",
      session,
      T.gastoRegistrado({ valor, nome, descricao: session.descricao }),
      gastoId,
    );
  }

  logEvent("saved", "ok", {
    favorecidoMatched: !!session.favorecidoId,
    hasDescricao: !!session.descricao,
  });
  return { kind: "ok", gastoId };
}

// ============================================================
// M-2: reuso da baixa de contas a pagar
// ============================================================

/**
 * Cria sessão sintética de `baixa_conta` em "aguardando_confirmacao" e
 * delega para `processarBaixaConta(decisao="confirm")` — toda a lógica
 * financeira da WA-C3 é reutilizada (update condicional, readback,
 * fechamento de sessão, logs).
 */
async function reusarBaixaContaPaga(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  contaId: string;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, contaId, deps } = args;
  const baixaSession: BaixaContaSession = {
    kind: "baixa_conta",
    contaId,
    candidateContaIds: null,
    dataPagamento: todayISO(),
  };
  const claim = await deps.gravarSessao(
    userId, msg.telefone, null, texto, recebidaEm,
    "conta_pagamento_aguardando_confirmacao",
    baixaSession, "",
  );
  if (!claim.ok || !claim.sessionId) {
    logEvent("baixa_reuse_session_fail", "fail");
    return { status: "erro", resposta: T.erroGenerico() };
  }
  return await processarBaixaConta({
    userId,
    msg,
    texto,
    recebidaEm,
    decisao: "confirm",
    sessao: {
      id: claim.sessionId,
      status: "conta_pagamento_aguardando_confirmacao",
      session: baixaSession,
      recebida_em: recebidaEm,
    },
    deps: deps.baixaContaDeps,
  });
}

// ============================================================
// Handler principal
// ============================================================

export async function processarPagarPessoaFlow(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: {
    id: string;
    status: string;
    session: unknown;
    recebida_em: string;
  } | null;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const HARD_CANCEL_RE = /\b(cancelar|cancela|cancelado|cancelada)\b/i;
  const isHardCancel = HARD_CANCEL_RE.test(texto) || decisao === "cancel";

  // Cancelamento universal.
  if (sessao && isHardCancel) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada", sessao.session, T.cancelado(),
    );
    logEvent("cancelled", "ok");
    return { status: "cancelada", resposta: T.cancelado() };
  }

  // -----------------------------------------------------------
  // Entrada sem sessão (a partir do roteador, após detectPagarPessoaIntent
  // ou atalho de memória curta).
  // -----------------------------------------------------------
  if (!sessao) {
    return await entrarFluxo({ userId, msg, texto, recebidaEm, deps });
  }

  if (!isPagarPessoaSession(sessao.session)) {
    return { status: "sem_pendencia", resposta: "" };
  }
  const session = sessao.session;

  switch (sessao.status) {
    case "pp_aguardando_favorecido":
      return await passoFavorecido({
        userId, msg, texto, recebidaEm, session, sessao, deps,
      });
    case "pp_aguardando_valor":
      return await passoValor({
        userId, msg, texto, recebidaEm, session, sessao, deps,
      });
    case "pp_aguardando_descricao":
      return await passoDescricao({
        userId, msg, texto, recebidaEm, session, sessao, deps,
      });
    case "pp_aguardando_confirmar_conta":
      return await passoConfirmarContaUnica({
        userId, msg, texto, recebidaEm, session, sessao, decisao, deps,
      });
    case "pp_aguardando_escolha_conta":
      return await passoEscolherConta({
        userId, msg, texto, recebidaEm, session, sessao, deps,
      });
    case "pp_persistindo":
      // Mesmo external_id em corrida — devolve resposta neutra.
      return { status: "duplicada", resposta: T.ainda_processando() };
    default:
      return { status: "sem_pendencia", resposta: "" };
  }
}

// ============================================================
// Entrada: parsea a mensagem e decide próximo passo
// ============================================================

async function entrarFluxo(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, deps } = args;
  const parsed: PagarPessoaParsed | null = parsePagarPessoa(texto);

  let nome = parsed?.nome ?? null;
  // Entrada gradual: "Paguei João" (sem valor) — extrai o nome direto.
  if (!nome) {
    const verbMatch = texto.match(
      /^\s*(?:paguei|pago|quitei|j[áa]\s+paguei|acabei\s+de\s+pagar)\s+(?:o\s+|a\s+)?/i,
    );
    if (verbMatch) {
      const tail = texto.slice(verbMatch[0].length);
      const nameMatch = tail.match(
        /^([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]{1,30}(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]{1,30}){0,2})\s*[.!?]*\s*$/,
      );
      if (nameMatch) nome = nameMatch[1].trim();
    }
  }
  // Atalho "Paguei." sem destinatário: tenta memória curta.
  if (!nome) {
    const recente = getLastFavorecido(msg.telefone);
    if (recente) nome = recente;
  }

  // Valor pode vir só do parsed (quando há texto rico) ou de parser isolado.
  let valor = parsed?.valorCentavos ?? null;
  if (valor === null || valor <= 0) {
    const v = parseValorIsolado(texto);
    if (v) valor = v;
  }
  // Se for só "paguei" puro, valor isolado pode pegar números do texto
  // que NÃO são preço — descartamos se a frase é "paguei" pelado.
  if (/^\s*(paguei|ja\s+paguei|j[aá]\s+paguei|acabei\s+de\s+pagar|quitei)\s*[.!?]*\s*$/i.test(texto)) {
    valor = null;
  }

  const descricao = parsed?.descricao ?? null;
  const formaPagamento: "pix" | "outro" = parsed?.formaPagamento ?? "outro";

  // Sem favorecido → estado favorecido.
  if (!nome) {
    const session: PagarPessoaSession = {
      kind: "pagar_pessoa",
      nome: null,
      valorCentavos: valor,
      descricao,
      formaPagamento,
      favorecidoId: null,
      pendingPixKey: null,
      pendingPixKeyType: null,
      contaId: null,
      candidateContaIds: null,
      valorBateConta: false,
      mensagemOriginal: texto,
    };
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "pp_aguardando_favorecido", session, T.perguntarFavorecido(),
    );
    logEvent("ask_favorecido", "ok");
    return { status: "pendente", resposta: T.perguntarFavorecido() };
  }

  // Tem favorecido. Resolve favorecidoId quando possível.
  const matches = await findFavorecidosByNome(userId, nome);
  const favorecidoId =
    matches.length === 1 ? matches[0].id : null;

  // Sem valor → estado valor.
  if (!valor || valor <= 0) {
    const session: PagarPessoaSession = {
      kind: "pagar_pessoa",
      nome,
      valorCentavos: null,
      descricao,
      formaPagamento,
      favorecidoId,
      pendingPixKey: null,
      pendingPixKeyType: null,
      contaId: null,
      candidateContaIds: null,
      valorBateConta: false,
      mensagemOriginal: texto,
    };
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "pp_aguardando_valor", session, T.perguntarValor(nome),
    );
    logEvent("ask_valor", "ok");
    return { status: "pendente", resposta: T.perguntarValor(nome) };
  }

  // Tem nome + valor → roda M-2 (contas pendentes) ou registra direto.
  return await decidirContasOuRegistrar({
    userId,
    msg,
    texto,
    recebidaEm,
    session: {
      kind: "pagar_pessoa",
      nome,
      valorCentavos: valor,
      descricao,
      formaPagamento,
      favorecidoId,
      contaId: null,
      candidateContaIds: null,
      valorBateConta: false,
      mensagemOriginal: texto,
    },
    deps,
  });
}

// ============================================================
// M-2: detectar colisão com contas a pagar
// ============================================================

async function decidirContasOuRegistrar(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, deps } = args;
  const nome = session.nome ?? "";
  const valor = session.valorCentavos ?? 0;
  if (!nome || valor <= 0) {
    return { status: "erro", resposta: T.erroGenerico() };
  }

  const contas = await findVencimentoByTerm(userId, nome);
  logEvent("payable_lookup", "ok", { candidatesCount: contas.length });

  if (contas.length === 0) {
    return await criarGastoAvulso({
      userId, msg, texto, recebidaEm, session, deps,
    });
  }

  if (contas.length === 1) {
    const conta = contas[0];
    const valorBate = Math.round(conta.valor * 100) === valor;
    const newSession: PagarPessoaSession = {
      ...session,
      contaId: conta.id,
      candidateContaIds: null,
      valorBateConta: valorBate,
    };
    const resposta = T.confirmarContaUnica(nome, conta, valorBate);
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "pp_aguardando_confirmar_conta", newSession, resposta,
    );
    logEvent("ask_confirm_single", "ok", { valorBate });
    return { status: "pendente", resposta };
  }

  // Múltiplas contas.
  const top = contas.slice(0, 5);
  const newSession: PagarPessoaSession = {
    ...session,
    contaId: null,
    candidateContaIds: top.map((c) => c.id),
    valorBateConta: false,
  };
  const resposta = T.escolherEntreContas(nome, top);
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "pp_aguardando_escolha_conta", newSession, resposta,
  );
  logEvent("ask_choose_payable", "ok", { candidatesCount: top.length });
  return { status: "pendente", resposta };
}

async function criarGastoAvulso(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, deps } = args;
  const result = await persistirGastoComClaim({
    userId,
    telefone: msg.telefone,
    externalId: msg.external_id,
    texto,
    recebidaEm,
    session,
    deps,
  });
  if (result.kind === "ok") {
    if (session.nome) recordFavorecido(msg.telefone, session.nome);
    return {
      status: "salva",
      gastoId: result.gastoId,
      resposta: T.gastoRegistrado({
        valor: session.valorCentavos ?? 0,
        nome: session.nome ?? "",
        descricao: session.descricao,
      }),
    };
  }
  if (result.kind === "race_duplicate") {
    return {
      status: "duplicada",
      gastoId: result.gastoId ?? undefined,
      resposta: T.duplicado(),
    };
  }
  if (result.kind === "race_in_progress") {
    return { status: "duplicada", resposta: T.ainda_processando() };
  }
  return { status: "erro", resposta: T.erroGenerico() };
}

// ============================================================
// Passos da state machine
// ============================================================

async function passoFavorecido(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  const nome = parseNomeIsolado(texto);
  if (!nome) {
    const resposta = `Não entendi o nome. ${T.perguntarFavorecido()}`;
    await deps.atualizarSessao(
      sessao.id, "pp_aguardando_favorecido", session, resposta,
    );
    return { status: "pendente", resposta };
  }
  const matches = await findFavorecidosByNome(userId, nome);
  const favorecidoId = matches.length === 1 ? matches[0].id : null;
  const next: PagarPessoaSession = {
    ...session,
    nome,
    favorecidoId,
  };
  // Se já temos valor, segue para M-2; senão pergunta valor.
  if (next.valorCentavos && next.valorCentavos > 0) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return await decidirContasOuRegistrar({
      userId, msg, texto, recebidaEm, session: next, deps,
    });
  }
  await deps.atualizarSessao(
    sessao.id, "pp_aguardando_valor", next, T.perguntarValor(nome),
  );
  return { status: "pendente", resposta: T.perguntarValor(nome) };
}

async function passoValor(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  const valor = parseValorIsolado(texto);
  if (!valor) {
    const resposta = `Não entendi o valor. Por exemplo: 50 ou R$ 50,00.`;
    await deps.atualizarSessao(
      sessao.id, "pp_aguardando_valor", session, resposta,
    );
    return { status: "pendente", resposta };
  }
  const next: PagarPessoaSession = { ...session, valorCentavos: valor };
  // Pergunta descrição.
  await deps.atualizarSessao(
    sessao.id, "pp_aguardando_descricao", next, T.perguntarDescricao(),
  );
  return { status: "pendente", resposta: T.perguntarDescricao() };
}

async function passoDescricao(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  let descricao: string | null = null;
  if (!SKIP_DESCRICAO_RE.test(texto)) {
    const t = texto.trim().slice(0, 80);
    if (t.length >= 2) descricao = t;
  }
  const next: PagarPessoaSession = { ...session, descricao };
  // Fecha a sessão atual e entra em M-2 (que pode abrir nova sessão
  // pp_aguardando_confirmar_conta ou persistir o gasto direto).
  await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
  return await decidirContasOuRegistrar({
    userId, msg, texto, recebidaEm, session: next, deps,
  });
}

async function passoConfirmarContaUnica(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  decisao: "confirm" | "cancel" | "outro";
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, decisao, deps } = args;
  const t = texto.trim().toLowerCase();
  const escolha =
    /^1\b|sim|marcar|paga/i.test(t) || decisao === "confirm"
      ? 1
      : /^2\b|nao|não|novo|registrar/i.test(t)
        ? 2
        : /^3\b|cancelar/i.test(t) || decisao === "cancel"
          ? 3
          : 0;

  if (escolha === 3) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    return { status: "cancelada", resposta: T.cancelado() };
  }
  if (escolha === 1 && session.contaId) {
    // Fecha a sessão pp_* atual e delega para reuso da baixa.
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return await reusarBaixaContaPaga({
      userId, msg, texto, recebidaEm, contaId: session.contaId, deps,
    });
  }
  if (escolha === 2) {
    // Registrar como gasto novo (avulso, com claim).
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return await criarGastoAvulso({
      userId, msg, texto, recebidaEm, session, deps,
    });
  }
  // Não entendi.
  const resposta = T.naoEntendiNumero(3);
  await deps.atualizarSessao(
    sessao.id, "pp_aguardando_confirmar_conta", session, resposta,
  );
  return { status: "pendente", resposta };
}

async function passoEscolherConta(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  const ids = session.candidateContaIds ?? [];
  const maxConta = ids.length;
  const optNovo = maxConta + 1;
  const optCancel = maxConta + 2;
  const m = texto.trim().match(/^(\d{1,2})\b/);
  const escolha = m ? Number(m[1]) : 0;

  if (escolha === optCancel || /cancelar/i.test(texto)) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    return { status: "cancelada", resposta: T.cancelado() };
  }
  if (escolha === optNovo || /^novo|^registrar/i.test(texto)) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return await criarGastoAvulso({
      userId, msg, texto, recebidaEm, session, deps,
    });
  }
  if (escolha >= 1 && escolha <= maxConta) {
    const contaId = ids[escolha - 1];
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return await reusarBaixaContaPaga({
      userId, msg, texto, recebidaEm, contaId, deps,
    });
  }
  const resposta = T.naoEntendiNumero(optCancel);
  await deps.atualizarSessao(
    sessao.id, "pp_aguardando_escolha_conta", session, resposta,
  );
  return { status: "pendente", resposta };
}
