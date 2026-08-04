/**
 * WA-C10.a — Handler de cadastro de CONTA A PAGAR a partir de boleto
 * (código de barras ou linha digitável, somente texto).
 *
 * Esta etapa NÃO trata foto/PDF/OCR (WA-C10.b). Não realiza pagamento.
 *
 * Fluxo:
 *  1) Detector valida DV antes de classificar como boleto (parser puro).
 *  2) Se valor/vencimento ausentes (arrecadação ou vencido/erodido):
 *     pergunta um por vez. Nunca inventa.
 *  3) Pergunta identificação amigável ("Internet", "Condomínio"...).
 *  4) Mostra resumo com código MASCARADO e exige confirmação explícita.
 *  5) Verifica duplicidade por `codigo_boleto` (mesmo user_id, pendente).
 *  6) Cria conta a pagar pelo mesmo schema usado em WA-C2 — entra no
 *     fluxo normal de listagem, edição, baixa e lembretes (WA-C9).
 *
 * Segurança:
 *  - Logs SEM código bruto, sem PII, sem valor/vencimento; usam `fingerprint`.
 *  - Mensagens ao usuário mostram apenas mascara `****1234`.
 *  - O código completo é persistido em `contas_a_pagar.codigo_boleto`
 *    porque o usuário precisa copiá-lo de volta para pagar no banco —
 *    coluna pré-existente, RLS por user_id.
 *  - Idempotência por `external_id` (claim atômico) + dedup por código.
 */
import * as _supa from "@/integrations/supabase/client.server";
import { randomUUID } from "crypto";
import type { WhatsAppMessageRow, ProcessOutcome } from "./whatsapp.server";
import { detectBoletoFromText, type BoletoParsed } from "./whatsapp-boleto-parser";
import { formatBancoEmissor } from "./whatsapp-boleto-banco";
// WA-C11 3B.2.C.1 Block 5 — quota financeira para criação de conta por boleto.
import {
  assertFinancialActionQuotaForWhatsApp,
  financialQuotaBlockedReply,
} from "@/server/whatsapp-financial-quota-gate.server";

// Live-binding para permitir mock.module() em testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy(
  {},
  { get: (_t, p) => (_supa.supabaseAdmin as never)[p as never] },
);

// ---------- estados ----------

export const BOLETO_PENDING_STATES = [
  "bol_aguardando_valor",
  "bol_aguardando_vencimento",
  "bol_aguardando_identificacao",
  "bol_aguardando_confirmacao",
  "bol_aguardando_duplicidade",
  "bol_aguardando_selecao_candidato",
  "bol_aguardando_confirmacao_manual",
  "bol_persistindo",
] as const;

export type BoletoSession = {
  kind: "boleto";
  fingerprint: string;
  tipo: "cobranca" | "arrecadacao";
  valorCentavos: number | null;
  vencimentoISO: string | null;
  identificacao: string | null;
  mascara: string;
  /** Mantido apenas até persistir; nunca aparece em logs nem em resposta. */
  codigoBarras: string;
  banco?: string;
  /** Origem da sessão. Usado p/ telemetria, nunca afeta validação. */
  origem?: "texto" | "imagem" | "pdf";
};

export function isBoletoSession(s: unknown): s is BoletoSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "boleto";
}

/**
 * Sessão de SELEÇÃO de candidato — usada quando o OCR encontrou >1 boleto
 * válido (todos com DV ok) e o usuário precisa escolher qual cadastrar.
 *
 * Os códigos brutos ficam APENAS aqui dentro até o usuário escolher.
 * Não são logados; não viram resposta; mascaras é o que aparece ao usuário.
 */
export type BoletoSelecaoSession = {
  kind: "boleto_selecao";
  origem: "imagem" | "pdf";
  candidatos: Array<{
    fingerprint: string;
    mascara: string;
    codigoBarras: string;
    tipo: "cobranca" | "arrecadacao";
    valorCentavos: number | null;
    vencimentoISO: string | null;
    banco?: string;
  }>;
  identificacaoSugerida: string | null;
};

export function isBoletoSelecaoSession(s: unknown): s is BoletoSelecaoSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "boleto_selecao";
}

/**
 * Sessão de FALLBACK MANUAL — usada quando o OCR encontrou apenas
 * valor/vencimento sugeridos, sem nenhum candidato validado pelo parser.
 * Cria uma conta a pagar SEM `codigo_boleto`. O usuário precisa confirmar.
 */
export type BoletoManualSession = {
  kind: "boleto_manual";
  origem: "imagem" | "pdf";
  valorCentavos: number | null;
  vencimentoISO: string | null;
  identificacao: string | null;
};

export function isBoletoManualSession(s: unknown): s is BoletoManualSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "boleto_manual";
}

/** União ampla — usada pelos roteadores em `whatsapp.server.ts`. */
export function isAnyBoletoSession(s: unknown): boolean {
  return isBoletoSession(s) || isBoletoSelecaoSession(s) || isBoletoManualSession(s);
}

// ---------- DI ----------

