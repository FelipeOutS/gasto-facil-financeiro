/**
 * WA-F3 — Compras PARCELADAS no cartão pelo WhatsApp.
 *
 * Reconhece mensagens como:
 *   "Comprei um tênis de 300 reais em 3 vezes no Nubank."
 *   "Foi 89,90 em 2x no crédito."
 *   "Paguei 1.200 em 12 parcelas no cartão Inter."
 *   "Comprei uma TV de 2 mil reais parcelada em 10 vezes."
 *
 * Garantias:
 * - Nada é gravado antes do "sim" explícito;
 * - dedup por external_message_id (responsabilidade do pipeline mãe);
 * - dedup interno por grupo_parcelamento_id: o mesmo plano não é
 *   gravado duas vezes;
 * - todas as queries filtradas por user_id;
 * - log seguro, sem PII/valor/cartão/descrição/texto.
 */
import * as _supa from "@/integrations/supabase/client.server";
import {
  parseWhatsAppExpenseMessage,
  cleanDescricao,
} from "@/lib/whatsappParser";
import { suggestCategoryFromText } from "@/lib/categories";
import type { Cartao } from "@/lib/types";
import {
  criarPlanoParcelamento,
  formatBRL,
  MAX_PARCELAS,
  MIN_PARCELAS,
  reaisParaCentavos,
  calcularParcelasCentavos,
} from "./cartao-parcelamento.server";
// ----- Dependency-injection seam -----
// O orquestrador (`whatsapp.server.ts`) é quem importa este módulo. Para
// evitar dependência circular em runtime — que quebrava o mock de
// `supabaseAdmin` em testes e tornava o módulo financeiro dependente do
// pipeline de mensagens — este módulo NÃO importa nenhum runtime do
// `whatsapp.server.ts`. Em vez disso, recebe as funções necessárias via
// `deps`, injetadas pelo orquestrador na hora da chamada.
//
// `import type` é a única referência permitida ao módulo do WhatsApp:
// tipos são apagados pelo compilador e não criam aresta de runtime.
import type { WhatsAppMessageRow, ProcessOutcome } from "./whatsapp.server";
import { recordMerchantMemory, merchantKeyFor } from "./whatsapp-merchant-memory.server";
import type {
  CategoriaPickerRow,
  CategoriaPickerState,
} from "./whatsapp-comprovantes.server";
import { randomUUID } from "crypto";

export type CategoriaCmdIntent =
  | { kind: "ask" }
  | { kind: "direct"; termo: string };

export type SaveSessionLite = {
  ok: boolean;
  sessionId: string | null;
  status: string | null;
  errorCode: string | null;
};

export type WhatsAppParcelamentoDeps = {
  carregarCartoes: (userId: string) => Promise<Cartao[]>;
  matchCartao: (input: string, cartoes: Cartao[]) => { match: Cartao | null; ambiguous?: string[] };
  displayCartaoNome: (c: Cartao) => string;
  maskCartaoLabel: (c: Cartao) => string;
  isGenericExpenseDescription: (nome: string | undefined | null) => boolean;
  gravarSessao: (
    userId: string, telefone: string, externalId: string | null,
    texto: string, recebidaEm: string, status: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any, resposta: string, gastoId?: string,
  ) => Promise<unknown>;
  atualizarSessao: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: string, status: string, session: any, resposta: string, gastoId?: string,
  ) => Promise<unknown>;
  fecharSessoesAnteriores: (
    userId: string, telefone: string,
    motivo: "salva" | "cancelada" | "expirada", gastoId?: string,
  ) => Promise<void>;
  // WA-F3.3 — picker compartilhado (lista curta, paginação, resolução
  // por número/nome). Reutiliza integralmente os helpers já testados
  // pelo fluxo de comprovantes/gasto, sem duplicar lógica.
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
  detectCategoriaCommand: (texto: string) => CategoriaCmdIntent | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Lazy live-binding: garante que mock.module() em testes seja
// resolvido a cada chamada, sem snapshot no escopo de módulo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, { get: (_t, prop) => (_supa.supabaseAdmin as any)[prop] });

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const cur = new Date().getFullYear();
  const base = MESES_PT[(m - 1 + 12) % 12];
  return y === cur ? base : `${base} de ${y}`;
}

function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- detecção ----------

const CARD_BRAND_HINTS = [
  "credito", "crédito", "cartao", "cartão", "fatura",
  "nubank", "inter", "itau", "santander", "bradesco", "mercado pago",
  "mercadopago", "c6", "caixa", "picpay", "will", "btg", "bb",
  "banco do brasil", "next", "neon", "porto", "safra",
];

