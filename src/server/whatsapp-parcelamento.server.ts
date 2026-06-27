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
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";
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
// IMPORTANT: import as namespace to preserve ESM live bindings.
// whatsapp.server.ts imports back from this module — a default named
// import would snapshot bindings as `undefined` during initialisation.
import * as wa from "./whatsapp.server";
import type { WhatsAppMessageRow } from "./whatsapp.server";
import { recordMerchantMemory, merchantKeyFor } from "./whatsapp-merchant-memory.server";
import { randomUUID } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

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

/** Extrai valor monetário (R$) do texto. Aceita "R$ 89,90", "1.200",
 *  "2 mil reais", "300 reais", "1500". */
export function extrairValor(textRaw: string): number | null {
  const t = normalize(textRaw);
  // 2 mil reais → 2000
  const mil = t.match(/\b(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (mil) {
    const base = Number(mil[1].replace(",", "."));
    if (Number.isFinite(base)) return Math.round(base * 1000 * 100) / 100;
  }
  // R$ 89,90 / 1.200,00 / 89,90 / 1200 / 1.200 / 1200.50
  const re =
    /\b(?:r\$?\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\b(?!\s*(?:x|vezes|parcelas|presta))/;
  const m = t.match(re);
  if (!m) return null;
  const raw = m[1];
  const norm = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : (raw.match(/\.\d{1,2}$/) ? raw : raw.replace(/\./g, ""));
  const n = Number(norm);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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
): ParcelamentoDraft {
  // Reusa o parser principal só para resolver cartão e valor — depois
  // refinamos com nossos próprios extratores.
  const parsed = parseWhatsAppExpenseMessage(text, cartoes);
  const valor = parsed.valor && parsed.valor > 0 ? parsed.valor : extrairValor(text);
  const descricao = (() => {
    const fromParser = parsed.nome && !wa.isGenericExpenseDescription(parsed.nome)
      ? parsed.nome
      : "";
    if (fromParser && fromParser.length >= 2) return fromParser;
    const d = extrairDescricao(text);
    return d && d.length >= 2 ? d : "";
  })();
  const { match, ambiguous } = wa.matchCartao(text, cartoes);
  return {
    descricao,
    valorTotal: valor ?? null,
    totalParcelas: intent.count,
    cartaoId: match?.id ?? null,
    cartaoNome: match ? wa.displayCartaoNome(match) : (parsed.cartaoNomeDetectado ?? null),
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
function askCartao(cartoes: Cartao[]): string {
  const linhas = cartoes.map((c) => `• ${wa.maskCartaoLabel(c)}`).join("\n");
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
}): Promise<wa.ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, decisao, sessao } = args;
  console.log("[parc-deps]", { hasCarregarCartoes: typeof wa.carregarCartoes });
  const cartoes = await wa.carregarCartoes(userId);
  console.log("[parc-cartoes-loaded]", { len: cartoes.length });
  // Cancelamento explícito vence sobre tudo.
  const isHardCancel = /\b(cancelar|cancela|cancelado|cancelada)\b/i.test(texto) || decisao === "cancel";
  if (sessao && isHardCancel) {
    await wa.fecharSessoesAnteriores(userId, msg.telefone, "cancelada");
    await wa.gravarSessao(
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
    const draft = parseInstallmentMessage(texto, cartoes, intent);
    logDecision({
      stage: "detected",
      installmentsCountPresent: true,
      cardMatchedCount: draft.cartaoId ? 1 : (draft.cartaoAmbiguous?.length ?? 0),
      result: "ok",
    });
    return await avancarFluxo({
      userId, msg, texto, recebidaEm,
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
      await wa.atualizarSessao(sessao.id, "parc_aguardando_total", session as unknown as never, r);
      return { status: "pendente", resposta: r };
    }
    session.valorTotal = v;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_quantidade") {
    const n = extrairQuantidadeParcelas(texto);
    if (!n) {
      const r = `Não consegui ler. ${askQuantidade()}`;
      await wa.atualizarSessao(sessao.id, "parc_aguardando_quantidade", session as unknown as never, r);
      return { status: "pendente", resposta: r };
    }
    session.totalParcelas = n;
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_cartao") {
    const { match, ambiguous } = wa.matchCartao(texto, cartoes);
    if (ambiguous && ambiguous.length > 1) {
      const r = `Achei mais de um cartão parecido: ${ambiguous.join(", ")}. Me diga o nome exato.`;
      await wa.atualizarSessao(sessao.id, "parc_aguardando_cartao", session as unknown as never, r);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: ambiguous.length, result: "ambiguous" });
      return { status: "pendente", resposta: r };
    }
    if (!match) {
      const r = `Não encontrei esse cartão. ${askCartao(cartoes)}`;
      await wa.atualizarSessao(sessao.id, "parc_aguardando_cartao", session as unknown as never, r);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: 0, result: "invalid" });
      return { status: "pendente", resposta: r };
    }
    session.cartaoId = match.id;
    session.cartaoNome = wa.displayCartaoNome(match);
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id });
  }

  if (current === "parc_aguardando_confirmacao") {
    if (decisao === "confirm") {
      // Ajustes posteriores ao "sim" não são esperados.
      return await persistir({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id });
    }
    // Ajuste por frase livre: tenta reinterpretar campos do texto.
    const intent = detectInstallmentIntent(texto);
    if (intent) session.totalParcelas = intent.count;
    const v = extrairValor(texto);
    if (v && v > 0 && /\b(valor|certo|na verdade|foi|paguei|total)\b/i.test(texto)) {
      session.valorTotal = v;
    }
    const { match } = wa.matchCartao(texto, cartoes);
    if (match) {
      session.cartaoId = match.id;
      session.cartaoNome = wa.displayCartaoNome(match);
    }
    return await avancarFluxo({ userId, msg, texto, recebidaEm, session, cartoes, sessaoId: sessao.id });
  }

  return { status: "sem_pendencia", resposta: "" };
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
}): Promise<wa.ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, cartoes, sessaoId } = args;

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
    console.log("[parc-debug]", { cartoesLen: cartoes.length, cartoesNames: cartoes.map(c=>c.nome) });
    if (cartoes.length === 0) {
      const r = "Você ainda não tem cartões cadastrados no Gasto Inteligente. Cadastre o cartão pelo app antes de lançar uma compra parcelada.";
      await persistTransition("cancelada", session, r, sessaoId, args);
      logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 0, result: "invalid" });
      return { status: "erro", resposta: r };
    }
    if (cartoes.length === 1) {
      session.cartaoId = cartoes[0].id;
      session.cartaoNome = wa.displayCartaoNome(cartoes[0]);
    } else {
      const r = askCartao(cartoes);
      await persistTransition("parc_aguardando_cartao", session, r, sessaoId, args);
      logDecision({ stage: "awaiting_card", installmentsCountPresent: true, cardMatchedCount: cartoes.length, result: "ok" });
      return { status: "pendente", resposta: r };
    }
  }

  // 4) Descrição: se ainda for vazia, usa um label genérico de momento.
  if (!session.descricao || session.descricao.length < 2 || wa.isGenericExpenseDescription(session.descricao)) {
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
  args: { userId: string; msg: WhatsAppMessageRow; texto: string; recebidaEm: string },
): Promise<void> {
  const { userId, msg, texto, recebidaEm } = args;
  if (sessaoId) {
    await supabaseAdmin.from("whatsapp_messages").update({ status: "expirada" }).eq("id", sessaoId);
  }
  await wa.gravarSessao(
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
}): Promise<wa.ProcessOutcome> {
  const { userId, msg, texto, recebidaEm, session, cartoes, sessaoId } = args;
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

  // Monta o batch de inserts.
  const baseObs = `WhatsApp: ${session.mensagemOriginal}`.slice(0, 1000);
  const rows = plano.parcelas.map((p) => ({
    user_id: userId,
    categoria_id: cat.id,
    descricao: session.descricao,
    estabelecimento: session.descricao,
    valor: p.valor,
    data: p.data,
    mes: p.mes,
    ano: p.ano,
    invoice_month: p.invoiceMonth,
    forma_pagamento: "credito" as const,
    cartao_id: cartao.id,
    tipo_gasto: "parcelado",
    parcela_atual: p.numero,
    total_parcelas: plano.totalParcelas,
    grupo_parcelamento_id: grupoId,
    observacao: baseObs,
    origem: "whatsapp",
    confirmado: true,
  }));

  // Insere uma a uma para preservar ids e respeitar o mock simples.
  const inseridos: string[] = [];
  for (const row of rows) {
    const { data, error } = await supabaseAdmin
      .from("gastos")
      .insert(row)
      .select("id")
      .single();
    if (error || !data?.id) {
      logDecision({ stage: "failed", installmentsCountPresent: true, cardMatchedCount: 1, result: "error" });
      // Tentativa de rollback best-effort.
      if (inseridos.length > 0) {
        await supabaseAdmin.from("gastos").delete().eq("grupo_parcelamento_id", grupoId);
      }
      return { status: "erro", resposta: "Não consegui salvar agora. Pode tentar de novo daqui a pouco?" };
    }
    inseridos.push(data.id);
  }

  // Fecha sessões e grava marca "salva".
  await wa.fecharSessoesAnteriores(userId, msg.telefone, "salva", inseridos[0]);
  await wa.gravarSessao(
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