export type WhatsAppBoletoDeps = {
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
  | "awaiting_value"
  | "awaiting_due_date"
  | "awaiting_identification"
  | "awaiting_confirmation"
  | "awaiting_duplicate_decision"
  | "persisted"
  | "cancelled"
  | "failed";

function logBoleto(
  stage: Stage,
  fingerprint: string,
  result: "ok" | "invalid" | "duplicate" | "error",
) {
  console.info({
    event: "wa_boleto_decision",
    stage,
    fingerprint,
    result,
  });
}

// ---------- format ----------

function formatBRL(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function todayLocalISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// ---------- parsing de respostas ----------

function parseValorFromText(t: string): number | null {
  const m = t.match(/r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  if (!m) return null;
  let raw = m[1];
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function parseDataFromText(t: string): string | null {
  const m = t.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------- mensagens ----------

function previewMessage(s: BoletoSession): string {
  const linhas = [
    "Encontrei um boleto para cadastrar 🧾",
    "",
    `• Valor: ${s.valorCentavos != null ? formatBRL(s.valorCentavos) : "(a confirmar)"}`,
    `• Vencimento: ${s.vencimentoISO ? formatDateBR(s.vencimentoISO) : "(a confirmar)"}`,
    `• Identificação: ${s.identificacao ?? "(a confirmar)"}`,
    `• Código: ${s.mascara}`,
  ];
  if (s.vencimentoISO && s.vencimentoISO < todayLocalISO()) {
    linhas.push(
      "",
      `⚠️ Esse boleto venceu em ${formatDateBR(s.vencimentoISO)}. Confirme o valor atual antes de pagar.`,
    );
  }
  linhas.push(
    "",
    "Confirma cadastrar?",
    "1. Confirmar",
    "2. Corrigir valor",
    "3. Corrigir vencimento",
    "4. Corrigir identificação",
    "5. Cancelar",
  );
  return linhas.join("\n");
}

// ---------- detector (export do parser) ----------

/**
 * Detector estrito de boleto válido. Retorna o boleto parseado ou null.
 * Use no roteador ANTES do parser genérico de gasto.
 */
export function detectBoletoIntent(text: string): BoletoParsed | null {
  return detectBoletoFromText(text);
}

// ---------- handler ----------

export async function processarBoleto(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string } | null;
  deps: WhatsAppBoletoDeps;
  /** Quando o caller já parseou (otimização). */
  parsed?: BoletoParsed | null;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const t = texto.trim();
  const tLower = t.toLowerCase();
  const hardCancel = decisao === "cancel" || /^(5|cancelar|cancela|cancelado|cancelada)$/i.test(t);

  // ---- WA-C10.a.1 / WA-C10.b: menu/ajuda em sessão ativa não perdem dados ----
  if (sessao && isAnyBoletoSession(sessao.session) && !hardCancel) {
    const session = sessao.session as { kind: string };
    const isAjuda = /^(ajuda|help|comandos|\?)$/i.test(tLower);
    const isMenu = /^menu$/i.test(tLower);
    if (isAjuda) {
      const r = [
        "Você está cadastrando um boleto 🧾",
        "Você pode:",
        "• Enviar o dado pedido (valor, vencimento ou identificação) para continuar",
        '• Enviar "cancelar" para descartar este boleto',
        '• Enviar "menu" para ver as opções globais',
        "",
        "Seus dados ficam salvos enquanto você decide.",
      ].join("\n");
      await deps.atualizarSessao(sessao.id, sessao.status, session as never, r);
      return { status: "pendente", resposta: r };
    }
    if (isMenu) {
      const r = [
        "Você tem um boleto em andamento. O que deseja fazer?",
        "• Envie o dado pedido para continuar o cadastro",
        '• Envie "cancelar" para descartar o boleto e abrir o menu',
        '• Envie "ajuda" para ver opções',
      ].join("\n");
      await deps.atualizarSessao(sessao.id, sessao.status, session as never, r);
      return { status: "pendente", resposta: r };
    }
  }

  // Cancelamento em qualquer estado de boleto (texto, seleção ou manual).
  if (sessao && isAnyBoletoSession(sessao.session) && hardCancel) {
    const original = sessao.session as Record<string, unknown>;
    // WA-C10.a.1 / WA-C10.b: limpa quaisquer códigos brutos.
    const sanitized: Record<string, unknown> = { ...original };
    if (isBoletoSession(original)) sanitized.codigoBarras = "";
    if (isBoletoSelecaoSession(original)) {
      sanitized.candidatos = original.candidatos.map((c) => ({
        fingerprint: c.fingerprint,
        mascara: c.mascara,
        tipo: c.tipo,
        valorCentavos: c.valorCentavos,
        vencimentoISO: c.vencimentoISO,
      }));
    }
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    const r = "Cadastro do boleto cancelado. 👍";
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "cancelada",
      sanitized as never,
      r,
    );
    const fp = isBoletoSession(original) ? original.fingerprint : "n/a";
    logBoleto("cancelled", fp, "ok");
    return { status: "cancelada", resposta: r };
  }

  // Sem sessão: inicia a partir do texto.
  if (!sessao) {
    const parsed = args.parsed ?? detectBoletoFromText(texto);
    if (!parsed) {
      logBoleto("detected", "n/a", "invalid");
      return {
        status: "erro",
        resposta:
          "Não consegui validar esse código como boleto. Confira se a linha digitável está completa ou envie novamente.",
      };
    }
    logBoleto("detected", parsed.fingerprint, "ok");
    const session: BoletoSession = {
      kind: "boleto",
      fingerprint: parsed.fingerprint,
      tipo: parsed.tipo,
      valorCentavos: parsed.valorCentavos,
      vencimentoISO: parsed.vencimentoISO,
      identificacao: null,
      mascara: parsed.mascaraExibicao,
      codigoBarras: parsed.codigoBarras,
      banco: parsed.banco,
    };
    // Dedup ANTES de qualquer pergunta.
    const dup = await findDuplicateBoleto(userId, parsed.codigoBarras);
    if (dup) {
      const linhas = [
        `Parece que este boleto (${parsed.mascaraExibicao}) já está nas suas contas pendentes${dup.nome ? ` como "${dup.nome}"` : ""}.`,
        "",
        "1. Ver conta existente",
        "2. Continuar mesmo assim",
        "3. Cancelar",
      ];
      const resp = linhas.join("\n");
      const claim = await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "bol_aguardando_duplicidade",
        session as never,
        resp,
      );
      if (!claim?.ok) {
        return {
          status: "erro",
          resposta: "Já estou processando esse boleto. Aguarde um instante.",
        };
      }
      logBoleto("awaiting_duplicate_decision", parsed.fingerprint, "duplicate");
      return { status: "pendente", resposta: resp };
    }
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: null, deps });
  }

  // ---- WA-C10.b: seleção de candidato (sessão veio de OCR multi-candidato) ----
  if (isBoletoSelecaoSession(sessao.session)) {
    return await processarSelecaoCandidato({
      userId,
      msg,
      texto,
      recebidaEm,
      sessao,
      deps,
    });
  }

  // ---- WA-C10.b: fallback manual (OCR só achou valor/vencimento) ----
  if (isBoletoManualSession(sessao.session)) {
    return await processarBoletoManual({
      userId,
      msg,
      texto,
      recebidaEm,
      decisao,
      sessao,
      deps,
    });
  }

  if (!isBoletoSession(sessao.session)) {
    return { status: "sem_pendencia", resposta: "" };
  }
  const session = sessao.session as BoletoSession;
  const current = sessao.status;

  if (current === "bol_aguardando_duplicidade") {
    if (/^1\b|ver\s+conta/i.test(t)) {
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      const r = 'Veja suas contas digitando "minhas contas". 📋';
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "cancelada",
        session as never,
        r,
      );
      return { status: "salva", resposta: r };
    }
    if (/^2\b|continuar/i.test(t)) {
      return await avancarFluxo({
        userId,
        msg,
        texto,
        recebidaEm,
        session,
        sessaoId: sessao.id,
        deps,
      });
    }
    if (/^3\b|cancelar/i.test(t)) {
      await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
      const r = "Cadastro cancelado. 👍";
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "cancelada",
        session as never,
        r,
      );
      return { status: "cancelada", resposta: r };
    }
    const r = "Não entendi. Responda 1, 2 ou 3.";
    await deps.atualizarSessao(sessao.id, current, session as never, r);
    return { status: "pendente", resposta: r };
  }

  if (current === "bol_aguardando_valor") {
    const v = parseValorFromText(t);
    if (!v) {
      const r = "Não consegui ler o valor. Ex.: R$ 120,00";
      await deps.atualizarSessao(sessao.id, current, session as never, r);
      return { status: "pendente", resposta: r };
    }
    session.valorCentavos = v;
    return await avancarFluxo({
      userId,
      msg,
      texto,
      recebidaEm,
      session,
      sessaoId: sessao.id,
      deps,
    });
  }

  if (current === "bol_aguardando_vencimento") {
    const d = parseDataFromText(t);
    if (!d) {
      const r = "Não consegui ler a data. Ex.: 10/07/2026";
      await deps.atualizarSessao(sessao.id, current, session as never, r);
      return { status: "pendente", resposta: r };
    }
    session.vencimentoISO = d;
    return await avancarFluxo({
      userId,
      msg,
      texto,
      recebidaEm,
      session,
      sessaoId: sessao.id,
      deps,
    });
  }

  if (current === "bol_aguardando_identificacao") {
    const nome = t.slice(0, 80).trim();
    if (nome.length < 2) {
      const r =
        "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade";
      await deps.atualizarSessao(sessao.id, current, session as never, r);
      return { status: "pendente", resposta: r };
    }
    session.identificacao = nome.charAt(0).toUpperCase() + nome.slice(1);
    return await avancarFluxo({
      userId,
      msg,
      texto,
      recebidaEm,
      session,
      sessaoId: sessao.id,
      deps,
    });
  }

  if (current === "bol_aguardando_confirmacao") {
    if (decisao === "confirm" || /^(1|sim|confirmar?|ok|confirmo)\b/i.test(t)) {
      return await persistir({
        userId,
        msg,
        texto,
        recebidaEm,
        session,
        sessaoId: sessao.id,
        deps,
      });
    }
    if (/^2\b|corrigir\s+valor|^valor\b/i.test(t)) {
      session.valorCentavos = null;
      return await avancarFluxo({
        userId,
        msg,
        texto,
        recebidaEm,
        session,
        sessaoId: sessao.id,
        deps,
      });
    }
    if (/^3\b|corrigir\s+venc|^venc/i.test(t)) {
      session.vencimentoISO = null;
      return await avancarFluxo({
        userId,
        msg,
        texto,
        recebidaEm,
        session,
        sessaoId: sessao.id,
        deps,
      });
    }
    if (/^4\b|corrigir\s+identi|identifica|nome/i.test(t)) {
      session.identificacao = null;
      return await avancarFluxo({
        userId,
        msg,
        texto,
        recebidaEm,
        session,
        sessaoId: sessao.id,
        deps,
      });
    }
    const r = "Não entendi. Responda 1 para confirmar, 2-4 para corrigir ou 5 para cancelar.";
    await deps.atualizarSessao(sessao.id, current, session as never, r);
    return { status: "pendente", resposta: r };
  }

  return { status: "sem_pendencia", resposta: "" };
}

