/**
 * WA-C2 — Criação de CONTAS A PAGAR e VENCIMENTOS RECORRENTES pelo WhatsApp.
 *
 * Reconhece mensagens como:
 *   "Minha internet de 119,90 vence dia 5 todo mês."
 *   "Cadastrar aluguel de 1.200 para vencer dia 10."
 *   "Tenho uma conta de luz de 180 reais que vence em 20 de julho."
 *   "Plano de saúde de 970 vence dia 15 todo mês."
 *
 * Garantias:
 * - Tabela canônica `contas_a_pagar` (status inicial = 'pendente').
 * - Recorrência mensal/semanal/anual: insere N ocorrências reais
 *   compartilhando `recorrencia_id`, MESMA regra do site (`store.ts`
 *   → addOccurrence), para que WA-C1 enxergue cada ocorrência no mês
 *   correto sem expansão paralela.
 * - Idempotência: claim atômico via `external_message_id` (índice único
 *   parcial em whatsapp_messages), mesmo padrão do WA-F3.
 * - Readback obrigatório por (user_id, recorrencia_id|id) antes da
 *   resposta de sucesso.
 * - Nunca cria gasto, fatura, transferência ou pagamento.
 * - Nunca grava memória de estabelecimento (memória é exclusiva de
 *   gasto confirmado).
 * - Log sem PII/valor/nome/data/userId/telefone/texto/transcrição.
 */
import * as _supa from "@/integrations/supabase/client.server";
import { nowInAppTz } from "./cartao-fatura.server";
import { suggestCategoryFromText } from "@/lib/categories";
import type { WhatsAppMessageRow, ProcessOutcome } from "./whatsapp.server";
import type {
  CategoriaPickerRow,
  CategoriaPickerState,
} from "./whatsapp-comprovantes.server";
import { extrairValor } from "./whatsapp-parcelamento.server";
import { randomUUID } from "crypto";
// WA-C11 3B.2.C.1 Block 5 — quota financeira para criação de conta por texto.
import {
  assertFinancialActionQuotaForWhatsApp,
  financialQuotaBlockedReply,
} from "@/server/whatsapp-financial-quota-gate.server";


// Live-binding para permitir mock.module() em testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, { get: (_t, prop) => (_supa.supabaseAdmin as never)[prop as never] });

// ---------- tipos ----------

export type Frequencia = "mensal" | "semanal" | "anual";

export type ContaSession = {
  kind: "conta_a_pagar";
  mensagemOriginal: string;
  nome: string | null;
  valorCentavos: number | null;
  dataVencimento: string | null; // YYYY-MM-DD (LOCAL/America/Sao_Paulo)
  recorrente: boolean | null;
  frequenciaRecorrencia: Frequencia | null;
  categoriaId: string | null;
  categoriaLabel?: string | null;
  categorySelectionSource: "automatic" | "manual";
  source?: "audio" | "text";
  // Picker state quando o usuário pediu para escolher categoria.
  categoriaOptions?: CategoriaPickerState;
  // Quando o usuário informou dia recorrente sem mês claro, registramos
  // o "dia" para confirmação. Não é persistido em contas_a_pagar.
  diaInformado?: number | null;
};

export const CONTA_PENDING_STATES = [
  "conta_aguardando_nome",
  "conta_aguardando_valor",
  "conta_aguardando_vencimento",
  "conta_aguardando_recorrencia",
  "conta_aguardando_categoria",
  "conta_aguardando_confirmacao",
  "conta_persistindo",
] as const;

export function isContaSession(s: unknown): s is ContaSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "conta_a_pagar";
}

// ---------- DI seam ----------