function hasCardHint(t: string): boolean {
  return CARD_BRAND_HINTS.some((k) => t.includes(k));
}

/**
 * Reconhece intenção de parcelamento. Aceita SOMENTE digitos para a
 * quantidade — evita falsos positivos com "três vezes essa semana",
 * "tenho três cartões", "dia três vence".
 *
 * Retorna apenas `{ count }` quando a frase indica claramente
 * parcelamento. Retorna `null` em frases ambíguas.
 */
export function detectInstallmentIntent(textRaw: string): { count: number } | null {
  const t = normalize(textRaw);
  if (!t) return null;

  // Bloqueio explícito para frases comprovadamente não-parceladas.
  // "dia X" referenciando datas nunca vira parcelamento.
  if (/\bdia\s+\d+\s+(vence|venc|para|pra|do|de)\b/.test(t)) return null;

  // Padrão primário: requer "em N (x|vezes|parcelas|prestacoes)" ou
  // "parcelado/dividido em N ...".
  const re1 =
    /\b(?:parcelad[oa]\s+em|dividid[oa]\s+em|em)\s+(\d{1,2})\s*(?:x|vezes|parcelas?|presta[cç][oõ]es?)\b/;
  const m1 = t.match(re1);
  if (m1) {
    const n = Number(m1[1]);
    if (n >= MIN_PARCELAS && n <= MAX_PARCELAS) return { count: n };
  }

  // "N parcelas" / "N prestações" sem o "em" — também aceito porque é
  // um indicador inequívoco.
  const re2 = /\b(\d{1,2})\s*(?:parcelas?|presta[cç][oõ]es?)\b/;
  const m2 = t.match(re2);
  if (m2) {
    const n = Number(m2[1]);
    if (n >= MIN_PARCELAS && n <= MAX_PARCELAS) return { count: n };
  }

  // "Nx" só com pista de cartão/crédito para evitar "5x na semana".
  const re3 = /\b(\d{1,2})\s*x\b/;
  const m3 = t.match(re3);
  if (m3 && hasCardHint(t)) {
    const n = Number(m3[1]);
    if (n >= MIN_PARCELAS && n <= MAX_PARCELAS) return { count: n };
  }
  return null;
}

// ---------- sessão ----------

export type ParcelamentoSession = {
  kind: "parcelamento";
  mensagemOriginal: string;
  descricao?: string;
  valorTotal?: number;
  totalParcelas?: number;
  cartaoId?: string;
  cartaoNome?: string;
  source?: "audio" | "text";
  // WA-F3.3 — categoria.
  categorySelectionSource?: "manual" | "automatic";
  manualCategoriaId?: string;
  manualCategoriaLabel?: string;
  categoriaOptions?: CategoriaPickerState;
};

export function isParcelamentoSession(s: unknown): s is ParcelamentoSession {
  if (!s || typeof s !== "object") return false;
  return (s as { kind?: unknown }).kind === "parcelamento";
}

// ---------- log seguro ----------

type Stage =
  | "detected"
  | "awaiting_total"
  | "awaiting_quantity"
  | "awaiting_card"
  | "awaiting_confirmation"
  | "confirmed"
  | "cancelled"
  | "failed";

function logDecision(args: {
  stage: Stage;
  installmentsCountPresent: boolean;
  cardMatchedCount: number;
  result: "ok" | "invalid" | "ambiguous" | "error";
}) {
  console.info({
    event: "wa_installment_purchase_decision",
    stage: args.stage,
    installmentsCountPresent: args.installmentsCountPresent,
    cardMatchedCount: args.cardMatchedCount,
    result: args.result,
  });
}

// ---------- helpers de parser numérico ----------

const NUMEROS_EXTENSO: Record<string, number> = {
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3,
  "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8,
  "nove": 9, "dez": 10, "onze": 11, "doze": 12,
};

/** Extrai valor monetário (R$) do texto em formato brasileiro.
 *  Regras:
 *  - vírgula = decimal; ponto = separador de milhar quando houver
 *    grupo válido de três dígitos. "1.200" → 1200; "89,90" → 89.90;
 *    "1.200,50" → 1200.50.
 *  - ignora números seguidos de "x", "vezes", "parcelas", "prestações"
 *    (são quantidade de parcelas, não valor).
 *  - ignora números embutidos em data/hora/final de cartão (ex.: 12/05,
 *    14:30, 1234-5).
 *  - prefere ocorrência com prefixo "R$" ou sufixo "reais/real".
 *  - "2 mil" / "2,5 mil reais" são reconhecidos como ×1000.
 *  IMPORTANTE: trabalha sobre o texto RAW (sem normalizar pontuação),
 *  para não destruir "1.200" → "1 200". */