async function avancarFluxo(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: BoletoSession;
  sessaoId: string | null;
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { session } = args;
  if (session.valorCentavos == null) {
    const r = session.vencimentoISO
      ? `Encontrei o vencimento em ${formatDateBR(session.vencimentoISO)}, mas preciso confirmar o valor. Qual é o valor desta conta?`
      : "Identifiquei um boleto válido, mas preciso confirmar alguns dados. Qual é o valor?";
    await transicao("bol_aguardando_valor", session, r, args);
    return { status: "pendente", resposta: r };
  }
  if (!session.vencimentoISO) {
    const r = `Encontrei o valor de ${formatBRL(session.valorCentavos)}. Qual é a data de vencimento? (ex.: 10/07/2026)`;
    await transicao("bol_aguardando_vencimento", session, r, args);
    return { status: "pendente", resposta: r };
  }
  if (!session.identificacao) {
    const r =
      "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade";
    await transicao("bol_aguardando_identificacao", session, r, args);
    return { status: "pendente", resposta: r };
  }
  const r = previewMessage(session);
  await transicao("bol_aguardando_confirmacao", session, r, args);
  return { status: "pendente", resposta: r };
}

async function transicao(
  status: string,
  session: BoletoSession,
  resposta: string,
  args: {
    userId: string;
    msg: WhatsAppMessageRow;
    texto: string;
    recebidaEm: string;
    sessaoId: string | null;
    deps: WhatsAppBoletoDeps;
  },
): Promise<void> {
  const { userId, msg, texto, recebidaEm, sessaoId, deps } = args;
  if (sessaoId) {
    await supabaseAdmin.from("whatsapp_messages").update({ status: "expirada" }).eq("id", sessaoId);
  }
  await deps.gravarSessao(
    userId,
    msg.telefone,
    msg.external_id,
    texto,
    recebidaEm,
    status,
    session as never,
    resposta,
  );
  logBoleto(
    status === "bol_aguardando_valor"
      ? "awaiting_value"
      : status === "bol_aguardando_vencimento"
        ? "awaiting_due_date"
        : status === "bol_aguardando_identificacao"
          ? "awaiting_identification"
          : "awaiting_confirmation",
    session.fingerprint,
    "ok",
  );
}

