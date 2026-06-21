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

const GASTO_HINT_PATTERNS = [
  /\bgastei\b/,
  /\bpaguei\b/,
  /\bcomprei\b/,
  /\bdebitou\b/,
];

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
  // número brasileiro: 1.234,56 ou 1234,56 ou 1234.56 ou 1234
  const m = t.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let raw = m[1];
  if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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
  domingo: 0, dom: 0,
  segunda: 1, seg: 1, "segunda-feira": 1,
  terca: 2, ter: 2, "terca-feira": 2,
  quarta: 3, qua: 3, "quarta-feira": 3,
  quinta: 4, qui: 4, "quinta-feira": 4,
  sexta: 5, sex: 5, "sexta-feira": 5,
  sabado: 6, sab: 6,
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

// ---------- recorrência: gera datas ----------

function nextWeekday(fromISO: string, dow: number): string {
  const [y, m, d] = fromISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const cur = dt.getUTCDay();
  let diff = (dow - cur + 7) % 7;
  if (diff === 0) diff = 0; // hoje também conta
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function addMonthsKeepDay(iso: string, monthsAdd: number, dia: number): string {
  const [y, m] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + monthsAdd, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(dia, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function gerarDatasRecorrencia(s: ReceitaSession): string[] {
  const COUNT = 12;
  const hoje = todayLocalISO();
  if (s.frequencia === "mensal") {
    const dia = s.diaMes ?? Number(hoje.slice(8));
    // primeira ocorrência: este mês (se dia ainda não passou) ou próximo
    const [y, m] = hoje.slice(0, 7).split("-").map(Number);
    const lastDayThis = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const diaThis = Math.min(dia, lastDayThis);
    const firstThis = `${y}-${String(m).padStart(2, "0")}-${String(diaThis).padStart(2, "0")}`;
    const startMonthsAhead = firstThis < hoje ? 1 : 0;
    const out: string[] = [];
    for (let i = 0; i < COUNT; i++) out.push(addMonthsKeepDay(hoje, startMonthsAhead + i, dia));
    return out;
  }
  if (s.frequencia === "semanal") {
    const dow = s.diaSemana ?? new Date().getUTCDay();
    let cur = nextWeekday(hoje, dow);
    const out: string[] = [];
    for (let i = 0; i < COUNT; i++) {
      out.push(cur);
      cur = addDays(cur, 7);
    }
    return out;
  }
  // quinzenal: a partir de hoje, a cada 15 dias
  const out: string[] = [];
  let cur = hoje;
  for (let i = 0; i < COUNT; i++) {
    out.push(cur);
    cur = addDays(cur, 15);
  }
  return out;
}

export function resumoRecorrencia(s: ReceitaSession): string {
  if (!s.recorrente) return "Não";
  if (s.frequencia === "mensal") return `Todo mês, dia ${s.diaMes}`;
  if (s.frequencia === "semanal") {
    const nomes = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
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
    .gte("data", monthStart);
  return Array.isArray(data) ? data.length : 0;
}

// ---------- persistir ----------

export async function persistirReceita(
  userId: string,
  s: ReceitaSession,
): Promise<{ ok: boolean; resposta: string }> {
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

  const tipo: TipoReceita = s.tipo ?? "outros";
  const descricao = (s.descricao || s.tipoLabel || "Renda").trim();
  const valor = Number(s.valor || 0);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, resposta: M.receita.erroAoSalvar() };
  }

  const baseData = s.data || todayLocalISO();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  if (s.recorrente) {
    const recId =
      // crypto.randomUUID exists in workerd
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const datas = gerarDatasRecorrencia(s);
    for (const iso of datas) {
      const [y, m] = iso.split("-").map(Number);
      rows.push({
        user_id: userId,
        descricao,
        valor,
        data: iso,
        tipo,
        recorrente: true,
        recorrencia_id: recId,
        mes: m,
        ano: y,
        origem: "whatsapp",
      });
    }
  } else {
    const [y, m] = baseData.split("-").map(Number);
    rows.push({
      user_id: userId,
      descricao,
      valor,
      data: baseData,
      tipo,
      recorrente: false,
      mes: m,
      ano: y,
      origem: "whatsapp",
    });
  }

  const { error } = await supabaseAdmin.from("receitas").insert(rows);
  if (error) {
    console.error("[whatsapp] receita insert failed", error);
    return { ok: false, resposta: M.receita.erroAoSalvar() };
  }

  const valorFmt = formatBRL(valor);
  const categoria = s.tipoLabel || descricao;
  if (s.recorrente) {
    return {
      ok: true,
      resposta: M.receita.salvaRecorrente({
        valor: valorFmt,
        descricao,
        resumoRecorrencia: resumoRecorrencia(s),
      }),
    };
  }
  return {
    ok: true,
    resposta: M.receita.salvaSimples({ valor: valorFmt, descricao, categoria }),
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
    categoria: s.tipoLabel || "Outros",
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
        return { status: "rec_aguardando_dia", session: s, resposta: M.receita.diaSemanaInvalido() };
      }
      s.diaSemana = d;
    }
    return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
  }

  // confirmação tratada fora (precisa de userId para persistir)
  return { status: "rec_aguardando_confirmacao", session: s, resposta: buildConfirmacao(s) };
}