export function extrairValor(textRaw: string): number | null {
  if (!textRaw) return null;
  const t = (textRaw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 2 mil reais / 2,5 mil
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*mil(?:\s+(?:reais|real))?\b/);
  if (mil) {
    const base = Number(mil[1].replace(",", "."));
    if (Number.isFinite(base) && base > 0) {
      return Math.round(base * 1000 * 100) / 100;
    }
  }

  // Candidatos numéricos. Anchoras (?<![\d:/-]) e (?![\d:/-]) evitam
  // captura parcial de datas/horas/finais de cartão.
  // Negative lookahead descarta tokens seguidos de "x|vezes|parcelas|prest".
  const re = /(?<![\d:/-])(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+\.\d{1,2}|\d+)(?![\d:/-])(?!\s*(?:x|vezes?|parcelas?|prest))/gi;

  const matches = [...t.matchAll(re)];
  if (matches.length === 0) return null;

  function toNumber(raw: string): number {
    let s = raw;
    if (s.includes(",")) {
      // Brasileiro: ponto = milhar; vírgula = decimal.
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      // Pontos formam apenas grupos de milhar.
      s = s.replace(/\./g, "");
    }
    // Demais casos ("1500", "1500.50") seguem como vieram.
    return Number(s);
  }

  let best: number | null = null;
  for (const m of matches) {
    const raw = m[1];
    const n = toNumber(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const idx = m.index ?? 0;
    const before = t.slice(Math.max(0, idx - 3), idx);
    const after = t.slice(idx + m[0].length, idx + m[0].length + 8);
    const hasRPrefix = /r\$\s*$/i.test(before) || /^r\$/i.test(m[0]);
    const hasReais = /^\s*(?:reais|real)\b/i.test(after);
    if (hasRPrefix || hasReais) return Math.round(n * 100) / 100;
    best = best === null ? n : Math.max(best, n);
  }
  if (best === null) return null;
  return Math.round(best * 100) / 100;
}

/** Tenta extrair quantidade de parcelas (digitos ou extenso). Usado APENAS
 *  na pergunta "serão quantas parcelas?", onde o contexto já garante
 *  que a resposta é uma quantidade. */
export function extrairQuantidadeParcelas(textRaw: string): number | null {
  const t = normalize(textRaw);
  const m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= MIN_PARCELAS && n <= MAX_PARCELAS) return n;
  }
  for (const [k, v] of Object.entries(NUMEROS_EXTENSO)) {
    if (new RegExp(`\\b${k}\\b`).test(t)) {
      if (v >= MIN_PARCELAS && v <= MAX_PARCELAS) return v;
    }
  }
  return null;
}

// ---------- descrição extraída ----------

function extrairDescricao(textRaw: string): string {
  // Remove tokens que vamos consumir noutro campo.
  let t = textRaw.trim();
  // Remove indicadores de parcelamento, valor, cartão.
  t = t
    .replace(/\b(?:parcelad[oa]\s+em|dividid[oa]\s+em|em)\s+\d{1,2}\s*(?:x|vezes|parcelas?|presta[cç][oõ]es?)\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:vezes|parcelas?|presta[cç][oõ]es?)\b/gi, " ")
    .replace(/\b\d{1,2}\s*x\b/gi, " ")
    .replace(/\bR\$\s*[\d.,]+/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mil\s+)?(?:reais|real)\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*mil\b/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g, " ")
    .replace(/\b\d+(?:,\d{1,2})\b/g, " ")
    .replace(/\b\d{3,}(?:\.\d{1,2})?\b/g, " ")
    .replace(/\b(?:no|na|do|da|de|com)\s+(?:cart(?:ão|ao)\s+)?(?:credito|crédito|nubank|inter|itau|itaú|santander|bradesco|caixa|mercado\s*pago|c6|picpay|will|btg|bb|banco do brasil|next|neon|porto|safra)\b/gi, " ")
    .replace(/\b(?:cart(?:ão|ao)|credito|crédito|fatura)\b/gi, " ")
    .replace(/\b(?:comprei|compra|paguei|gastei|foi|um|uma|umas?|uns)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = cleanDescricao(t) || t;
  return cleaned;
}

// ---------- parser principal ----------

