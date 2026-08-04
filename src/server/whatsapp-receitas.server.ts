/**
 * Fase WA-G1 — Lançamento de RECEITAS via WhatsApp.
 *
 * Reaproveita a tabela `whatsapp_messages` (mesma estratégia das despesas)
 * para persistir a sessão; usa a tabela `receitas` já existente, incluindo
 * o padrão de recorrência via `recorrencia_id` + várias linhas (uma por
 * ocorrência), exatamente como `addReceita` faz no site.
 *
 * Não cria tabelas novas, não exige IA externa e não muda o fluxo de
 * despesas. A persistência aplica a quota mensal de free_ads no servidor,
 * espelhando a regra do site (10 receitas / mês para free_ads, recorrente
 * apenas em planos pagos).
 */
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
import { whatsappMessages as M } from "./whatsapp-messages";
import { getSubscriptionForUserIdentity } from "./subscription.server";
import type { TipoReceita } from "@/lib/types";
import { validateFinancialAmount } from "@/lib/financial-limits";
// WA-C11 3B.2.C.1 Block 3 — quota financeira do WhatsApp para receitas
// (única e recorrente). Ordem: sessão em confirmação → gate → escrita.
// Fail-closed sem `external_id` (idempotência da quota depende dele).
import {
  assertFinancialActionQuotaForWhatsApp,
  financialQuotaBlockedReply,
} from "@/server/whatsapp-financial-quota-gate.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

const APP_TZ = "America/Sao_Paulo";
const FREE_ADS_RECEITAS_CAP = 10;

// ---------- estados ----------

export const RECEITA_PENDING_STATES = [
  "rec_aguardando_tipo",
  "rec_aguardando_valor",
  "rec_aguardando_recorrencia",
  "rec_aguardando_frequencia",
  "rec_aguardando_dia",
  "rec_aguardando_categoria",
  "rec_aguardando_confirmacao",
] as const;
export type ReceitaStatus = (typeof RECEITA_PENDING_STATES)[number];

export type Frequencia = "mensal" | "semanal" | "quinzenal";

export type ReceitaSession = {
  kind: "receita";
  tipo?: TipoReceita;
  tipoLabel?: string;
  descricao?: string;
  valor?: number;
  data?: string; // YYYY-MM-DD
  recorrente?: boolean;
  frequencia?: Frequencia;
  diaMes?: number; // 1..31
  diaSemana?: number; // 0..6 (dom..sab)
  mensagemOriginal: string;
};

export function isReceitaSession(parsed: unknown): parsed is ReceitaSession {
  return !!parsed && typeof parsed === "object" && (parsed as { kind?: string }).kind === "receita";
}

// ---------- helpers ----------

function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  if (iso === todayLocalISO()) return "Hoje";
  return `${d}/${m}/${y}`;
}

// ---------- detecção de intenção ----------

/**
 * Palavras-chave de receita. Não acionam quando a mensagem é claramente
 * sobre um gasto (gastei/paguei/comprei/débito etc.).
 */
const RECEITA_KEYWORDS = [
  "recebi",
  "receber",
  "ganhei",
  "ganho",
  "renda",
  "receita",
  "salario",
  "freelancer",
  "freela",
  "freelance",
  "comissao",
  "venda",
  "vendi",
  "cliente pagou",
  "entrada",
  "entrou",
  "pagamento recebido",
  "bonus",
  "reembolso",
];

const GASTO_HINT_PATTERNS = [/\bgastei\b/, /\bpaguei\b/, /\bcomprei\b/, /\bdebitou\b/];

export function isReceitaIntent(texto: string): boolean {
  const t = normalize(texto);
  if (!t) return false;
  for (const pat of GASTO_HINT_PATTERNS) if (pat.test(t)) return false;
  // "quero lançar uma renda" / "lançar receita"
  if (/\b(quero )?lan[cç]ar (uma )?(renda|receita)\b/.test(t)) return true;
  for (const kw of RECEITA_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(t)) return true;
  }
  return false;
}

// ---------- parse de tipo ----------