// ---------- dedup ----------

async function findDuplicateBoleto(
  userId: string,
  codigoBarras: string,
): Promise<{ id: string; nome: string | null } | null> {
  // Match exato por codigo_boleto + pendente, isolado por user_id (RLS reforça).
  const { data } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("id, nome, status, codigo_boleto")
    .eq("user_id", userId)
    .eq("codigo_boleto", codigoBarras)
    .eq("status", "pendente")
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, nome: (data.nome as string) ?? null };
}

// ---------- persistência ----------

/**
 * WA-C11 FASE 3B.2.D — PROVA DE MUTEX (Section 0).
 *
 * `persistir` (caminho automático / OCR) só é invocado a partir de:
 *   1. `avancarFluxo(...)` → última etapa quando `session.kind === "boleto"`;
 *   2. `processarSelecaoCandidato(...)` → após o usuário escolher um candidato
 *      de uma sessão `boleto_selecao`, promovendo-a a `boleto`.
 *
 * `persistirManual` (fallback OCR sem candidato válido) só é invocado a partir de:
 *   3. `processarBoletoManual(...)` quando `session.kind === "boleto_manual"`.
 *
 * O dispatcher em `processarBoleto` (linhas ~360-377) faz branch por
 * `session.kind` via `isBoletoSelecaoSession` / `isBoletoManualSession` /
 * `isBoletoSession`. Um objeto sessão tem exatamente UM `kind`, então
 * um único evento de mensagem atinge NO MÁXIMO um dos dois `persistir*`.
 *
 * O `external_id` da mensagem WhatsApp é único e a sessão é única por
 * telefone × external_id (garantido pelo motor de sessões). Portanto:
 *   - o discriminador de quota `bill_create_boleto:<fingerprint>` (auto) e
 *     `bill_create_boleto:<sessaoId>` (manual) NUNCA são consumidos pela
 *     mesma mensagem, e não há risco de bitributação.
 */