export type ParcelamentoDraft = {
  descricao: string;
  valorTotal: number | null;
  totalParcelas: number;
  cartaoId: string | null;
  cartaoNome: string | null;
  cartaoAmbiguous: string[] | null;
};

export function parseInstallmentMessage(
  text: string,
  cartoes: Cartao[],
  intent: { count: number },
  deps: Pick<WhatsAppParcelamentoDeps, "matchCartao" | "displayCartaoNome" | "isGenericExpenseDescription">,
): ParcelamentoDraft {
  // Reusa o parser principal só para resolver cartão e valor — depois
  // refinamos com nossos próprios extratores.
  const parsed = parseWhatsAppExpenseMessage(text, cartoes);
  // No fluxo de parcelamento o nosso `extrairValor` é a fonte da verdade:
  // entende formato BR ("1.200", "89,90"), detecta "R$" e ignora
  // "Nx/N vezes/N parcelas". O `parsed.valor` do parser de gasto comum
  // confunde a quantidade de parcelas com valor (ex.: "em 3 vezes"
  // → valor=3) e não deve ser usado aqui — nem como fallback.
  const valor = extrairValor(text);
  const descricao = (() => {
    const fromParser = parsed.nome && !deps.isGenericExpenseDescription(parsed.nome)
      ? parsed.nome
      : "";
    if (fromParser && fromParser.length >= 2) return fromParser;
    const d = extrairDescricao(text);
    return d && d.length >= 2 ? d : "";
  })();
  const { match, ambiguous } = deps.matchCartao(text, cartoes);
  return {
    descricao,
    valorTotal: valor ?? null,
    totalParcelas: intent.count,
    cartaoId: match?.id ?? null,
    cartaoNome: match ? deps.displayCartaoNome(match) : (parsed.cartaoNomeDetectado ?? null),
    cartaoAmbiguous: ambiguous && ambiguous.length > 1 ? ambiguous : null,
  };
}

// ---------- mensagens ----------

function previewMessage(args: {
  descricao: string;
  valorTotal: number;
  totalParcelas: number;
  cartaoNome: string;
  primeiraYm: string;
  categoria: string;
}): string {
  const parcelaCent = calcularParcelasCentavos(reaisParaCentavos(args.valorTotal), args.totalParcelas);
  const valorPrim = parcelaCent[0] / 100;
  const valorPrimFmt = formatBRL(valorPrim);
  return [
    "Confere pra mim? 👀",
    "",
    `• Descrição: ${args.descricao}`,
    `• Valor total: ${formatBRL(args.valorTotal)}`,
    `• Parcelamento: ${args.totalParcelas}x de ${valorPrimFmt}`,
    `• Cartão: ${args.cartaoNome}`,
    `• Primeira parcela: ${nomeMes(args.primeiraYm)}`,
    `• Categoria: ${args.categoria}`,
    "",
    'Responda "sim" para confirmar ou diga o que deseja ajustar.',
  ].join("\n");
}

function askValor(): string {
  return "Qual foi o valor total da compra?\nEx.: R$ 300,00";
}
function askQuantidade(): string {
  return `Em quantas parcelas você dividiu? (mínimo ${MIN_PARCELAS}, máximo ${MAX_PARCELAS})`;
}
function askCartao(cartoes: Cartao[], deps: Pick<WhatsAppParcelamentoDeps, "maskCartaoLabel">): string {
  const linhas = cartoes.map((c) => `• ${deps.maskCartaoLabel(c)}`).join("\n");
  return `Em qual cartão foi essa compra?\n\n${linhas}`;
}

// ---------- handler ----------

