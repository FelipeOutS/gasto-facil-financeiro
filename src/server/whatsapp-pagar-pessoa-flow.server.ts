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
import {
  storePendingPixKey,
  consumePendingPixKey,
  deletePendingPixKey,
  hashPixKey,
} from "./whatsapp-pix-secret.server";
// WA-C11 3B.2.C.1 Block 2 — quota financeira do WhatsApp para "pagar pessoa".
// Ordem: sessão → claim `pp_persistindo` → gate → insert. Fail-closed sem
// `external_id` (idempotência da quota depende dele).
import {
  assertFinancialActionQuotaForWhatsApp,
  financialQuotaBlockedReply,
} from "./whatsapp-financial-quota-gate.server";

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
   * WA-Q-PixInline-LGPD — a chave Pix bruta NUNCA fica na sessão nem em
   * `whatsapp_messages.parsed`. Guardamos apenas:
   *   - `pendingPixSecretId`: id da linha cifrada em
   *     `whatsapp_pix_pending_secrets` (AES-256-GCM, TTL 30min);
   *   - `pendingPixKeyType`: tipo (para render/rótulo);
   *   - `pendingPixKeyMasked`: exibição já mascarada (LGPD-safe);
   *   - `pendingPixKeyHash`: HMAC da chave normalizada, só para
   *     dedup pós-race na confirmação.
   * O plaintext é lido apenas UMA vez, no "sim", via
   * `consumePendingPixKey` — que já apaga a linha após ler.
   */
  pendingPixSecretId: string | null;
  pendingPixKeyType: PixKeyType | null;
  pendingPixKeyMasked: string | null;
  pendingPixKeyHash: string | null;
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

/**
 * WA-Q-PixInline-Valor-Fix — conversão única e explícita de centavos
 * (inteiro) para reais (numeric) na fronteira de persistência. Toda a
 * pipeline usa centavos internamente; `gastos.valor` é o único campo em
 * reais. Nunca chame com valor já em reais.
 */
export function centavosParaReais(centavos: number): number {
  if (!Number.isFinite(centavos)) return 0;
  // Duas casas fixas evitam ruído de ponto flutuante (ex.: 5055 → 50.55).
  return Math.round(centavos) / 100;
}

/**
 * WA-Q-PixInline-LGPD — remove a chave Pix (plaintext e variantes
 * formatadas com dígitos apenas) do texto original antes de persistir
 * em `mensagemOriginal` / `parsed`. Substitui por `***`.
 */