export async function persistir(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: BoletoSession;
  sessaoId: string;
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, deps } = args;
  if (session.valorCentavos == null || !session.vencimentoISO || !session.identificacao) {
    logBoleto("failed", session.fingerprint, "error");
    return { status: "erro", resposta: "Não consegui montar essa conta. Vamos começar de novo?" };
  }

  // WA-C11 3B.2.C.1 Block 5 — fail-closed sem `external_id`.
  const externalMessageId = msg.external_id ?? null;
  if (!externalMessageId || externalMessageId.trim().length === 0) {
    logBoleto("failed", session.fingerprint, "error");
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }

  // Claim atômico — bloqueia retries do webhook com mesmo external_id.
  const claim = await deps.gravarSessao(
    userId,
    msg.telefone,
    externalMessageId,
    texto,
    recebidaEm,
    "bol_persistindo",
    session as never,
    "",
  );
  if (!claim?.ok || !claim.sessionId) {
    logBoleto("failed", session.fingerprint, "error");
    return { status: "erro", resposta: "Já estou processando esse boleto. Aguarde um instante." };
  }
  const claimSessionId: string = claim.sessionId;

  // WA-C11 3B.2.C.1 Block 5 — quota financeira DEPOIS do claim, ANTES do insert.
  // discriminator = `session.fingerprint` (estável, não-PII, converge com o
  // caminho manual quando o mesmo boleto reaparecer).
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId,
    actionType: "bill_create_boleto",
    discriminator: session.fingerprint,
  });
  if (!gateOutcome.allowed) {
    try {
      await deps.atualizarSessao(claimSessionId, "erro", session as never, "quota_blocked");
    } catch {
      /* claim cleanup nunca quebra a resposta */
    }
    logBoleto("failed", session.fingerprint, "error");
    return { status: "erro", resposta: financialQuotaBlockedReply(gateOutcome) };
  }

  const [y, m] = session.vencimentoISO.split("-").map(Number);
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const valor = session.valorCentavos / 100;

  const row = {
    id,
    user_id: userId,
    nome: session.identificacao,
    valor,
    data_vencimento: session.vencimentoISO,
    categoria_id: null,
    observacao: null,
    recorrente: false,
    recorrencia_id: null,
    frequencia_recorrencia: null,
    data_inicio: null,
    data_fim: null,
    status: "pendente",
    mes: m,
    ano: y,
    mes_referencia: `${y}-${String(m).padStart(2, "0")}`,
    forma_pagamento: "boleto" as const,
    fornecedor_id: null,
    codigo_boleto: session.codigoBarras,
    banco_emissor: formatBancoEmissor(session.banco),
    created_at: nowIso,
    updated_at: nowIso,
  } as Record<string, unknown>;

  const { error: insErr } = await supabaseAdmin.from("contas_a_pagar").insert([row]);
  if (insErr) {
    logBoleto("failed", session.fingerprint, "error");
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }

  // Readback obrigatório.
  const { data: readback } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("id")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (!readback) {
    logBoleto("failed", session.fingerprint, "error");
    return {
      status: "erro",
      resposta: "Salvei mas não consegui confirmar. Pode me chamar de novo em alguns minutos?",
    };
  }

  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
  // Final: NUNCA persistimos o código bruto na sessão final — sai daqui.
  const finalSession: Record<string, unknown> = {
    kind: "boleto",
    fingerprint: session.fingerprint,
    tipo: session.tipo,
    valorCentavos: session.valorCentavos,
    vencimentoISO: session.vencimentoISO,
    identificacao: session.identificacao,
    mascara: session.mascara,
    contaId: id,
    status: "salva",
  };
  if (claimSessionId) {
    await deps.atualizarSessao(claimSessionId, "salva", finalSession as never, "ok");
  } else {
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "salva",
      finalSession as never,
      "ok",
    );
  }

  logBoleto("persisted", session.fingerprint, "ok");
  const vencFmt = formatDateBR(session.vencimentoISO);
  const aviso =
    session.vencimentoISO < todayLocalISO()
      ? `Conta marcada como pendente (vencida em ${vencFmt}). Confirme o valor atual antes de pagar.`
      : `Vencimento: ${vencFmt}.`;
  return {
    status: "salva",
    resposta: [
      "Pronto! Registrei seu boleto ✅",
      "",
      `${session.identificacao} — ${formatBRL(session.valorCentavos)}`,
      aviso,
    ].join("\n"),
  };
}

// ====================================================================
// WA-C10.b — Entradas e estados auxiliares para boleto a partir de mídia
// (imagem ou PDF). O parser determinístico (`tryParseBoleto`) continua
// sendo a única fonte de verdade; o OCR só sugere candidatos.
// ====================================================================

/**
 * Inicia o fluxo de boleto a partir de candidatos extraídos por OCR de
 * imagem/PDF. NÃO recebe nem persiste base64. Os caminhos possíveis:
 *
 *  - 1 candidato validado → cai no fluxo normal (`avancarFluxo`),
 *    igual ao caminho de texto, preservando dedup + readback.
 *  - N candidatos validados → cria sessão `bol_aguardando_selecao_candidato`.
 *  - 0 candidatos validados mas houve sugestão (valor/vencimento) → entra
 *    no fallback manual (`iniciarBoletoManualFallback`).
 *  - 0 candidatos e nenhuma sugestão → o caller decide a resposta.
 *
 * Em todos os casos, o código bruto fica APENAS na sessão server-side
 * (`codigoBarras`) e é zerado em cancelamento / persistido em
 * contas_a_pagar.codigo_boleto na conclusão.
 */