export async function processarParcelamento(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  decisao: "confirm" | "cancel" | "outro";
  sessao: { id: string; status: string; session: unknown; recebida_em: string } | null;
  deps: WhatsAppParcelamentoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao, deps } = args;
  const cartoes = await deps.carregarCartoes(userId);
  // Cancelamento explícito vence sobre tudo.
  const isHardCancel = /\b(cancelar|cancela|cancelado|cancelada)\b/i.test(texto) || decisao === "cancel";
  if (sessao && isHardCancel) {
    await deps.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    await deps.gravarSessao(
      userId, msg.telefone, msg.external_id, texto, recebidaEm,
      "cancelada",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessao.session as any,
      "Compra parcelada cancelada. Quando quiser, é só me contar de novo. 👍",
    );
    logDecision({
      stage: "cancelled",
      installmentsCountPresent: !!(sessao.session as ParcelamentoSession)?.totalParcelas,
      cardMatchedCount: 0,
      result: "ok",
    });
    return { status: "cancelada", resposta: "Compra parcelada cancelada. Quando quiser, é só me contar de novo. 👍" };
  }

  // Sem sessão: inicia a partir do texto.
  if (!sessao) {
    const intent = detectInstallmentIntent(texto);
    if (!intent) {
      // Não deveria entrar aqui — quem roteia já checou. Defensivo.
      return { status: "sem_pendencia", resposta: "" };
    }
    const draft = parseInstallmentMessage(texto, cartoes, intent, deps);
    logDecision({
      stage: "detected",
      installmentsCountPresent: true,
      cardMatchedCount: draft.cartaoId ? 1 : (draft.cartaoAmbiguous?.length ?? 0),
      result: "ok",
    });
    return await avancarFluxo({ userId, msg, texto, recebidaEm, deps,
      session: {
        kind: "parcelamento",
        mensagemOriginal: texto,
        descricao: draft.descricao || undefined,
        valorTotal: draft.valorTotal ?? undefined,
        totalParcelas: draft.totalParcelas,
        cartaoId: draft.cartaoId ?? undefined,
        cartaoNome: draft.cartaoNome ?? undefined,
        source: msg.source ?? "text",
      },
      cartoes,
      sessaoId: null,
      cartaoAmbiguous: draft.cartaoAmbiguous,
    });
  }

  const current = sessao.status;
  const session = (sessao.session as ParcelamentoSession) ?? {
    kind: "parcelamento",
    mensagemOriginal: texto,
    totalParcelas: 0,
  };

  // Em qualquer estado: aceita ajustes em frases livres (valor, qtd parcelas, cartão).
  if (current === "parc_aguardando_total") {
    const v = extrairValor(texto);
    if (!v || v <= 0) {
      const r = `Não consegui ler o valor. ${askValor()}`;
      await deps.atualizarSessao(sessao.id, "parc_aguardando_total", session as unknown as never, r);
      return { status: "pendente", resposta: r };
    }
    session.valorTotal = v;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_quantidade") {
    const n = extrairQuantidadeParcelas(texto);
    if (!n) {
      const r = `Não consegui ler. ${askQuantidade()}`;
      await deps.atualizarSessao(sessao.id, "parc_aguardando_quantidade", session as unknown as never, r);
      return { status: "pendente", resposta: r };
    }
    session.totalParcelas = n;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_cartao") {
    const { match, ambiguous } = deps.matchCartao(texto, cartoes);
    if (ambiguous && ambiguous.length > 1) {
      const r = `Achei mais de um cartão parecido: ${ambiguous.join(", ")}. Me diga o nome exato.`;
      await deps.atualizarSessao(sessao.id, "parc_aguardando_cartao", session as unknown as never, r);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: ambiguous.length, result: "ambiguous" });
      return { status: "pendente", resposta: r };
    }
    if (!match) {
      const r = `Não encontrei esse cartão. ${askCartao(cartoes, deps)}`;
      await deps.atualizarSessao(sessao.id, "parc_aguardando_cartao", session as unknown as never, r);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: 0, result: "invalid" });
      return { status: "pendente", resposta: r };
    }
    session.cartaoId = match.id;
    session.cartaoNome = deps.displayCartaoNome(match);
    return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_confirmacao") {
    // WA-F3.3 — comandos de categoria têm prioridade sobre "sim".
    const catCmd = deps.detectCategoriaCommand(texto);
    if (catCmd) {
      return await handleCategoriaCmd({
        userId, msg, texto, recebidaEm, session, sessaoId: sessao.id, deps, cartoes, cmd: catCmd,
      });
    }
    if (decisao === "confirm") {
      return await persistir({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id, deps });
    }
    // Ajuste por frase livre: tenta reinterpretar campos do texto.
    const intent = detectInstallmentIntent(texto);
    if (intent) session.totalParcelas = intent.count;
    const v = extrairValor(texto);
    if (v && v > 0 && /\b(valor|certo|na verdade|foi|paguei|total)\b/i.test(texto)) {
      session.valorTotal = v;
    }
    const { match } = deps.matchCartao(texto, cartoes);
    if (match) {
      session.cartaoId = match.id;
      session.cartaoNome = deps.displayCartaoNome(match);
    }
    return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId: sessao.id });
  }

  // WA-F3.3 — picker de categoria ativo: trata qualquer mensagem como
  // input do picker (número, nome, "ver todas", "mais", "voltar"). "sim"
  // dentro do picker NÃO confirma a compra — é tratado como termo
  // inválido, evitando criar parcelas sem o usuário escolher categoria.
  if (current === "parc_aguardando_categoria") {
    const cats = await deps.loadCategoriasParaPicker(userId);
    const r = await deps.resolveCategoriaPickerInput({
      userId,
      holder: {
        descricao: session.descricao ?? null,
        categoriaSugerida: null,
        categoriaOptions: session.categoriaOptions,
      },
      cats,
      texto,
    });
    if (r.kind === "picked") {
      session.categorySelectionSource = "manual";
      session.manualCategoriaId = r.cat.id;
      session.manualCategoriaLabel = r.cat.nome;
      session.categoriaOptions = undefined;
      return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId: sessao.id });
    }
    if (r.kind === "relist") {
      session.categoriaOptions = r.options;
      await deps.atualizarSessao(sessao.id, "parc_aguardando_categoria", session as unknown as never, r.body);
      return { status: "parc_aguardando_categoria", resposta: r.body };
    }
    const aviso = `Não entendi. Digite o número, o nome da categoria, "mais" para ver outras opções ou "cancelar".`;
    await deps.atualizarSessao(sessao.id, "parc_aguardando_categoria", session as unknown as never, aviso);
    return { status: "parc_aguardando_categoria", resposta: aviso };
  }

  return { status: "sem_pendencia", resposta: "" };
}