function redigirPixKeyDoTexto(texto: string, pixKey: string): string {
  if (!texto) return texto;
  if (!pixKey) return texto;
  let out = texto;
  const raw = pixKey.trim();
  const digits = raw.replace(/\D+/g, "");
  const candidates = new Set<string>([raw]);
  if (digits.length >= 4) {
    candidates.add(digits);
    // Variantes formatadas: (11) 99999-8888 e 11 99999-8888.
    if (digits.length === 11) {
      candidates.add(
        `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`,
      );
      candidates.add(
        `${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`,
      );
      candidates.add(
        `+55${digits}`,
      );
      candidates.add(
        `+55 ${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`,
      );
    }
  }
  for (const c of candidates) {
    if (!c) continue;
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), "***");
  }
  return out;
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
  previewPixInline(args: {
    nome: string;
    valorCentavos: number;
    pixKeyType: PixKeyType;
    pixKeyMasked: string;
    reusandoFavorecido: boolean;
  }): string {
    const reuso = args.reusandoFavorecido
      ? `Favorecido já cadastrado — apenas vou registrar o pagamento.`
      : `Novo favorecido será salvo com essa chave.`;
    return [
      `Confira o pagamento Pix antes de confirmar:`,
      ``,
      `• Favorecido: ${args.nome}`,
      // WA-Q-PixInline-UX: rótulo em duas linhas — tipo primeiro
      // ("Celular" p/ telefone), máscara na linha seguinte.
      `• Chave Pix: ${rotuloTipoPix(args.pixKeyType)}`,
      `  ${args.pixKeyMasked}`,
      `• Valor: ${formatBRL(args.valorCentavos)}`,
      `• Forma: Pix`,
      ``,
      reuso,
      `⚠️ Registro interno no Gasto Inteligente — nenhum Pix bancário é enviado.`,
      ``,
      `Responda "sim" para registrar ou "cancelar" para descartar.`,
    ].join("\n");
  },
  pixInlineChaveInvalida(): string {
    return [
      `Não reconheci a chave Pix informada.`,
      `Chaves aceitas: celular (com DDD), CPF, CNPJ, e-mail ou chave aleatória (UUID).`,
      `Exemplo: Pix 50 para João Silva chave 11999998888`,
    ].join("\n");
  },
  pixInlineSucesso(args: {
    nome: string;
    valorCentavos: number;
    pixKeyType: PixKeyType;
    pixKeyMasked: string;
  }): string {
    return [
      `Registrado! ${formatBRL(args.valorCentavos)} para ${args.nome} via Pix. ✅`,
      // Mesma convenção da prévia — tipo + máscara em linhas separadas.
      `Chave Pix: ${rotuloTipoPix(args.pixKeyType)}`,
      `  ${args.pixKeyMasked}`,
      ``,
      `Favorecido salvo. Nas próximas vezes basta dizer o nome.`,
    ].join("\n");
  },
  pixInlineDesambig(args: {
    nomeNovo: string;
    existente: FavorecidoRow;
  }): string {
    const existType = args.existente.pix_key_type ?? "desconhecida";
    const existMasked = args.existente.pix_key
      ? maskPixKey(args.existente.pix_key, existType as PixKeyType)
      : "sem chave";
    return [
      `Já existe um favorecido chamado "${args.existente.nome}" com outra chave Pix.`,
      `• Chave atual (${rotuloTipoPix(existType as PixKeyType)}): ${existMasked}`,
      ``,
      `O que deseja fazer?`,
      `1. Atualizar a chave do favorecido existente`,
      `2. Salvar como um novo favorecido separado`,
      `3. Cancelar`,
    ].join("\n");
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
  | { kind: "quota_blocked"; resposta: string }
  | { kind: "error" };

/**
 * Tenta gravar a sessão `pp_persistindo` ANTES de inserir o gasto.
 * Aproveita o unique index parcial em `whatsapp_messages.external_id`:
 * se outro webhook paralelo já reservou o slot, recebemos `23505` e
 * devolvemos `race_in_progress`/`race_duplicate` em vez de criar um
 * segundo gasto.
 *
 * WA-C11 3B.2.C.1 Block 2 — sem `external_id` esta função falha fechada:
 * a chave de idempotência da quota financeira depende do `external_id`;
 * sem ela não é seguro consumir quota nem escrever.
 */
export async function persistirGastoComClaim(args: {
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
  const valorCentavos = session.valorCentavos ?? 0;
  if (!nome || valorCentavos <= 0) return { kind: "error" };
  // Conversão única centavos → reais na fronteira do insert.
  const valorReais = centavosParaReais(valorCentavos);

  // WA-C11 3B.2.C.1 Block 2 — fail-closed sem external_id.
  const externalIdTrim = (externalId ?? "").trim();
  if (externalIdTrim.length === 0) {
    logEvent("missing_external_id", "fail");
    return { kind: "error" };
  }

  // Pré-check de idempotência (retries sequenciais sem race ativa).
  {
    const { data: prev } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, gasto_id, status, parsed")
      .eq("external_id", externalIdTrim)
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
  {
    const claim = await deps.gravarSessao(
      userId,
      telefone,
      externalIdTrim,
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
          .eq("external_id", externalIdTrim)
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

  // WA-C11 3B.2.C.1 Block 2 — quota SOMENTE após vencer o claim.
  // Perdedores do claim retornam acima sem consumir quota.
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId: externalIdTrim,
    actionType: "expense_pay_person",
  });
  if (!gateOutcome.allowed) {
    const resposta = financialQuotaBlockedReply(gateOutcome);
    if (claimedSessionId) {
      await deps.atualizarSessao(
        claimedSessionId, "falha", session, resposta,
      );
    }
    logEvent("quota_blocked", "fail", { reason: gateOutcome.reason });
    return { kind: "quota_blocked", resposta };
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
      valor: valorReais,
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

  // WA-C11 3B.2.C.1 Block 2 — claim é obrigatório (fail-closed acima),
  // então `claimedSessionId` sempre existe aqui.
  if (claimedSessionId) {
    await deps.atualizarSessao(
      claimedSessionId,
      "salva",
      { ...session, kind: "pagar_pessoa" },
      T.gastoRegistrado({ valor: valorCentavos, nome, descricao: session.descricao }),
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
    // WA-Q-PixInline-LGPD: se havia secret cifrado transitório, apaga
    // antes de fechar a sessão — nunca deixar ciphertext órfão.
    if (isPagarPessoaSession(sessao.session)) {
      const s = sessao.session as PagarPessoaSession;
      if (s.pendingPixSecretId) {
        await deletePendingPixKey({ userId, secretId: s.pendingPixSecretId });
      }
    }
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
    case "pp_aguardando_confirmar_pix_inline":
      return await passoConfirmarPixInline({
        userId, msg, texto, recebidaEm, session, sessao, decisao, deps,
      });
    case "pp_aguardando_desambig_fav_pix":
      return await passoDesambigFavPix({
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
      pendingPixSecretId: null,
      pendingPixKeyMasked: null,
      pendingPixKeyHash: null,
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
  const favorecidoUnico: FavorecidoRow | null =
    matches.length === 1 ? matches[0] : null;
  const favorecidoId = favorecidoUnico?.id ?? null;

  // Sem valor → estado valor.
  if (!valor || valor <= 0) {
    const session: PagarPessoaSession = {
      kind: "pagar_pessoa",
      nome,
      valorCentavos: null,
      descricao,
      formaPagamento,
      favorecidoId,
      pendingPixSecretId: null,
      pendingPixKeyMasked: null,
      pendingPixKeyHash: null,
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

  const baseSession: PagarPessoaSession = {
    kind: "pagar_pessoa",
    nome,
    valorCentavos: valor,
    descricao,
    formaPagamento,
    favorecidoId,
    pendingPixSecretId: null,
    pendingPixKeyMasked: null,
    pendingPixKeyHash: null,
    pendingPixKeyType: null,
    contaId: null,
    candidateContaIds: null,
    valorBateConta: false,
    mensagemOriginal: texto,
  };

  // WA-PIX-3.25 — Quando o pagamento é Pix E há favorecido único cadastrado
  // com chave Pix, abrimos OBRIGATORIAMENTE a prévia Pix Inline. NUNCA
  // persistimos direto. A chave completa nunca entra em `texto`, `parsed`,
  // sessão ou log — só o ciphertext em `whatsapp_pix_pending_secrets` e a
  // máscara para exibição.
  if (
    formaPagamento === "pix" &&
    favorecidoUnico &&
    favorecidoUnico.pix_key &&
    favorecidoUnico.pix_key_type
  ) {
    return await abrirPreviaPixInlineDeFavorecido({
      userId,
      msg,
      texto,
      recebidaEm,
      favorecido: favorecidoUnico,
      baseSession,
      deps,
    });
  }

  // Tem nome + valor → roda M-2 (contas pendentes) ou registra direto.
  return await decidirContasOuRegistrar({
    userId,
    msg,
    texto,
    recebidaEm,
    session: baseSession,
    deps,
  });
}

/**
 * WA-PIX-3.25 — abre a prévia Pix Inline reusando o secret-store e o
 * estado `pp_aguardando_confirmar_pix_inline`. A chave do favorecido é
 * lida uma única vez do banco (via `findFavorecidosByNome`), cifrada em
 * `whatsapp_pix_pending_secrets` e removida de memória antes de gravar
 * a sessão. Nada de plaintext em `parsed`, `texto` ou log.
 */
async function abrirPreviaPixInlineDeFavorecido(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  favorecido: FavorecidoRow;
  baseSession: PagarPessoaSession;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, favorecido, baseSession, deps } = args;
  const pixKey = favorecido.pix_key as string;
  const pixKeyType = favorecido.pix_key_type as PixKeyType;
  const keyMasked = maskPixKey(pixKey, pixKeyType);

  const stored = await storePendingPixKey({
    userId,
    sessionMessageId: crypto.randomUUID(),
    pixKeyPlaintext: pixKey,
    pixKeyType,
  });
  if (!stored) {
    logEvent("pix_inline_store_secret_fail", "fail");
    return { status: "erro", resposta: T.erroGenerico() };
  }

  const session: PagarPessoaSession = {
    ...baseSession,
    nome: favorecido.nome,
    formaPagamento: "pix",
    favorecidoId: favorecido.id,
    pendingPixSecretId: stored.secretId,
    pendingPixKeyType: pixKeyType,
    pendingPixKeyMasked: keyMasked,
    pendingPixKeyHash: stored.keyHash,
  };

  const resposta = T.previewPixInline({
    nome: favorecido.nome,
    valorCentavos: session.valorCentavos ?? 0,
    pixKeyType,
    pixKeyMasked: keyMasked,
    reusandoFavorecido: true,
  });
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "pp_aguardando_confirmar_pix_inline", session, resposta,
  );
  logEvent("pix_inline_preview_from_favorecido", "ok", {
    favorecidoMatched: true,
    pixKeyType,
  });
  return { status: "pendente", resposta };
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
  if (result.kind === "quota_blocked") {
    return { status: "erro", resposta: result.resposta };
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

// ============================================================
// WA-Q-PixInline — Pagamento Pix inline com cadastro de favorecido
// ============================================================

/**
 * Entrada explícita do fluxo Pix inline. Chamada pelo dispatcher ANTES
 * do parser genérico de gasto quando `detectPagarPixInlineIntent` casa.
 *
 * Não persiste favorecido nem gasto. Apenas resolve/valida o favorecido
 * e abre sessão `pp_aguardando_confirmar_pix_inline` com prévia mascarada.
 */
export async function processarPixInlineEntry(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  parsed: PagarPixInlineParsed;
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, recebidaEm, parsed, deps } = args;
  // WA-Q-PixInline-LGPD (reforço): redigimos o texto ANTES de qualquer
  // gravarSessao. Isso garante que `whatsapp_messages.texto` — coluna
  // consultável comum — nunca receba a chave Pix completa em texto puro.
  // O `mensagemOriginal` da sessão continua sendo redigido também.
  const texto = redigirPixKeyDoTexto(args.texto, parsed.pixKey);

  // Chave inválida (por segurança, mesmo com detectPagarPixInlineIntent
  // já filtrando) — resposta clara sem abrir sessão travada.
  if (!parsed.pixKey || parsed.pixKeyType === "desconhecida") {
    logEvent("pix_inline_invalid_key", "fail", {
      pixKeyType: parsed.pixKeyType,
    });
    return {
      status: "sem_pendencia",
      resposta: T.pixInlineChaveInvalida(),
    };
  }

  const keyMasked = maskPixKey(parsed.pixKey, parsed.pixKeyType);
  const keyHashLocal = hashPixKey(parsed.pixKey);

  // Persiste ciphertext ANTES da sessão. Se falhar, aborta sem abrir prévia.
  const stored = await storePendingPixKey({
    userId,
    sessionMessageId: crypto.randomUUID(),
    pixKeyPlaintext: parsed.pixKey,
    pixKeyType: parsed.pixKeyType,
  });
  if (!stored) {
    logEvent("pix_inline_store_secret_fail", "fail");
    return { status: "erro", resposta: T.erroGenerico() };
  }

  const buildSession = (
    over: Partial<PagarPessoaSession>,
  ): PagarPessoaSession => ({
    kind: "pagar_pessoa",
    nome: parsed.nome,
    valorCentavos: parsed.valorCentavos,
    descricao: null,
    formaPagamento: "pix",
    favorecidoId: null,
    // WA-Q-PixInline-LGPD: NADA de plaintext aqui.
    pendingPixSecretId: stored.secretId,
    pendingPixKeyType: parsed.pixKeyType,
    pendingPixKeyMasked: keyMasked,
    pendingPixKeyHash: stored.keyHash,
    contaId: null,
    candidateContaIds: null,
    valorBateConta: false,
    // WA-Q-PixInline-LGPD: redige a chave do texto original antes de persistir
    // em session/parsed. Mantém contexto ("Pix 50 para João Silva chave ***")
    // sem vazar a chave.
    mensagemOriginal: redigirPixKeyDoTexto(texto, parsed.pixKey),
    ...over,
  });

  // 1) Match por chave Pix (silencioso — reusa favorecido existente).
  const byKey = await findFavorecidoByPixKey(userId, parsed.pixKey);
  if (byKey) {
    const session = buildSession({
      nome: byKey.nome,
      favorecidoId: byKey.id,
    });
    const resposta = T.previewPixInline({
      nome: byKey.nome,
      valorCentavos: parsed.valorCentavos,
      pixKeyType: parsed.pixKeyType,
      pixKeyMasked: keyMasked,
      reusandoFavorecido: true,
    });
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "pp_aguardando_confirmar_pix_inline", session, resposta,
    );
    logEvent("pix_inline_preview", "ok", {
      favorecidoMatched: true,
      matchBy: "key",
      pixKeyType: parsed.pixKeyType,
    });
    return { status: "pendente", resposta };
  }

  // 2) Checa conflito por nome (mesmo nome, outra chave).
  const byName = await findFavorecidosByNome(userId, parsed.nome);
  const conflitoNome = byName.find((f) => {
    if ((f.nome ?? "").trim().toLowerCase() !==
      parsed.nome.trim().toLowerCase()) return false;
    if (!f.pix_key) return false;
    // Compara via hash — não guarda plaintext do favorecido no scope.
    return hashPixKey(f.pix_key) !== keyHashLocal;
  });

  if (conflitoNome) {
    const session = buildSession({
      favorecidoId: conflitoNome.id,
    });
    const resposta = T.pixInlineDesambig({
      nomeNovo: parsed.nome,
      existente: conflitoNome,
    });
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "pp_aguardando_desambig_fav_pix", session, resposta,
    );
    logEvent("pix_inline_disambig", "conflict", {
      pixKeyType: parsed.pixKeyType,
    });
    return { status: "pendente", resposta };
  }

  // 3) Caminho normal — favorecido novo. Prévia sem persistência.
  const session = buildSession({});
  const resposta = T.previewPixInline({
    nome: parsed.nome,
    valorCentavos: parsed.valorCentavos,
    pixKeyType: parsed.pixKeyType,
    pixKeyMasked: keyMasked,
    reusandoFavorecido: false,
  });
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "pp_aguardando_confirmar_pix_inline", session, resposta,
  );
  logEvent("pix_inline_preview", "ok", {
    favorecidoMatched: false,
    matchBy: "none",
    pixKeyType: parsed.pixKeyType,
  });
  return { status: "pendente", resposta };
}

/**
 * Confirma (ou cancela) a prévia. Só no "sim" cria/atualiza favorecido
 * + gasto atomicamente. O plaintext da chave é lido UMA vez do
 * secret-store (que já apaga a linha na leitura).
 */
async function passoConfirmarPixInline(args: {
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
  const yes =
    decisao === "confirm" ||
    /^(1|sim|s|confirmo|confirmar|ok|pode\s+registrar)\b/i.test(t);
  const no =
    decisao === "cancel" ||
    /^(2|3|nao|não|n|cancelar|cancela|descarta|nao\s+quero|não\s+quero)\b/i.test(t);

  if (no) {
    // Apaga o secret antes de fechar a sessão.
    if (session.pendingPixSecretId) {
      await deletePendingPixKey({ userId, secretId: session.pendingPixSecretId });
    }
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    logEvent("pix_inline_cancelled", "ok");
    return { status: "cancelada", resposta: T.cancelado() };
  }
  if (!yes) {
    const resposta =
      `Responda "sim" para registrar o pagamento ou "cancelar" para descartar.`;
    await deps.atualizarSessao(
      sessao.id, "pp_aguardando_confirmar_pix_inline", session, resposta,
    );
    return { status: "pendente", resposta };
  }

  const pixKeyType = (session.pendingPixKeyType ?? "desconhecida") as PixKeyType;
  const pixKeyMasked = session.pendingPixKeyMasked ?? "";

  // Lê plaintext do secret-store (consumo apaga a linha).
  let pixKey = "";
  if (session.pendingPixSecretId) {
    pixKey = (await consumePendingPixKey({
      userId,
      secretId: session.pendingPixSecretId,
    })) ?? "";
  }
  if (!pixKey || pixKeyType === "desconhecida") {
    logEvent("pix_inline_secret_missing", "fail");
    // Sessão sem chave utilizável (expirou). Fecha e pede novamente.
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
    return {
      status: "erro",
      resposta:
        `A prévia expirou por segurança. Reenvie o Pix para eu registrar novamente.`,
    };
  }

  // Upsert favorecido ANTES do gasto.
  let favorecidoId = session.favorecidoId;
  if (!favorecidoId) {
    const rec = await findFavorecidoByPixKey(userId, pixKey);
    if (rec) {
      favorecidoId = rec.id;
    } else {
      const created = await createFavorecido({
        userId,
        nome: session.nome ?? "Favorecido",
        pixKey,
        pixKeyType,
      });
      if (!created) {
        logEvent("pix_inline_favorecido_create_fail", "fail");
        return { status: "erro", resposta: T.erroGenerico() };
      }
      favorecidoId = created.id;
    }
  }

  // pixKey só é usada até aqui — sai do scope após persistência.
  const sessionComFav: PagarPessoaSession = {
    ...session,
    favorecidoId,
    formaPagamento: "pix",
    // pendingPixSecretId já foi consumido — zera para não vazar em audit.
    pendingPixSecretId: null,
  };

  const result = await persistirGastoComClaim({
    userId,
    telefone: msg.telefone,
    externalId: msg.external_id,
    texto,
    recebidaEm,
    session: sessionComFav,
    deps,
  });

  if (result.kind === "ok") {
    if (sessionComFav.nome) recordFavorecido(msg.telefone, sessionComFav.nome);
    const resposta = T.pixInlineSucesso({
      nome: sessionComFav.nome ?? "Favorecido",
      valorCentavos: sessionComFav.valorCentavos ?? 0,
      pixKeyType,
      pixKeyMasked,
    });
    // WA-Q-PixInline-Terminal — a sessão da prévia (pp_aguardando_confirmar_pix_inline)
    // é uma linha diferente da mensagem "sim". Fecha explicitamente para
    // não deixar estado pendente residual.
    await deps.atualizarSessao(
      sessao.id, "salva", sessionComFav, resposta, result.gastoId,
    );
    return { status: "salva", gastoId: result.gastoId, resposta };
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
  // WA-Q-PixInline-Terminal — erro de persistência: fecha em terminal
  // de falha em vez de deixar a prévia pendurada.
  await deps.atualizarSessao(
    sessao.id, "falha", sessionComFav, T.erroGenerico(),
  );
  return { status: "erro", resposta: T.erroGenerico() };
}

/**
 * Desambiguação quando o nome já existe com OUTRA chave.
 * O secret-store da chave nova é mantido até "sim" ou cancelamento.
 */
async function passoDesambigFavPix(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: PagarPessoaSession;
  sessao: { id: string };
  deps: WhatsAppPagarPessoaDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessao, deps } = args;
  const t = texto.trim().toLowerCase();
  const escolha =
    /^1\b|atualizar/i.test(t) ? 1 :
    /^2\b|novo|separado/i.test(t) ? 2 :
    /^3\b|cancelar/i.test(t) ? 3 : 0;

  if (escolha === 3) {
    if (session.pendingPixSecretId) {
      await deletePendingPixKey({ userId, secretId: session.pendingPixSecretId });
    }
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    return { status: "cancelada", resposta: T.cancelado() };
  }
  if (escolha === 0) {
    const resposta = T.naoEntendiNumero(3);
    await deps.atualizarSessao(
      sessao.id, "pp_aguardando_desambig_fav_pix", session, resposta,
    );
    return { status: "pendente", resposta };
  }

  const pixKeyType = (session.pendingPixKeyType ?? "desconhecida") as PixKeyType;
  const pixKeyMasked = session.pendingPixKeyMasked ?? "";

  if (escolha === 1 && session.favorecidoId) {
    // Update chave — precisa do plaintext, mas NÃO consumir (ainda vai
    // rodar o "sim" depois). Faz peek: lê e re-grava.
    let pixKey = "";
    if (session.pendingPixSecretId) {
      pixKey = (await consumePendingPixKey({
        userId,
        secretId: session.pendingPixSecretId,
      })) ?? "";
    }
    if (!pixKey || pixKeyType === "desconhecida") {
      logEvent("pix_inline_secret_missing", "fail");
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "expirada");
      return {
        status: "erro",
        resposta:
          `A prévia expirou por segurança. Reenvie o Pix para eu registrar novamente.`,
      };
    }
    const ok = await updateFavorecidoPix(
      userId, session.favorecidoId, pixKey, pixKeyType,
    );
    if (!ok) {
      logEvent("pix_inline_update_fail", "fail");
      return { status: "erro", resposta: T.erroGenerico() };
    }
    // Re-armazena para o próximo passo (confirmar).
    const restored = await storePendingPixKey({
      userId,
      sessionMessageId: crypto.randomUUID(),
      pixKeyPlaintext: pixKey,
      pixKeyType,
    });
    const next: PagarPessoaSession = {
      ...session,
      pendingPixSecretId: restored?.secretId ?? null,
      pendingPixKeyHash: restored?.keyHash ?? session.pendingPixKeyHash,
    };
    const resposta = T.previewPixInline({
      nome: session.nome ?? "Favorecido",
      valorCentavos: session.valorCentavos ?? 0,
      pixKeyType,
      pixKeyMasked,
      reusandoFavorecido: true,
    });
    await deps.atualizarSessao(
      sessao.id, "pp_aguardando_confirmar_pix_inline", next, resposta,
    );
    return { status: "pendente", resposta };
  }

  // escolha === 2: criar novo favorecido (desvincula do existente).
  const next: PagarPessoaSession = { ...session, favorecidoId: null };
  const resposta = T.previewPixInline({
    nome: session.nome ?? "Favorecido",
    valorCentavos: session.valorCentavos ?? 0,
    pixKeyType,
    pixKeyMasked,
    reusandoFavorecido: false,
  });
  await deps.atualizarSessao(
    sessao.id, "pp_aguardando_confirmar_pix_inline", next, resposta,
  );
  return { status: "pendente", resposta };
}