export async function iniciarBoletoDeMidia(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  origem: "imagem" | "pdf";
  candidatos: BoletoParsed[];
  identificacaoSugerida: string | null;
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, origem, candidatos, identificacaoSugerida, deps } = args;
  if (candidatos.length === 0) {
    // O caller decide a resposta (nenhum candidato / fallback manual).
    return { status: "sem_pendencia", resposta: "" };
  }
  if (candidatos.length === 1) {
    const parsed = candidatos[0];
    const ident =
      identificacaoSugerida && identificacaoSugerida.trim().length >= 2
        ? identificacaoSugerida.trim().slice(0, 80)
        : null;
    const session: BoletoSession = {
      kind: "boleto",
      fingerprint: parsed.fingerprint,
      tipo: parsed.tipo,
      valorCentavos: parsed.valorCentavos,
      vencimentoISO: parsed.vencimentoISO,
      identificacao: ident ? ident.charAt(0).toUpperCase() + ident.slice(1) : null,
      mascara: parsed.mascaraExibicao,
      codigoBarras: parsed.codigoBarras,
      banco: parsed.banco,
      origem,
    };
    // Dedup determinístico antes de qualquer pergunta — mesmo critério
    // do fluxo por texto, garantindo paridade com WA-C10.a.
    const dup = await findDuplicateBoleto(userId, parsed.codigoBarras);
    if (dup) {
      const linhas = [
        `Encontrei este boleto (${parsed.mascaraExibicao}) na imagem, mas ele já está nas suas contas pendentes${dup.nome ? ` como "${dup.nome}"` : ""}.`,
        "",
        "1. Ver conta existente",
        "2. Continuar mesmo assim",
        "3. Cancelar",
      ];
      const resp = linhas.join("\n");
      const claim = await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "bol_aguardando_duplicidade",
        session as never,
        resp,
      );
      if (!claim?.ok) {
        return {
          status: "erro",
          resposta: "Já estou processando esse boleto. Aguarde um instante.",
        };
      }
      logBoleto("awaiting_duplicate_decision", parsed.fingerprint, "duplicate");
      return { status: "pendente", resposta: resp };
    }
    logBoleto("detected", parsed.fingerprint, "ok");
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: null, deps });
  }
  // ----- N candidatos: persistir sessão de seleção -----
  const session: BoletoSelecaoSession = {
    kind: "boleto_selecao",
    origem,
    candidatos: candidatos.map((p) => ({
      fingerprint: p.fingerprint,
      mascara: p.mascaraExibicao,
      codigoBarras: p.codigoBarras,
      tipo: p.tipo,
      valorCentavos: p.valorCentavos,
      vencimentoISO: p.vencimentoISO,
      banco: p.banco,
    })),
    identificacaoSugerida,
  };
  const linhas = ["Encontrei mais de um boleto neste arquivo. Qual você quer cadastrar?", ""];
  candidatos.forEach((p, i) => {
    const extras = [
      p.valorCentavos != null ? formatBRL(p.valorCentavos) : null,
      p.vencimentoISO ? formatDateBR(p.vencimentoISO) : null,
    ]
      .filter(Boolean)
      .join(" • ");
    linhas.push(`${i + 1}. Boleto ${p.mascaraExibicao}${extras ? ` (${extras})` : ""}`);
  });
  linhas.push(`${candidatos.length + 1}. Nenhum deles`);
  const resp = linhas.join("\n");
  const claim = await deps.gravarSessao(
    userId,
    msg.telefone,
    msg.external_id,
    texto,
    recebidaEm,
    "bol_aguardando_selecao_candidato",
    session as never,
    resp,
  );
  if (!claim?.ok) {
    return { status: "erro", resposta: "Já estou processando esse boleto. Aguarde um instante." };
  }
  return { status: "pendente", resposta: resp };
}

async function processarSelecaoCandidato(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  sessao: { id: string; status: string; session: unknown; recebida_em: string };
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, sessao, deps } = args;
  const sel = sessao.session as BoletoSelecaoSession;
  const m = texto.trim().match(/^(\d{1,2})/);
  const idx = m ? Number(m[1]) - 1 : -1;
  if (idx === sel.candidatos.length) {
    // "Nenhum deles".
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    const r =
      "Tudo bem, descartei essa imagem. Se quiser, envie outra foto/PDF ou cole a linha digitável.";
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "cancelada",
      { kind: "boleto_selecao", origem: sel.origem, descartado: true } as never,
      r,
    );
    return { status: "cancelada", resposta: r };
  }
  if (idx < 0 || idx >= sel.candidatos.length) {
    const r = `Não entendi. Responda com o número da opção (1 a ${sel.candidatos.length + 1}).`;
    await deps.atualizarSessao(sessao.id, sessao.status, sel as never, r);
    return { status: "pendente", resposta: r };
  }
  const chosen = sel.candidatos[idx];
  // Marca a sessão antiga como expirada antes de abrir a nova.
  await deps.atualizarSessao(sessao.id, "expirada", { kind: "boleto_selecao" } as never, "");
  // Reusa exatamente o caminho de 1-candidato.
  const parsed: BoletoParsed = {
    fingerprint: chosen.fingerprint,
    tipo: chosen.tipo,
    valorCentavos: chosen.valorCentavos,
    vencimentoISO: chosen.vencimentoISO,
    codigoBarras: chosen.codigoBarras,
    mascaraExibicao: chosen.mascara,
    banco: chosen.banco,
  } as BoletoParsed;
  return await iniciarBoletoDeMidia({
    userId,
    msg,
    texto,
    recebidaEm,
    origem: sel.origem,
    candidatos: [parsed],
    identificacaoSugerida: sel.identificacaoSugerida,
    deps,
  });
}

/**
 * Inicia o fallback manual: OCR achou apenas valor/vencimento mas nenhum
 * candidato validado. Cria uma conta a pagar **sem `codigo_boleto`** —
 * isso fica explícito para o usuário (e para futuras consultas: a conta
 * não é pagável pela linha digitável).
 */
export async function iniciarBoletoManualFallback(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  origem: "imagem" | "pdf";
  valorCentavos: number | null;
  vencimentoISO: string | null;
  identificacaoSugerida: string | null;
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const {
    userId,
    msg,
    texto,
    recebidaEm,
    origem,
    valorCentavos,
    vencimentoISO,
    identificacaoSugerida,
    deps,
  } = args;
  const session: BoletoManualSession = {
    kind: "boleto_manual",
    origem,
    valorCentavos,
    vencimentoISO,
    identificacao:
      identificacaoSugerida && identificacaoSugerida.trim().length >= 2
        ? identificacaoSugerida.trim().slice(0, 80)
        : null,
  };
  const resp = manualFallbackPrompt(session);
  const claim = await deps.gravarSessao(
    userId,
    msg.telefone,
    msg.external_id,
    texto,
    recebidaEm,
    "bol_aguardando_confirmacao_manual",
    session as never,
    resp,
  );
  if (!claim?.ok) {
    return { status: "erro", resposta: "Já estou processando esse arquivo. Aguarde um instante." };
  }
  return { status: "pendente", resposta: resp };
}