// WA-F3.3 — trata comandos de categoria durante `parc_aguardando_confirmacao`.
async function handleCategoriaCmd(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ParcelamentoSession;
  sessaoId: string;
  deps: WhatsAppParcelamentoDeps;
  cartoes: Cartao[];
  cmd: CategoriaCmdIntent;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, sessaoId, deps, cartoes, cmd } = args;
  const cats = await deps.loadCategoriasParaPicker(userId);
  if (cmd.kind === "ask") {
    const { body, options } = await deps.buildCategoriaListBody({
      userId,
      holder: { descricao: session.descricao ?? null, categoriaSugerida: null },
      cats,
    });
    session.categoriaOptions = options;
    const resposta = `Qual categoria devo usar?\n\n${body}`;
    await deps.atualizarSessao(sessaoId, "parc_aguardando_categoria", session as unknown as never, resposta);
    return { status: "parc_aguardando_categoria", resposta };
  }
  // direct
  const r = await deps.resolveCategoriaPickerInput({
    userId,
    holder: { descricao: session.descricao ?? null, categoriaSugerida: null, categoriaOptions: undefined },
    cats,
    texto: cmd.termo,
  });
  if (r.kind !== "picked") {
    const resposta = `Não encontrei a categoria "${cmd.termo}". Digite "categoria" para ver a lista de opções.`;
    await deps.atualizarSessao(sessaoId, "parc_aguardando_confirmacao", session as unknown as never, resposta);
    return { status: "aguardando_confirmacao", resposta };
  }
  session.categorySelectionSource = "manual";
  session.manualCategoriaId = r.cat.id;
  session.manualCategoriaLabel = r.cat.nome;
  session.categoriaOptions = undefined;
  return await avancarFluxo({ userId, msg, texto, recebidaEm, deps, session, cartoes, sessaoId });
}