const TIPO_KEYWORDS: Array<{ tipo: TipoReceita; label: string; words: string[] }> = [
  { tipo: "salario", label: "Salário", words: ["salario"] },
  { tipo: "freelance", label: "Freelance", words: ["freelancer", "freela", "freelance"] },
  { tipo: "comissao", label: "Comissão", words: ["comissao"] },
  { tipo: "venda", label: "Venda", words: ["venda", "vendi"] },
  { tipo: "reembolso", label: "Reembolso", words: ["reembolso"] },
  { tipo: "pix", label: "Pix recebido", words: ["pix"] },
  { tipo: "bonus", label: "Bônus", words: ["bonus"] },
];

export function detectTipoReceita(texto: string): { tipo: TipoReceita; label: string } | null {
  const t = normalize(texto);
  for (const k of TIPO_KEYWORDS) {
    for (const w of k.words) {
      if (new RegExp(`\\b${w}\\b`).test(t)) return { tipo: k.tipo, label: k.label };
    }
  }
  return null;
}

// ---------- parse de valor ----------

export function parseValor(texto: string): number | null {
  const t = (texto || "").toLowerCase().replace(/r\$\s*/g, "");
  // "4 mil" / "4mil"
  const milMatch = t.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (milMatch) {
    const n = Number(milMatch[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000 * 100) / 100;
  }
  // Brazilian thousand groups: "1.234", "12.345,67"
  const brGrouped = t.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)/);
  if (brGrouped) {
    let raw = brGrouped[1].replace(/\./g, "");
    if (raw.includes(",")) raw = raw.replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  // Comma decimal: "1234,56"
  const decBr = t.match(/(\d+,\d{1,2})/);
  if (decBr) {
    const n = Number(decBr[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  // Plain / US decimal: "1234" / "12.50"
  const plain = t.match(/(\d+(?:\.\d{1,2})?)/);
  if (plain) {
    const n = Number(plain[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

// ---------- parse de frequência ----------

export function parseFrequencia(texto: string): Frequencia | null {
  const t = normalize(texto);
  if (!t) return null;
  if (/\b(15 dias|quinzenal|a cada 15|quinze dias)\b/.test(t)) return "quinzenal";
  if (/\b(toda semana|semanal|semanalmente|por semana|cada semana)\b/.test(t)) return "semanal";
  if (/\b(todo mes|mensal|mensalmente|por mes|cada mes|todos os meses)\b/.test(t)) return "mensal";
  return null;
}

const DIA_SEMANA_MAP: Record<string, number> = {
  domingo: 0,
  dom: 0,
  segunda: 1,
  seg: 1,
  "segunda-feira": 1,
  terca: 2,
  ter: 2,
  "terca-feira": 2,
  quarta: 3,
  qua: 3,
  "quarta-feira": 3,
  quinta: 4,
  qui: 4,
  "quinta-feira": 4,
  sexta: 5,
  sex: 5,
  "sexta-feira": 5,
  sabado: 6,
  sab: 6,
};

export function parseDiaSemana(texto: string): number | null {
  const t = normalize(texto).replace(/[^\w\s-]/g, "");
  for (const [k, v] of Object.entries(DIA_SEMANA_MAP)) {
    if (new RegExp(`\\b${k}\\b`).test(t)) return v;
  }
  return null;
}

export function parseDiaMes(texto: string): number | null {
  const m = (texto || "").match(/\b([0-3]?\d)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

// ---------- descrição livre quando tipo veio explícito ----------

/** "Recebi 4000 de salário" → descricao = "Salário". */
function descricaoFromTipo(label: string): string {
  return label;
}

// ---------- (helpers de pré-projeção removidos em WA-R1-Fix) ----------

// WA-R1-Fix: a função `gerarDatasRecorrencia` foi removida. A criação de
// receitas recorrentes agora é feita atomicamente pela RPC
// `create_recurring_income`, que cria 1 receita atual + 1 recorrência ativa
// (sem pré-projeção de 12 meses).

export function resumoRecorrencia(s: ReceitaSession): string {
  if (!s.recorrente) return "Não";
  if (s.frequencia === "mensal") return `Todo mês, dia ${s.diaMes}`;
  if (s.frequencia === "semanal") {
    const nomes = [
      "domingo",
      "segunda-feira",
      "terça-feira",
      "quarta-feira",
      "quinta-feira",
      "sexta-feira",
      "sábado",
    ];
    return `Toda semana, ${nomes[s.diaSemana ?? 0]}`;
  }
  if (s.frequencia === "quinzenal") return "A cada 15 dias";
  return "Sim";
}

// ---------- plano / quota ----------

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const res = await supabaseAdmin.auth.admin.getUserById(userId);
    return res?.data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function getUserPlan(userId: string): Promise<string> {
  const email = await getUserEmail(userId);
  const sub = await getSubscriptionForUserIdentity({ userId, email, repairLink: false });
  return sub?.plan ?? "free_ads";
}

async function contarReceitasMesAtual(userId: string): Promise<number> {
  const hoje = todayLocalISO();
  const monthStart = hoje.slice(0, 8) + "01";
  const { data } = await supabaseAdmin
    .from("receitas")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("data", monthStart);
  return Array.isArray(data) ? data.length : 0;
}

// ---------- persistir ----------

export type PersistirReceitaResult =
  | { ok: true; resposta: string; receitaId: string; recorrenciaId?: string }
  | { ok: false; resposta: string };

function genId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * WA-R1-Fix — Persistência atômica de receita.
 *
 * Receita única: 1 row em `receitas` (sem `recorrencia_id`).
 * Receita recorrente: RPC `create_recurring_income` cria exatamente
 *   1 row em `receitas` (data informada = data real de recebimento)
 *   + 1 row em `recorrencias` (ativa, próxima cobrança estritamente
 *   futura). Atômico: falha em qualquer etapa não deixa parcial.
 *
 * Readback obrigatório: confirma que ambos os registros existem e
 * que `receita.recorrencia_id` aponta para uma `recorrencias.id` real.
 */
export async function persistirReceita(
  userId: string,
  s: ReceitaSession,
  externalMessageId?: string,
): Promise<PersistirReceitaResult> {
  // WA-C11 3B.2.C.1 Block 3 — Fail-closed sem external_id: a idempotência
  // da quota financeira depende dele. Não consulta plano, não abre RPC,
  // não insere. Log sanitizado (sem PII).
  if (!externalMessageId || externalMessageId.trim().length === 0) {
    console.error("[whatsapp] persistirReceita missing externalMessageId");
    return { ok: false, resposta: M.receita.erroAoSalvar() };
  }

  const plan = await getUserPlan(userId);
  const isFreeAds = plan === "free_ads" || plan === "free" || plan === "sem_assinatura";

  if (s.recorrente && isFreeAds) {
    return { ok: false, resposta: M.receita.recorrenteIndisponivel() };
  }
  if (isFreeAds) {
    const usados = await contarReceitasMesAtual(userId);
    if (usados >= FREE_ADS_RECEITAS_CAP) {
      return { ok: false, resposta: M.receita.quotaExcedida() };
    }
  }

  // WA-C11 3B.2.C.1 Block 3 — quota financeira ANTES da escrita real.
  // Uma mensagem = uma unidade de quota, mesmo que a RPC recorrente crie
  // simultaneamente 1 receita + 1 recorrência (comportamento comercial:
  // uma única "ação financeira" por confirmação do usuário).
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId,
    actionType: s.recorrente ? "income_recurring" : "income_single",
  });
  if (!gateOutcome.allowed) {
    return { ok: false, resposta: financialQuotaBlockedReply(gateOutcome) };
  }

  const tipo: TipoReceita = s.tipo ?? "outros";
  const descricao = (s.descricao || s.tipoLabel || "Renda").trim();
  const valor = Number(s.valor || 0);
  // Teto compartilhado (MAX_FINANCIAL_ENTRY_AMOUNT) — mesma regra do cliente
  // e da constraint receitas_valor_valid_range_check.
  if (!validateFinancialAmount(valor).ok) {
    return { ok: false, resposta: M.receita.erroAoSalvar() };
  }

  const baseData = s.data || todayLocalISO();
  const valorFmt = formatBRL(valor);
  const tipoLabel = s.tipoLabel || descricao;

  // -------- RECORRENTE: RPC atômica (1 receita + 1 recorrência) --------
  if (s.recorrente) {
    if (s.frequencia === "mensal" && (!s.diaMes || s.diaMes < 1 || s.diaMes > 31)) {
      return { ok: false, resposta: M.receita.erroAoSalvar() };
    }

    const { data, error } = await supabaseAdmin.rpc("create_recurring_income", {
      p_user_id: userId,
      p_descricao: descricao,
      p_valor: valor,
      p_data: baseData,
      p_tipo: tipo,
      p_frequencia: s.frequencia ?? "mensal",
      p_dia_mes: s.frequencia === "mensal" ? (s.diaMes ?? null) : null,
      p_dia_semana: s.frequencia === "semanal" ? (s.diaSemana ?? null) : null,
      p_observacao: null,
      p_origem: "whatsapp",
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      console.error("[whatsapp] receita recorrente RPC failed", error);
      return { ok: false, resposta: M.receita.erroAoSalvar() };
    }
    const row = data[0] as { receita_id?: string; recorrencia_id?: string };
    const receitaId = row?.receita_id;
    const recorrenciaId = row?.recorrencia_id;
    if (!receitaId || !recorrenciaId) {
      console.error("[whatsapp] receita recorrente RPC retornou shape inesperado", row);
      return { ok: false, resposta: M.receita.erroAoSalvar() };
    }

    // -------- Readback Guard --------
    const [recCheck, recoCheck] = await Promise.all([
      supabaseAdmin
        .from("receitas")
        .select("id, recorrencia_id, valor, data, user_id")
        .eq("id", receitaId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("recorrencias")
        .select("id, frequencia, proxima_cobranca, status, user_id")
        .eq("id", recorrenciaId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const recRow = recCheck?.data as {
      id: string;
      recorrencia_id: string | null;
      valor: number;
      data: string;
      user_id: string;
    } | null;
    const recoRow = recoCheck?.data as {
      id: string;
      frequencia: string;
      proxima_cobranca: string | null;
      status: string;
      user_id: string;
    } | null;
    if (
      !recRow ||
      !recoRow ||
      recRow.recorrencia_id !== recorrenciaId ||
      recoRow.status !== "ativa" ||
      !recoRow.proxima_cobranca
    ) {
      console.error("[whatsapp] receita recorrente readback failed", { recRow, recoRow });
      return { ok: false, resposta: M.receita.erroAoSalvar() };
    }

    return {
      ok: true,
      resposta: M.receita.salvaRecorrente({
        valor: valorFmt,
        descricao,
        resumoRecorrencia: resumoRecorrencia(s),
      }),
      receitaId,
      recorrenciaId,
    };
  }

  // -------- ÚNICA --------
  const [y, m] = baseData.split("-").map(Number);
  const primeiroReceitaId = genId();
  const row = {
    id: primeiroReceitaId,
    user_id: userId,
    descricao,
    valor,
    data: baseData,
    tipo,
    recorrente: false,
    mes: m,
    ano: y,
    origem: "whatsapp",
  };
  const { error } = await supabaseAdmin.from("receitas").insert(row);
  if (error) {
    console.error("[whatsapp] receita insert failed", error);
    return { ok: false, resposta: M.receita.erroAoSalvar() };
  }

  return {
    ok: true,
    resposta: M.receita.salvaSimples({ valor: valorFmt, descricao, tipo: tipoLabel }),
    receitaId: primeiroReceitaId,
  };
}

// ---------- montagem de resposta da etapa ----------

export type StepResult = {
  status: ReceitaStatus | "salva" | "cancelada" | "pendente";
  session: ReceitaSession;
  resposta: string;
};

export function buildConfirmacao(s: ReceitaSession): string {
  return M.receita.resumoConfirmacao({
    descricao: s.descricao || s.tipoLabel || "Renda",
    tipo: s.tipoLabel || "Outros",
    valor: formatBRL(Number(s.valor || 0)),
    data: formatDataBR(s.data || todayLocalISO()),
    resumoRecorrencia: resumoRecorrencia(s),
  });
}

/**
 * Parse inicial: tenta extrair tipo+valor a partir da mensagem.
 * Decide o próximo estado.
 */
export function startReceitaFromText(texto: string): StepResult {
  const tipoMatch = detectTipoReceita(texto);
  const valor = parseValor(texto);
  const base: ReceitaSession = {
    kind: "receita",
    mensagemOriginal: texto,
    data: todayLocalISO(),
  };
  if (tipoMatch) {
    base.tipo = tipoMatch.tipo;
    base.tipoLabel = tipoMatch.label;
    base.descricao = descricaoFromTipo(tipoMatch.label);
  }
  if (valor !== null) base.valor = valor;

  if (!base.tipo) {
    return {
      status: "rec_aguardando_tipo",
      session: base,
      resposta: M.receita.perguntaTipo(),
    };
  }
  if (!base.valor) {
    return {
      status: "rec_aguardando_valor",
      session: base,
      resposta: M.receita.perguntaValor(),
    };
  }
  return {
    status: "rec_aguardando_recorrencia",
    session: base,
    resposta: M.receita.perguntaRecorrencia(),
  };
}

export function nextStepReceita(
  current: ReceitaStatus,
  session: ReceitaSession,
  texto: string,
  resposta: "confirm" | "cancel" | "outro",
): StepResult {
  const s: ReceitaSession = { ...session };

  if (current === "rec_aguardando_tipo") {
    const t = detectTipoReceita(texto);
    if (!t) {
      // Resposta livre vira descrição com tipo "outros".
      s.tipo = "outros";
      s.tipoLabel = "Outros";
      s.descricao = texto.trim().slice(0, 60) || "Renda";
    } else {
      s.tipo = t.tipo;
      s.tipoLabel = t.label;
      s.descricao = descricaoFromTipo(t.label);
    }
    if (!s.valor) {
      return { status: "rec_aguardando_valor", session: s, resposta: M.receita.perguntaValor() };
    }
    return {
      status: "rec_aguardando_recorrencia",
      session: s,
      resposta: M.receita.perguntaRecorrencia(),
    };
  }

  if (current === "rec_aguardando_valor") {
    const v = parseValor(texto);
    if (!v) {
      return { status: "rec_aguardando_valor", session: s, resposta: M.receita.valorInvalido() };
    }
    s.valor = v;
    return {
      status: "rec_aguardando_recorrencia",
      session: s,
      resposta: M.receita.perguntaRecorrencia(),
    };
  }

  if (current === "rec_aguardando_recorrencia") {
    if (resposta === "confirm") {
      s.recorrente = true;
      return {
        status: "rec_aguardando_frequencia",
        session: s,
        resposta: M.receita.perguntaFrequencia(),
      };
    }
    if (resposta === "cancel") {
      s.recorrente = false;
      return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
    }
    return {
      status: "rec_aguardando_recorrencia",
      session: s,
      resposta: M.receita.perguntaRecorrencia(),
    };
  }

  if (current === "rec_aguardando_frequencia") {
    const f = parseFrequencia(texto);
    if (!f) {
      return {
        status: "rec_aguardando_frequencia",
        session: s,
        resposta: M.receita.frequenciaInvalida(),
      };
    }
    s.frequencia = f;
    if (f === "mensal") {
      return { status: "rec_aguardando_dia", session: s, resposta: M.receita.perguntaDiaMes() };
    }
    if (f === "semanal") {
      return { status: "rec_aguardando_dia", session: s, resposta: M.receita.perguntaDiaSemana() };
    }
    // quinzenal: pula dia
    return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
  }

  if (current === "rec_aguardando_dia") {
    if (s.frequencia === "mensal") {
      const d = parseDiaMes(texto);
      if (!d) {
        return { status: "rec_aguardando_dia", session: s, resposta: M.receita.diaMesInvalido() };
      }
      s.diaMes = d;
    } else if (s.frequencia === "semanal") {
      const d = parseDiaSemana(texto);
      if (d === null) {
        return {
          status: "rec_aguardando_dia",
          session: s,
          resposta: M.receita.diaSemanaInvalido(),
        };
      }
      s.diaSemana = d;
    }
    return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
  }

  // confirmação tratada fora (precisa de userId para persistir)
  return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
}