export type WhatsAppContaCriarDeps = {
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
  | "detected"
  | "awaiting_name"
  | "awaiting_value"
  | "awaiting_due_date"
  | "awaiting_recurrence"
  | "awaiting_confirmation"
  | "persisted"
  | "cancelled"
  | "failed";

function logDecision(args: {
  stage: Stage;
  recurringPresent: boolean;
  frequencyPresent: boolean;
  result: "ok" | "invalid" | "ambiguous" | "error";
}) {
  console.info({
    event: "wa_payable_account_decision",
    stage: args.stage,
    recurringPresent: args.recurringPresent,
    frequencyPresent: args.frequencyPresent,
    result: args.result,
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

// ---------- regras compartilhadas de RECORRÊNCIA ----------

/**
 * Expansão de datas de uma recorrência — MESMA regra do site
 * (src/lib/store.ts, função addOccurrence). Por contrato:
 *   mensal:  setMonth(+i)
 *   semanal: setDate(+7*i)
 *   anual:   setFullYear(+i)
 *
 * Mantida aqui (não importada de store.ts) para que `whatsapp.server.ts`
 * não importe nenhum módulo do bundle client. Se essa regra mudar no
 * site, atualize ambos em par.
 */
export function expandRecurrenceDates(
  baseISO: string,
  freq: Frequencia,
  total: number,
): string[] {
  const out: string[] = [];
  const [y, m, d] = baseISO.split("-").map(Number);
  for (let i = 0; i < total; i++) {
    const dt = new Date(y, m - 1, d);
    if (freq === "semanal") dt.setDate(dt.getDate() + 7 * i);
    else if (freq === "anual") dt.setFullYear(dt.getFullYear() + i);
    else dt.setMonth(dt.getMonth() + i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

/** Quantas ocorrências futuras criar por frequência. Espelha o default
 *  do site (12 meses para mensal). */
function totalOcorrenciasFor(freq: Frequencia): number {
  if (freq === "semanal") return 12;
  if (freq === "anual") return 3;
  return 12; // mensal
}

// ---------- detector de intenção ----------

const VERBOS_GASTO_OU_RECEITA =
  /\b(gastei|paguei|comprei|recebi|ganhei|sobr[ao]|saldo)\b/;
const FATURA_OU_CARTAO =
  /\bfatura\b|\bcart(?:ao|oes|ão|ões)\b|\bnubank\b|\binter\b|\bitau\b|\bita[uú]\b|\bbradesco\b|\bsantander\b|\bcaixa\b|\bc6\b|\bpicpay\b|\bmercado\s*pago\b/;

const PALAVRAS_CONTA = [
  "conta","aluguel","mensalidade","plano","seguro","internet",
  "luz","energia","agua","água","gas","gás","condominio","condomínio",
  "iptu","iptv","streaming","academia","escola","faculdade","creche",
  "boleto","financiamento","emprestimo","empréstimo","prestacao","prestação",
  "consorcio","consórcio","netflix","spotify","celular","telefone","tv",
  "saude","saúde","plano de saude","plano de saúde","cartao de credito"
];

const PALAVRAS_VENCE =
  /\b(vence|vencendo|vencimento|vencer|vencimentos|venceu|todo\s+(?:mes|m[eê]s|dia|dia\s+\d+)|toda\s+semana|semanal|mensal|anual|por\s+m[eê]s)\b/;

const VERBOS_CADASTRAR =
  /\b(cadastr(?:ar|a|e)|registr(?:ar|a|e)|criar|adicionar|adiciona|lan[cç]a(?:r)?|inserir|salvar)\b/;

/**
 * Retorna `true` quando a mensagem indica claramente criação de uma
 * conta a pagar / vencimento. Estrito por design — guarda WA-C1, WA-F1..F5
 * e o parser de gasto comum.
 */
export function detectPayableAccountIntent(textRaw: string): boolean {
  const t = norm(textRaw);
  if (!t) return false;

  // Bloqueia gastos consumados, receitas e saldo.
  if (VERBOS_GASTO_OU_RECEITA.test(t)) return false;
  // Bloqueia fatura / cartão (WA-F1..F5).
  if (FATURA_OU_CARTAO.test(t)) return false;

  // Precisa de pelo menos UMA palavra de domínio "conta a pagar".
  // Usa bordas de palavra (\b) para evitar falsos positivos como
  // "gasto" casando com "gas" ou "telefonema" casando com "telefone".
  const temPalavra = PALAVRAS_CONTA.some((p) => {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`, "u").test(t);
  });

  // OU "cadastrar/registrar/criar X" + vencimento → cobre "cadastrar internet".
  const temVerboCriar = VERBOS_CADASTRAR.test(t);

  // Precisa de pista de vencimento/recorrência OU verbo de cadastro.
  const temVence = PALAVRAS_VENCE.test(t);

  if (temPalavra && temVence) return true;
  if (temVerboCriar && temVence) return true;
  if (temVerboCriar && temPalavra) return true;
  return false;
}

// ---------- frequência ----------

export function detectFrequencia(textRaw: string): Frequencia | null {
  const t = norm(textRaw);
  if (/\btoda\s+semana\b|\bsemanal(?:mente)?\b/.test(t)) return "semanal";
  if (/\banual(?:mente)?\b|\btodo\s+ano\b|\bpor\s+ano\b/.test(t)) return "anual";
  if (/\btodo\s+(?:m[eê]s|mes)\b|\bmensal(?:mente)?\b|\bpor\s+m[eê]s\b|\bcada\s+m[eê]s\b|\btodo\s+dia\s+\d{1,2}\b/.test(t))
    return "mensal";

  return null;
}

/** `true` somente quando o texto NEGA recorrência ("é única", "uma vez", "só esse mês"). */
export function detectExplicitlyOneShot(textRaw: string): boolean {
  const t = norm(textRaw);
  return /\b(unica|única|uma vez|so esse mes|só esse mês|apenas esse mes|so dessa vez|nao e recorrente|não é recorrente|nao recorrente|não recorrente)\b/.test(t);
}

// ---------- parser de data ----------

const MESES_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
  outubro: 10, novembro: 11, dezembro: 12,
};

function toLocalISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * Retorna `{ iso, dia, mes, ano }` quando uma data clara é extraída.
 * Tolera "dia 5", "5 de julho", "05/07", "05/07/2026", "amanhã", "hoje".
 *
 * Regra "dia N" (sem mês): resolve automaticamente à PRÓXIMA
 * ocorrência aplicável no fuso America/Sao_Paulo — jamais no passado,
 * jamais uma data inválida (avança meses até um mês que contenha N).
 * Comportamento idêntico para conta única e recorrente.
 * Datas completas (`05/08/2026`, `5 de agosto`) têm prioridade.
 */
export function extrairDataVencimento(
  textRaw: string,
  hoje: Date = nowInAppTz(),
  _recurring = false,
): { iso: string; dia: number; mes: number; ano: number } | { kind: "dia_somente"; dia: number } | null {
  const t = norm(textRaw);
  if (!t) return null;

  if (/\bamanha\b|\bamanhã\b/.test(t)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1);
    return { iso: toLocalISO(d.getFullYear(), d.getMonth() + 1, d.getDate()),
             dia: d.getDate(), mes: d.getMonth() + 1, ano: d.getFullYear() };
  }
  if (/\bhoje\b/.test(t)) {
    return { iso: toLocalISO(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate()),
             dia: hoje.getDate(), mes: hoje.getMonth() + 1, ano: hoje.getFullYear() };
  }

  // "5 de julho [de 2026]" / "20 de julho"
  const m1 = t.match(/\b(\d{1,2})\s+de\s+([a-zçãéó]+)(?:\s+de\s+(\d{4}))?\b/);
  if (m1) {
    const dia = Number(m1[1]);
    const mes = MESES_PT[m1[2]];
    if (mes && dia >= 1 && dia <= 31) {
      let ano = m1[3] ? Number(m1[3]) : hoje.getFullYear();
      const d = Math.min(dia, lastDayOfMonth(ano, mes));
      const candidate = new Date(ano, mes - 1, d);
      // Se não houver ano explícito e a data passou, próximo ano.
      if (!m1[3] && candidate < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
        ano = ano + 1;
      }
      return { iso: toLocalISO(ano, mes, d), dia: d, mes, ano };
    }
  }

  // "05/07" ou "05/07/2026" ou "05-07-2026"
  const m2 = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m2) {
    const dia = Number(m2[1]);
    const mes = Number(m2[2]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      let ano = m2[3] ? Number(m2[3]) : hoje.getFullYear();
      if (ano < 100) ano = 2000 + ano;
      const d = Math.min(dia, lastDayOfMonth(ano, mes));
      const candidate = new Date(ano, mes - 1, d);
      if (!m2[3] && candidate < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
        ano = ano + 1;
      }
      return { iso: toLocalISO(ano, mes, d), dia: d, mes, ano };
    }
  }

  // "dia 5" / "dia 10" — só o dia, mês inferido automaticamente.
  // Nunca gera passado, nunca gera data inválida: avança meses até
  // achar um mês corrente/futuro que contenha `dia`.
  const m3 = t.match(/\bdia\s+(\d{1,2})\b/);
  if (m3) {
    const dia = Number(m3[1]);
    if (dia >= 1 && dia <= 31) {
      return resolveNextOccurrence(dia, hoje);
    }
  }

  return null;
}

/**
 * Resolve o próximo YYYY-MM-DD (America/Sao_Paulo) tal que:
 *   - `dia` seja um dia válido do mês resolvido;
 *   - a data seja >= hoje (nunca no passado).
 * Se hoje = 02/07 e dia=2 → 02/07 (hoje).
 * Se hoje = 02/07 e dia=1 → 01/08.
 * Se hoje = 30/09 e dia=31 → 31/10 (setembro não tem 31).
 */
function resolveNextOccurrence(
  dia: number,
  hoje: Date,
): { iso: string; dia: number; mes: number; ano: number } {
  let y = hoje.getFullYear();
  let m0 = hoje.getMonth(); // 0-11
  const hojeD = hoje.getDate();
  // no máximo 14 iterações (cobre fev-fev pulando meses sem 30/31)
  for (let i = 0; i < 14; i++) {
    const last = lastDayOfMonth(y, m0 + 1);
    if (dia <= last) {
      // dia é válido neste mês
      const candidate = new Date(y, m0, dia);
      const today = new Date(hoje.getFullYear(), hoje.getMonth(), hojeD);
      if (candidate.getTime() >= today.getTime()) {
        return { iso: toLocalISO(y, m0 + 1, dia), dia, mes: m0 + 1, ano: y };
      }
    }
    // avança um mês
    m0 += 1;
    if (m0 > 11) { m0 = 0; y += 1; }
  }
  // fallback defensivo (não deve ocorrer)
  return { iso: toLocalISO(y, m0 + 1, Math.min(dia, lastDayOfMonth(y, m0 + 1))), dia, mes: m0 + 1, ano: y };
}

// ---------- categoria sugerida (determinística) ----------

const KW_CATEGORIA: Array<{ key: string; re: RegExp }> = [
  { key: "moradia", re: /\b(aluguel|condominio|condomínio|iptu)\b/ },
  { key: "casa", re: /\b(internet|luz|energia|agua|água|gas|gás|telefone|celular|tv|streaming|netflix|spotify)\b/ },
  { key: "saude", re: /\b(plano de saude|plano de saúde|saude|saúde|odonto|farmacia|farmácia)\b/ },
  { key: "educacao", re: /\b(escola|faculdade|creche|curso|mensalidade)\b/ },
  { key: "transporte", re: /\b(seguro auto|seguro do carro|financiamento (do )?carro)\b/ },
  { key: "lazer", re: /\b(academia|spotify|netflix)\b/ },
];

function sugerirCategoriaKey(nome: string | null | undefined): string | null {
  const t = norm(nome ?? "");
  if (!t) return null;
  for (const { key, re } of KW_CATEGORIA) {
    if (re.test(t)) return key;
  }
  const fallback = suggestCategoryFromText(t);
  return fallback || null;
}

// ---------- extração do nome ----------

function extrairNome(textRaw: string): string | null {
  let t = textRaw
    .replace(/\bR\$\s*[\d.,]+/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mil\s+)?(?:reais|real)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*mil\b/gi, " ")
    .replace(/\b\d+(?:,\d{1,2})\b/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\s+de\s+[a-zA-ZçÇãÃéÉóÓ]+(?:\s+de\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\b(todo|toda)\s+(?:mes|mês|dia|semana|ano)\b/gi, " ")
    .replace(/\b(mensal|semanal|anual)(?:mente)?\b/gi, " ")
    .replace(/\b(vence|vencendo|vencimento|vencer|vencimentos|venceu)\b/gi, " ")
    .replace(/\b(amanha|amanhã|hoje)\b/gi, " ")
    .replace(/\b(cadastrar|cadastra|cadastre|registrar|registra|criar|adicionar|inserir|salvar|lan[cç]ar|tenho|uma|um|de|do|da|que|para|pra|por|em|no|na|com|minha|meu|essa|esse|isso)\b/gi, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length < 2) return null;
  // Capitaliza primeira letra de cada palavra.
  t = t.toLowerCase().replace(/\b([a-zçãéó])/g, (c) => c.toUpperCase());
  return t.slice(0, 80);
}

// ---------- parser principal ----------

export type ContaDraft = {
  nome: string | null;
  valorCentavos: number | null;
  dataVencimento: string | null;
  recorrente: boolean | null;
  frequenciaRecorrencia: Frequencia | null;
  diaInformado: number | null;
};

export function parsePayableAccountMessage(textRaw: string, hoje: Date = new Date()): ContaDraft {
  // Remove tokens que NÃO são valor monetário antes de chamar extrairValor,
  // para que "dia 5", "todo dia 10", "05/07/2026" e "20 de julho" não sejam
  // confundidos com valores em reais.
  const textoSemData = (textRaw ?? "")
    .replace(/\b(?:todo|toda)\s+dia\s+\d{1,2}\b/gi, " ")
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\s+de\s+[a-zA-ZçÇãÃéÉóÓ]+(?:\s+de\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ");
  const valorReais = extrairValor(textoSemData);
  const valorCentavos = valorReais != null ? Math.round(valorReais * 100) : null;

  const freq = detectFrequencia(textRaw);
  const recorrenteExplicito = !!freq;
  const oneShot = detectExplicitlyOneShot(textRaw);
  const dataResult = extrairDataVencimento(textRaw, hoje, recorrenteExplicito);
  let dataVencimento: string | null = null;
  let diaInformado: number | null = null;
  if (dataResult) {
    if ("iso" in dataResult) dataVencimento = dataResult.iso;
    else diaInformado = dataResult.dia;
  }
  // Default semântico: se temos data EXPLÍCITA (com mês) e nenhum sinal
  // de recorrência, tratamos como conta única. Se a data é apenas "dia X"
  // (mês ambíguo), assumimos recorrente quando houver frequência; caso
  // contrário deixamos null para o handler perguntar.
  let recorrente: boolean | null;
  if (oneShot) recorrente = false;
  else if (recorrenteExplicito) recorrente = true;
  else if (dataVencimento) recorrente = false;
  else recorrente = null;
  return {
    nome: extrairNome(textRaw),
    valorCentavos,
    dataVencimento,
    recorrente,
    frequenciaRecorrencia: freq ?? null,
    diaInformado,
  };
}


// ---------- formatação ----------

function formatBRL(centavos: number): string {
  const n = centavos / 100;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function freqLabel(f: Frequencia): string {
  if (f === "semanal") return "Semanal";
  if (f === "anual") return "Anual";
  return "Mensal";
}

function previewMessage(s: ContaSession): string {
  const linhas = [
    "Confere pra mim? 👀",
    "",
    `• Conta: ${s.nome}`,
    `• Valor previsto: ${formatBRL(s.valorCentavos!)}`,
    `• Vencimento: ${formatDateBR(s.dataVencimento!)}`,
    `• Recorrência: ${s.recorrente && s.frequenciaRecorrencia ? freqLabel(s.frequenciaRecorrencia) : "Única"}`,
    `• Categoria: ${s.categoriaLabel ?? "Outros"}`,
    "",
    'Responda "sim" para confirmar ou diga o que deseja ajustar.',
  ];
  return linhas.join("\n");
}

function askNome(): string {
  return "Qual é o nome dessa conta?\nEx.: Internet, Aluguel, Plano de saúde";
}
function askValor(nome: string | null): string {
  const label = nome ? `da ${nome}` : "dessa conta";
  return `Qual é o valor previsto ${label}?\nEx.: R$ 119,90`;
}
function askVencimento(): string {
  return "Qual é a data de vencimento?\nEx.: dia 20 ou 20 de julho";
}
function askRecorrencia(): string {
  return 'Essa conta é única ou se repete todo mês?\nResponda "única" ou "todo mês" (também aceito "semanal" ou "anual").';
}
function confirmarDataSomenteDia(dia: number): string {
  return `Você disse "dia ${dia}". Qual mês? Diga uma data completa como "${dia}/07/${new Date().getFullYear()}" ou "${dia} de julho".`;
}

// ---------- handler principal ----------

export async function processarContaAPagar(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string } | null;
  deps: WhatsAppContaCriarDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const isHardCancel =
    /\b(cancelar|cancela|cancelado|cancelada)\b/i.test(texto) || decisao === "cancel";

  if (sessao && isHardCancel) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    const resposta = "Conta cancelada. Quando quiser, é só me contar de novo. 👍";
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada", sessao.session as never, resposta,
    );
    logDecision({
      stage: "cancelled",
      recurringPresent: !!(sessao.session as ContaSession)?.recorrente,
      frequencyPresent: !!(sessao.session as ContaSession)?.frequenciaRecorrencia,
      result: "ok",
    });
    return { status: "cancelada", resposta };
  }

  // Sem sessão: inicia a partir do texto.
  if (!sessao) {
    const d = parsePayableAccountMessage(texto);
    const session: ContaSession = {
      kind: "conta_a_pagar",
      mensagemOriginal: texto,
      nome: d.nome,
      valorCentavos: d.valorCentavos,
      dataVencimento: d.dataVencimento,
      recorrente: d.recorrente,
      frequenciaRecorrencia: d.frequenciaRecorrencia,
      categoriaId: null,
      categoriaLabel: null,
      categorySelectionSource: "automatic",
      source: msg.source ?? "text",
      diaInformado: d.diaInformado,
    };
    logDecision({
      stage: "detected",
      recurringPresent: !!session.recorrente,
      frequencyPresent: !!session.frequenciaRecorrencia,
      result: "ok",
    });
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: null, deps });
  }

  const session = (sessao.session as ContaSession) ?? null;
  if (!session || !isContaSession(session)) {
    return { status: "sem_pendencia", resposta: "" };
  }

  const current = sessao.status;

  if (current === "conta_aguardando_nome") {
    const nome = extrairNome(texto) ?? texto.trim().slice(0, 80);
    if (!nome || nome.length < 2) {
      const r = `Não consegui ler o nome. ${askNome()}`;
      await deps.atualizarSessao(sessao.id, "conta_aguardando_nome", session as never, r);
      return { status: "pendente", resposta: r };
    }
    session.nome = nome;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
  }

  if (current === "conta_aguardando_valor") {
    const v = extrairValor(texto);
    if (!v || v <= 0) {
      const r = `Não consegui ler o valor. ${askValor(session.nome)}`;
      await deps.atualizarSessao(sessao.id, "conta_aguardando_valor", session as never, r);
      return { status: "pendente", resposta: r };
    }
    session.valorCentavos = Math.round(v * 100);
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
  }

  if (current === "conta_aguardando_vencimento") {
    const recurring = session.recorrente === true;
    const r = extrairDataVencimento(texto, new Date(), recurring);
    if (!r) {
      const aviso = `Não consegui ler a data. ${askVencimento()}`;
      await deps.atualizarSessao(sessao.id, "conta_aguardando_vencimento", session as never, aviso);
      return { status: "pendente", resposta: aviso };
    }
    if ("kind" in r) {
      session.diaInformado = r.dia;
      const aviso = confirmarDataSomenteDia(r.dia);
      await deps.atualizarSessao(sessao.id, "conta_aguardando_vencimento", session as never, aviso);
      return { status: "pendente", resposta: aviso };
    }
    session.dataVencimento = r.iso;
    session.diaInformado = null;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
  }

  if (current === "conta_aguardando_recorrencia") {
    const freq = detectFrequencia(texto);
    const oneShot = detectExplicitlyOneShot(texto) ||
      /^(unica|única|nao|não|so essa vez|só essa vez)$/i.test(norm(texto));
    if (freq) {
      session.recorrente = true;
      session.frequenciaRecorrencia = freq;
    } else if (oneShot) {
      session.recorrente = false;
      session.frequenciaRecorrencia = null;
    } else {
      const aviso = `Não entendi. ${askRecorrencia()}`;
      await deps.atualizarSessao(sessao.id, "conta_aguardando_recorrencia", session as never, aviso);
      return { status: "pendente", resposta: aviso };
    }
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
  }

  if (current === "conta_aguardando_categoria") {
    const cats = await deps.loadCategoriasParaPicker(userId);
    const r = await deps.resolveCategoriaPickerInput({
      userId,
      holder: {
        descricao: session.nome,
        categoriaSugerida: null,
        categoriaOptions: session.categoriaOptions,
      },
      cats,
      texto,
    });
    if (r.kind === "picked") {
      session.categorySelectionSource = "manual";
      session.categoriaId = r.cat.id;
      session.categoriaLabel = r.cat.nome;
      session.categoriaOptions = undefined;
      return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
    }
    if (r.kind === "relist") {
      session.categoriaOptions = r.options;
      await deps.atualizarSessao(sessao.id, "conta_aguardando_categoria", session as never, r.body);
      return { status: "pendente", resposta: r.body };
    }
    const aviso = `Não entendi. Digite o número, o nome da categoria, "mais" para ver outras opções ou "cancelar".`;
    await deps.atualizarSessao(sessao.id, "conta_aguardando_categoria", session as never, aviso);
    return { status: "pendente", resposta: aviso };
  }

  if (current === "conta_aguardando_confirmacao") {
    // Comando de categoria (ask/direct) tem prioridade sobre "sim".
    const catCmd = deps.detectCategoriaCommand(texto);
    if (catCmd) {
      return await handleCategoriaCmd({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps, cmd: catCmd });
    }
    if (decisao === "confirm") {
      return await persistir({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
    }
    // Ajustes livres: valor / vencimento / recorrência / nome.
    const novoValor = extrairValor(texto);
    if (novoValor && novoValor > 0 && /\b(valor|certo|na verdade|na real|foi|paguei|total)\b/i.test(texto)) {
      session.valorCentavos = Math.round(novoValor * 100);
    }
    const novaFreq = detectFrequencia(texto);
    if (novaFreq) { session.recorrente = true; session.frequenciaRecorrencia = novaFreq; }
    if (detectExplicitlyOneShot(texto)) { session.recorrente = false; session.frequenciaRecorrencia = null; }
    const novaData = extrairDataVencimento(texto, new Date(), session.recorrente === true);
    if (novaData && "iso" in novaData) session.dataVencimento = novaData.iso;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps });
  }

  return { status: "sem_pendencia", resposta: "" };
}

async function handleCategoriaCmd(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ContaSession;
  sessaoId: string;
  deps: WhatsAppContaCriarDeps;
  cmd: { kind: "ask" } | { kind: "direct"; termo: string };
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessaoId, deps, cmd } = args;
  const cats = await deps.loadCategoriasParaPicker(userId);
  if (cmd.kind === "ask") {
    const { body, options } = await deps.buildCategoriaListBody({
      userId,
      holder: { descricao: session.nome, categoriaSugerida: null },
      cats,
    });
    session.categoriaOptions = options;
    const resposta = `Qual categoria devo usar?\n\n${body}`;
    await deps.atualizarSessao(sessaoId, "conta_aguardando_categoria", session as never, resposta);
    return { status: "pendente", resposta };
  }
  const r = await deps.resolveCategoriaPickerInput({
    userId,
    holder: { descricao: session.nome, categoriaSugerida: null, categoriaOptions: undefined },
    cats,
    texto: cmd.termo,
  });
  if (r.kind !== "picked") {
    const resposta = `Não encontrei a categoria "${cmd.termo}". Digite "categoria" para ver a lista de opções.`;
    await deps.atualizarSessao(sessaoId, "conta_aguardando_confirmacao", session as never, resposta);
    return { status: "pendente", resposta };
  }
  session.categorySelectionSource = "manual";
  session.categoriaId = r.cat.id;
  session.categoriaLabel = r.cat.nome;
  session.categoriaOptions = undefined;
  return await avancarFluxo({ userId, msg, texto, recebidaEm, session, sessaoId, deps });
}

async function persistTransition(
  newStatus: string,
  session: ContaSession,
  resposta: string,
  sessaoId: string | null,
  args: { userId: string; msg: WhatsAppMessageRow; texto: string; recebidaEm: string; deps: WhatsAppContaCriarDeps },
): Promise<void> {
  const { userId, msg, texto, recebidaEm, deps } = args;
  if (sessaoId) {
    await supabaseAdmin.from("whatsapp_messages").update({ status: "expirada" }).eq("id", sessaoId);
  }
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    newStatus, session as never, resposta,
  );
}

async function avancarFluxo(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ContaSession;
  sessaoId: string | null;
  deps: WhatsAppContaCriarDeps;
}): Promise<ProcessOutcome> {
  const { session } = args;

  // 1) Nome faltando.
  if (!session.nome || session.nome.length < 2) {
    const r = askNome();
    await persistTransition("conta_aguardando_nome", session, r, args.sessaoId, args);
    logDecision({ stage: "awaiting_name", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 2) Valor faltando.
  if (!session.valorCentavos || session.valorCentavos <= 0) {
    const r = askValor(session.nome);
    await persistTransition("conta_aguardando_valor", session, r, args.sessaoId, args);
    logDecision({ stage: "awaiting_value", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 3) Vencimento faltando (ou só dia sem mês).
  if (!session.dataVencimento) {
    let r: string;
    if (session.diaInformado) r = confirmarDataSomenteDia(session.diaInformado);
    else r = askVencimento();
    await persistTransition("conta_aguardando_vencimento", session, r, args.sessaoId, args);
    logDecision({ stage: "awaiting_due_date", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 4) Recorrência indefinida → pergunta.
  if (session.recorrente === null) {
    const r = askRecorrencia();
    await persistTransition("conta_aguardando_recorrencia", session, r, args.sessaoId, args);
    logDecision({ stage: "awaiting_recurrence", recurringPresent: false, frequencyPresent: false, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 5) Categoria automática (se manual ainda não foi definida).
  if (!session.categoriaId) {
    const cats = await args.deps.loadCategoriasParaPicker(args.userId);
    const key = sugerirCategoriaKey(session.nome) ?? "outros";
    const found = cats.find((c) => (c.legacy_id ?? "").toLowerCase() === key)
      ?? cats.find((c) => (c.legacy_id ?? "").toLowerCase() === "outros")
      ?? cats[0]
      ?? null;
    if (found) {
      session.categoriaId = found.id;
      session.categoriaLabel = found.nome;
      session.categorySelectionSource = "automatic";
    } else {
      session.categoriaLabel = "Outros";
    }
  }

  // 6) Prévia + aguarda confirmação.
  const resposta = previewMessage(session);
  await persistTransition("conta_aguardando_confirmacao", session, resposta, args.sessaoId, args);
  logDecision({ stage: "awaiting_confirmation", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "ok" });
  return { status: "pendente", resposta };
}

// ---------- persistência ----------

export async function persistir(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ContaSession;
  sessaoId: string;
  deps: WhatsAppContaCriarDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessaoId, deps } = args;
  if (!session.nome || !session.valorCentavos || !session.dataVencimento) {
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return { status: "erro", resposta: "Não consegui montar essa conta. Vamos começar de novo?" };
  }

  // WA-C11 3B.2.C.1 Block 5 — fail-closed sem `external_id`.
  const externalMessageId = msg.external_id ?? null;
  if (!externalMessageId || externalMessageId.trim().length === 0) {
    console.error("[whatsapp] contas-criar persistir missing externalMessageId");
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return { status: "erro", resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?" };
  }

  // Claim atômico de idempotência (mesmo padrão WA-F3.3).
  let claimSessionId: string | null = null;
  const claim = await deps.gravarSessao(
    userId, msg.telefone, externalMessageId, texto, recebidaEm,
    "conta_persistindo", session as never, "",
  );
  if (!claim?.ok || !claim.sessionId) {
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return { status: "erro", resposta: "Já estou processando essa conta. Aguarde um instante." };
  }
  claimSessionId = claim.sessionId;

  // WA-C11 3B.2.C.1 Block 5 — quota financeira DEPOIS do claim, ANTES do insert.
  // discriminator = `sessaoId` (identificador estável da intenção).
  const gateOutcome = await assertFinancialActionQuotaForWhatsApp({
    userId,
    externalMessageId,
    actionType: "bill_create_text",
    discriminator: sessaoId,
  });
  if (!gateOutcome.allowed) {
    try {
      await deps.atualizarSessao(claimSessionId, "erro", session as never, "quota_blocked");
    } catch { /* claim cleanup nunca quebra o fluxo de resposta */ }
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return { status: "erro", resposta: financialQuotaBlockedReply(gateOutcome) };
  }


  const freq = session.recorrente ? (session.frequenciaRecorrencia ?? "mensal") : null;
  const datas = freq
    ? expandRecurrenceDates(session.dataVencimento, freq, totalOcorrenciasFor(freq))
    : [session.dataVencimento];
  const recorrenciaId = freq ? randomUUID() : null;
  const valor = session.valorCentavos / 100;
  const nowIso = new Date().toISOString();

  const rows = datas.map((iso) => {
    const [y, m] = iso.split("-").map(Number);
    const mesRef = `${y}-${String(m).padStart(2, "0")}`;

    return {
      id: randomUUID(),
      user_id: userId,
      nome: session.nome,
      valor,
      data_vencimento: iso,
      categoria_id: session.categoriaId ?? null,
      observacao: null,
      recorrente: !!freq,
      recorrencia_id: recorrenciaId,
      frequencia_recorrencia: freq,
      data_inicio: freq ? session.dataVencimento : null,
      data_fim: null,
      status: "pendente",
      mes: m,
      ano: y,
      mes_referencia: mesRef,
      forma_pagamento: null,
      fornecedor_id: null,
      created_at: nowIso,
      updated_at: nowIso,
      // marcação mínima de origem (sem PII).
      // `import_batch_id` reaproveitado como traço de origem do batch.
      import_batch_id: null,
      // O caller (WA) é identificado por `recorrencia_id` + ausência de
      // outros campos. Não persistimos texto/áudio/transcrição.
    } as Record<string, unknown>;
  });


  const { error: insertErr } = await supabaseAdmin.from("contas_a_pagar").insert(rows);
  if (insertErr) {
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return { status: "erro", resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?" };
  }

  // Readback obrigatório: confirma que TODAS as ocorrências foram gravadas.
  const ids = rows.map((r) => r.id as string);
  const { data: readback, error: readErr } = await supabaseAdmin
    .from("contas_a_pagar")
    .select("id")
    .eq("user_id", userId)
    .in("id", ids);
  const got: Array<{ id: string }> = Array.isArray(readback) ? readback : [];
  if (readErr || got.length !== rows.length) {
    logDecision({ stage: "failed", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "error" });
    return {
      status: "erro",
      resposta: "Salvei mas não consegui confirmar todas as parcelas. Pode me chamar de novo em alguns minutos?",
    };
  }

  // Fecha sessões anteriores e marca o claim como salvo.
  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva");
  const finalSession = {
    ...session,
    recorrencia_id: recorrenciaId,
    conta_ids: ids,
    status: "salva",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  if (claimSessionId) {
    await deps.atualizarSessao(claimSessionId, "salva", finalSession, "ok");
  } else {
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "salva", finalSession, "ok",
    );
  }

  const resposta = freq
    ? [
        "Pronto! Registrei sua conta recorrente ✅",
        "",
        `${session.nome} — ${formatBRL(session.valorCentavos)} por ${freq === "semanal" ? "semana" : freq === "anual" ? "ano" : "mês"}.`,
        `Próximo vencimento: ${formatDateBR(session.dataVencimento)}.`,
      ].join("\n")
    : [
        "Pronto! Registrei sua conta a pagar ✅",
        "",
        `${session.nome} — ${formatBRL(session.valorCentavos)}`,
        `Vencimento: ${formatDateBR(session.dataVencimento)}.`,
      ].join("\n");

  logDecision({ stage: "persisted", recurringPresent: !!session.recorrente, frequencyPresent: !!session.frequenciaRecorrencia, result: "ok" });
  return { status: "salva", resposta };
}