function manualFallbackPrompt(s: BoletoManualSession): string {
  const linhas = [
    "Encontrei dados, mas não consegui validar a linha digitável do boleto.",
    "Posso registrar como uma conta a pagar manual (sem código copiável):",
    "",
    `• Valor: ${s.valorCentavos != null ? formatBRL(s.valorCentavos) : "(a confirmar)"}`,
    `• Vencimento: ${s.vencimentoISO ? formatDateBR(s.vencimentoISO) : "(a confirmar)"}`,
    `• Identificação: ${s.identificacao ?? "(a confirmar)"}`,
    "",
    "1. Confirmar",
    "2. Corrigir valor",
    "3. Corrigir vencimento",
    "4. Corrigir identificação",
    "5. Cancelar",
  ];
  return linhas.join("\n");
}

async function processarBoletoManual(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string };
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const s = sessao.session as BoletoManualSession;
  const t = texto.trim();

  // Sub-fluxos de coleta (valor / vencimento / identificacao).
  if (sessao.status === "bol_aguardando_valor") {
    const v = parseValorFromText(t);
    if (!v) {
      const r = "Não consegui ler o valor. Ex.: R$ 120,00";
      await deps.atualizarSessao(sessao.id, sessao.status, s as never, r);
      return { status: "pendente", resposta: r };
    }
    s.valorCentavos = v;
    return await transicionarManual(s, args);
  }
  if (sessao.status === "bol_aguardando_vencimento") {
    const d = parseDataFromText(t);
    if (!d) {
      const r = "Não consegui ler a data. Ex.: 10/07/2026";
      await deps.atualizarSessao(sessao.id, sessao.status, s as never, r);
      return { status: "pendente", resposta: r };
    }
    s.vencimentoISO = d;
    return await transicionarManual(s, args);
  }
  if (sessao.status === "bol_aguardando_identificacao") {
    const nome = t.slice(0, 80).trim();
    if (nome.length < 2) {
      const r =
        "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade";
      await deps.atualizarSessao(sessao.id, sessao.status, s as never, r);
      return { status: "pendente", resposta: r };
    }
    s.identificacao = nome.charAt(0).toUpperCase() + nome.slice(1);
    return await transicionarManual(s, args);
  }

  // Estado normal: bol_aguardando_confirmacao_manual.
  if (decisao === "confirm" || /^(1|sim|confirmar?|ok|confirmo)\b/i.test(t)) {
    if (s.valorCentavos == null) {
      s.valorCentavos = null;
      return await transicionarManual(
        s,
        args,
        "bol_aguardando_valor",
        "Qual é o valor desta conta? (ex.: R$ 120,00)",
      );
    }
    if (!s.vencimentoISO) {
      return await transicionarManual(
        s,
        args,
        "bol_aguardando_vencimento",
        "Qual é a data de vencimento? (ex.: 10/07/2026)",
      );
    }
    if (!s.identificacao) {
      return await transicionarManual(
        s,
        args,
        "bol_aguardando_identificacao",
        "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade",
      );
    }
    return await persistirManual({
      userId,
      msg,
      texto,
      recebidaEm,
      session: s,
      sessaoId: sessao.id,
      deps,
    });
  }
  if (/^2\b|corrigir\s+valor|^valor\b/i.test(t)) {
    s.valorCentavos = null;
    return await transicionarManual(
      s,
      args,
      "bol_aguardando_valor",
      "Qual é o valor desta conta? (ex.: R$ 120,00)",
    );
  }
  if (/^3\b|corrigir\s+venc|^venc/i.test(t)) {
    s.vencimentoISO = null;
    return await transicionarManual(
      s,
      args,
      "bol_aguardando_vencimento",
      "Qual é a data de vencimento? (ex.: 10/07/2026)",
    );
  }
  if (/^4\b|corrigir\s+identi|identifica|nome/i.test(t)) {
    s.identificacao = null;
    return await transicionarManual(
      s,
      args,
      "bol_aguardando_identificacao",
      "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade",
    );
  }
  const r = "Não entendi. Responda 1 para confirmar, 2-4 para corrigir ou 5 para cancelar.";
  await deps.atualizarSessao(sessao.id, sessao.status, s as never, r);
  return { status: "pendente", resposta: r };
}