async function avancarFluxo(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ParcelamentoSession;
  cartoes: Cartao[];
  sessaoId: string | null;
  cartaoAmbiguous?: string[] | null;
  deps: WhatsAppParcelamentoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, cartoes, sessaoId, deps } = args;

  // 1) Valor faltando → pergunta.
  if (!session.valorTotal || session.valorTotal <= 0) {
    const r = askValor();
    await persistTransition("parc_aguardando_total", session, r, sessaoId, args);
    logDecision({ stage: "awaiting_total", installmentsCountPresent: true, cardMatchedCount: cartoes.length, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 2) Quantidade faltando ou inválida → pergunta.
  if (
    !session.totalParcelas ||
    session.totalParcelas < MIN_PARCELAS ||
    session.totalParcelas > MAX_PARCELAS
  ) {
    const r = askQuantidade();
    await persistTransition("parc_aguardando_quantidade", session, r, sessaoId, args);
    logDecision({ stage: "awaiting_quantity", installmentsCountPresent: false, cardMatchedCount: cartoes.length, result: "ok" });
    return { status: "pendente", resposta: r };
  }

  // 3) Cartão: se há ambiguidade ou nenhum cartão indicado e existem >1.
  if (!session.cartaoId) {
    if (args.cartaoAmbiguous && args.cartaoAmbiguous.length > 1) {
      const r = `Achei mais de um cartão parecido: ${args.cartaoAmbiguous.join(", ")}. Me diga o nome exato.`;
      await persistTransition("parc_aguardando_cartao", session, r, sessaoId, args);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: args.cartaoAmbiguous.length, result: "ambiguous" });
      return { status: "pendente", resposta: r };
    }
    if (cartoes.length === 0) {
      const r = "Você ainda não tem cartões cadastrados no Gasto Inteligente. Cadastre o cartão pelo app antes de lançar uma compra parcelada.";
      await persistTransition("cancelada", session, r, sessaoId, args);
      logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 0, result: "invalid" });
      return { status: "erro", resposta: r };
    }
    if (cartoes.length === 1) {
      session.cartaoId = cartoes[0].id;
      session.cartaoNome = deps.displayCartaoNome(cartoes[0]);
    } else {
      const r = askCartao(cartoes, deps);
      await persistTransition("parc_aguardando_cartao", session, r, sessaoId, args);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: cartoes.length, result: "ok" });
      return { status: "pendente", resposta: r };
    }
  }

  // 4) Descrição: se ainda for vazia, usa um label genérico de momento.
  if (!session.descricao || session.descricao.length < 2 || deps.isGenericExpenseDescription(session.descricao)) {
    session.descricao = "Compra parcelada";
  }

  // 5) Tudo pronto → preview + aguarda confirmação.
  const cartao = cartoes.find((c) => c.id === session.cartaoId);
  const dia = cartao?.diaFechamento ?? 1;
  const plano = criarPlanoParcelamento({
    totalReais: session.valorTotal!,
    totalParcelas: session.totalParcelas!,
    diaFechamentoCartao: dia,
  });
  const sugestaoCat = suggestCategoryFromText(session.descricao) || "outros";
  const categoriaLabel =
    sugestaoCat === "outros" ? "Outros" :
    sugestaoCat.charAt(0).toUpperCase() + sugestaoCat.slice(1);
  const resposta = previewMessage({
    descricao: session.descricao,
    valorTotal: plano.total,
    totalParcelas: plano.totalParcelas,
    cartaoNome: session.cartaoNome ?? "cartão",
    primeiraYm: plano.parcelas[0].invoiceMonth,
    categoria: categoriaLabel,
  });
  await persistTransition("parc_aguardando_confirmacao", session, resposta, sessaoId, args);
  logDecision({ stage: "awaiting_confirmation", installmentsCountPresent: true, cardMatchedCount: 1, result: "ok" });
  return { status: "aguardando_confirmacao", resposta };
}

async function persistTransition(
  newStatus: string,
  session: ParcelamentoSession,
  resposta: string,
  sessaoId: string | null,
  args: { userId: string; msg: WhatsAppMessageRow; texto: string; recebidaEm: string; deps: WhatsAppParcelamentoDeps },
): Promise<void> {
  const { userId, msg, texto, recebidaEm, deps } = args;
  if (sessaoId) {
    await supabaseAdmin.from("whatsapp_messages").update({ status: "expirada" }).eq("id", sessaoId);
  }
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    newStatus, session as unknown as never, resposta,
  );
}

// ---------- persistência ----------

async function carregarCategoriasMin(userId: string): Promise<Array<{ id: string; legacy_id?: string | null; nome: string }>> {
  const { data } = await supabaseAdmin
    .from("categorias")
    .select("id, legacy_id, nome")
    .eq("user_id", userId);
  return Array.isArray(data) ? data : [];
}

function resolveCategoriaId(
  cats: Array<{ id: string; legacy_id?: string | null; nome: string }>,
  descricao: string,
): { id: string | null; nome: string } {
  const key = suggestCategoryFromText(descricao) || "outros";
  const byLegacy = cats.find((c) => (c.legacy_id ?? "").toLowerCase() === key);
  if (byLegacy) return { id: byLegacy.id, nome: byLegacy.nome };
  const out = cats.find((c) => (c.legacy_id ?? "").toLowerCase() === "outros")
    ?? cats[0];
  return out ? { id: out.id, nome: out.nome } : { id: null, nome: "Outros" };
}