async function transicionarManual(
  s: BoletoManualSession,
  args: {
    userId: string;
    msg: WhatsAppMessageRow;
    texto: string;
    recebidaEm: string;
    sessao: { id: string; status: string; session: unknown; recebida_em: string };
    deps: WhatsAppBoletoDeps;
  },
  override?: string,
  prompt?: string,
): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, sessao, deps } = args;
  // Se não veio override, avança automaticamente para a próxima pergunta.
  if (!override) {
    if (s.valorCentavos == null) {
      const r = "Qual é o valor desta conta? (ex.: R$ 120,00)";
      await sessaoExpirar(sessao.id, deps);
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "bol_aguardando_valor",
        s as never,
        r,
      );
      return { status: "pendente", resposta: r };
    }
    if (!s.vencimentoISO) {
      const r = "Qual é a data de vencimento? (ex.: 10/07/2026)";
      await sessaoExpirar(sessao.id, deps);
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "bol_aguardando_vencimento",
        s as never,
        r,
      );
      return { status: "pendente", resposta: r };
    }
    if (!s.identificacao) {
      const r =
        "Como você quer identificar essa conta?\nEx.: Internet, Condomínio, Energia, Faculdade";
      await sessaoExpirar(sessao.id, deps);
      await deps.gravarSessao(
        userId,
        msg.telefone,
        msg.external_id,
        texto,
        recebidaEm,
        "bol_aguardando_identificacao",
        s as never,
        r,
      );
      return { status: "pendente", resposta: r };
    }
    const r = manualFallbackPrompt(s);
    await sessaoExpirar(sessao.id, deps);
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "bol_aguardando_confirmacao_manual",
      s as never,
      r,
    );
    return { status: "pendente", resposta: r };
  }
  await sessaoExpirar(sessao.id, deps);
  const r = prompt ?? manualFallbackPrompt(s);
  await deps.gravarSessao(
    userId,
    msg.telefone,
    msg.external_id,
    texto,
    recebidaEm,
    override,
    s as never,
    r,
  );
  return { status: "pendente", resposta: r };
}

async function sessaoExpirar(id: string, _deps: WhatsAppBoletoDeps): Promise<void> {
  await supabaseAdmin.from("whatsapp_messages").update({ status: "expirada" }).eq("id", id);
}

/**
 * WA-C11 FASE 3B.2.D — PROVA DE MUTEX (Section 0).
 * Ver comentário completo em `persistir` acima. Este caminho só é
 * atingido quando `session.kind === "boleto_manual"`, mutuamente
 * exclusivo com o caminho automático `persistir` (kind = "boleto").
 */
export async function persistirManual(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: BoletoManualSession;
  sessaoId: string;
  deps: WhatsAppBoletoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessaoId, deps } = args;
  if (session.valorCentavos == null || !session.vencimentoISO || !session.identificacao) {
    return { status: "erro", resposta: "Não consegui montar essa conta. Vamos começar de novo?" };
  }

  // WA-C11 3B.2.C.1 Block 5 — fail-closed sem `external_id`.
  const externalMessageId = msg.external_id ?? null;
  if (!externalMessageId || externalMessageId.trim().length === 0) {
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }

  // Claim atômico — bloqueia retries do webhook.
  const claim = await deps.gravarSessao(
    userId,
    msg.telefone,
    externalMessageId,
    texto,
    recebidaEm,
    "bol_persistindo",
    session as never,
    "",
  );
  if (!claim?.ok || !claim.sessionId) {
    return { status: "erro", resposta: "Já estou processando essa conta. Aguarde um instante." };
  }
  const claimSessionId: string = claim.sessionId;

  // WA-C11 3B.2.C.1 Block 5 — quota financeira DEPOIS do claim, ANTES do insert.
  // discriminator = `sessaoId` (fallback manual não tem fingerprint;
  // sessaoId identifica a intenção nesta sessão).
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId,
    actionType: "bill_create_boleto",
    discriminator: sessaoId,
  });
  if (!gateOutcome.allowed) {
    try {
      await deps.atualizarSessao(claimSessionId, "erro", session as never, "quota_blocked");
    } catch {
      /* cleanup jamais quebra a resposta */
    }
    return { status: "erro", resposta: financialQuotaBlockedReply(gateOutcome) };
  }

  const [y, m] = session.vencimentoISO.split("-").map(Number);
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const row = {
    id,
    user_id: userId,
    nome: session.identificacao,
    valor: session.valorCentavos / 100,
    data_vencimento: session.vencimentoISO,
    categoria_id: null,
    observacao: null,
    recorrente: false,
    recorrencia_id: null,
    frequencia_recorrencia: null,
    data_inicio: null,
    data_fim: null,
    status: "pendente",
    mes: m,
    ano: y,
    mes_referencia: `${y}-${String(m).padStart(2, "0")}`,
    forma_pagamento: "boleto" as const,
    fornecedor_id: null,
    codigo_boleto: null,
    created_at: nowIso,
    updated_at: nowIso,
  } as Record<string, unknown>;
  const { error: insErr } = await supabaseAdmin.from("contas_a_pagar").insert([row]);
  if (insErr) {
    return {
      status: "erro",
      resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?",
    };
  }
  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
  const finalSession: Record<string, unknown> = {
    kind: "boleto_manual",
    origem: session.origem,
    valorCentavos: session.valorCentavos,
    vencimentoISO: session.vencimentoISO,
    identificacao: session.identificacao,
    contaId: id,
    status: "salva",
  };
  if (claimSessionId) {
    await deps.atualizarSessao(claimSessionId, "salva", finalSession as never, "ok");
  } else {
    await deps.gravarSessao(
      userId,
      msg.telefone,
      msg.external_id,
      texto,
      recebidaEm,
      "salva",
      finalSession as never,
      "ok",
    );
  }
  const vencFmt = formatDateBR(session.vencimentoISO);
  const aviso =
    session.vencimentoISO < todayLocalISO()
      ? `Conta marcada como pendente (vencida em ${vencFmt}). Confirme antes de pagar.`
      : `Vencimento: ${vencFmt}.`;
  return {
    status: "salva",
    resposta: [
      "Pronto! Registrei sua conta a pagar ✅",
      "(Sem código copiável — esse boleto entrou como conta manual.)",
      "",
      `${session.identificacao} — ${formatBRL(session.valorCentavos)}`,
      aviso,
    ].join("\n"),
  };
}