async function persistir(args: {
  userId: string;
  msg: WhatsAppMessageRow;
  texto: string;
  recebidaEm: string;
  session: ParcelamentoSession;
  cartoes: Cartao[];
  sessaoId: string;
  deps: WhatsAppParcelamentoDeps;
}): Promise<ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, cartoes, sessaoId, deps } = args;
  const cartao = cartoes.find((c) => c.id === session.cartaoId);
  if (!cartao || !session.valorTotal || !session.totalParcelas) {
    logDecision({ stage: "failed", installmentsCountPresent: !!session.totalParcelas, cardMatchedCount: 0, result: "error" });
    return { status: "erro", resposta: "Não consegui montar essa compra. Vamos começar de novo?" };
  }
  let plano;
  try {
    plano = criarPlanoParcelamento({
      totalReais: session.valorTotal,
      totalParcelas: session.totalParcelas,
      diaFechamentoCartao: cartao.diaFechamento,
    });
  } catch {
    logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 1, result: "error" });
    return { status: "erro", resposta: "Não consegui dividir esse valor nessas parcelas. Verifique e tente de novo." };
  }
  const cats = await carregarCategoriasMin(userId);
  const cat = resolveCategoriaId(cats, session.descricao ?? "Compra parcelada");
  const grupoId = randomUUID();
  const baseObs = `WhatsApp: ${session.mensagemOriginal}`.slice(0, 1000);

  // WA-F3.2 — persistência atômica via RPC `create_installment_purchase`.
  // A RPC roda como SECURITY DEFINER em transação única: ou TODAS as
  // parcelas são criadas, ou nenhuma. Valida `user_id` x `cartao_id`
  // server-side (defesa em profundidade adicional à RLS).
  const parcelasPayload = plano.parcelas.map((p) => ({
    numero: p.numero,
    valor: p.valor,
    data: p.data,
    mes: p.mes,
    ano: p.ano,
    invoice_month: p.invoiceMonth,
  }));
  const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc(
    "create_installment_purchase",
    {
      p_user_id: userId,
      p_cartao_id: cartao.id,
      p_categoria_id: cat.id,
      p_descricao: session.descricao,
      p_estabelecimento: session.descricao,
      p_observacao: baseObs,
      p_origem: "whatsapp",
      p_grupo_id: grupoId,
      p_total_parcelas: plano.totalParcelas,
      p_parcelas: parcelasPayload,
    },
  );
  if (rpcErr) {
    logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 1, result: "error" });
    return { status: "erro", resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?" };
  }

  // Readback: confirma que TODAS as parcelas foram efetivamente gravadas
  // sob o mesmo grupo_parcelamento_id antes de informar sucesso.
  const { data: readback, error: readErr } = await supabaseAdmin
    .from("gastos")
    .select("id, parcela_atual")
    .eq("user_id", userId)
    .eq("grupo_parcelamento_id", grupoId);
  const rbRows: Array<{ id: string; parcela_atual: number | null }> =
    Array.isArray(readback) ? readback : Array.isArray(rpcRows) ? rpcRows : [];
  if (readErr || rbRows.length !== plano.totalParcelas) {
    logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 1, result: "error" });
    return {
      status: "erro",
      resposta: "Salvei mas não consegui confirmar todas as parcelas. Pode me chamar de novo em alguns minutos?",
    };
  }
  const inseridos: string[] = rbRows
    .slice()
    .sort((a, b) => (a.parcela_atual ?? 0) - (b.parcela_atual ?? 0))
    .map((r) => r.id);

  // Fecha sessões e grava marca "salva".
  await deps.fecharSessoesAnteriores(userId, msg.telefone, "salva", inseridos[0]);
  await deps.gravarSessao(
    userId, msg.telefone, msg.external_id, texto, recebidaEm,
    "salva",
    {
      ...session,
      grupo_parcelamento_id: grupoId,
      gasto_ids: inseridos,
      status: "salva",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    "ok",
    inseridos[0],
  );

  // Memória de estabelecimento — UMA vez por compra confirmada.
  const key = merchantKeyFor(session.descricao ?? "");
  if (key && cat.id) {
    try {
      await recordMerchantMemory({
        userId,
        merchantKey: key,
        categoryId: cat.id,
        evidence: "confirmed",
      });
    } catch {
      /* memória nunca quebra o fluxo */
    }
  }

  const valorPrim = plano.parcelas[0].valor;
  const resposta = [
    "Pronto! Registrei sua compra parcelada ✅",
    "",
    `${session.descricao} — ${plano.totalParcelas}x de ${formatBRL(valorPrim)} no ${session.cartaoNome}.`,
    `A primeira parcela entra na fatura de ${nomeMes(plano.parcelas[0].invoiceMonth)}.`,
  ].join("\n");
  logDecision({ stage: "confirmed", installmentsCountPresent: true, cardMatchedCount: 1, result: "ok" });
  return { status: "salva", gastoId: inseridos[0], resposta };
}
