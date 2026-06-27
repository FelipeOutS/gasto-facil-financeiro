/**
 * WA-F1 — Consulta de FATURA ATUAL via WhatsApp.
 *
 * Apenas LEITURA. Detecta perguntas como "fatura", "quanto está minha
 * fatura", "fatura do Nubank", "quando vence minha fatura", "qual cartão
 * está com a maior fatura" e responde com base nos cartões e gastos reais
 * do próprio usuário. Reutiliza o helper `cartao-fatura.server.ts` (que
 * espelha as regras do site) — nunca duplica cálculo financeiro aqui.
 *
 * Garantias:
 * - Não cria/atualiza gasto, cartão, fatura, sessão, memória ou alerta.
 * - Não envia notificação automática.
 * - Filtra estritamente por `userId` (autorizado pelo gate canônico).
 * - Log seguro: nunca inclui valor, nome de cartão, telefone, userId
 *   ou texto da pergunta.
 */
import {
  loadCartoesDoUsuario,
  findCartoesDoUsuarioByTerm,
  getFaturaAtualPorCartao,
  getResumoFaturasAtuais,
  getItensFaturaAtualPorCartao,
  getResumoItensFaturaAtual,
  nowInAppTz,
  // WA-F4 — faturas futuras e parcelas em aberto.
  getFaturaPorMes,
  getResumoFaturasPorMes,
  getComprasParceladasEmAberto,
  getDetalheCompraParcelada,
  findCompraParceladaByTerm,
  parseInvoiceMonth,
  type CartaoRow,
  type FaturaAtual,
  type ItemFatura,
  type CompraParcelada,
} from "./cartao-fatura.server";



export type FaturaIntent =
  | { kind: "invoice_total" }
  | { kind: "invoice_card"; termo: string }
  | { kind: "invoice_due_date"; termo: string | null }
  | { kind: "invoice_closing_date"; termo: string | null }
  | { kind: "invoice_highest" }
  // WA-F2 — detalhamento de fatura
  | { kind: "invoice_items"; termo: string | null }
  | { kind: "invoice_recent"; termo: string | null }
  | { kind: "invoice_largest"; termo: string | null };

/** Modo da paginação WA-F2 (apenas em sessão temporária). */
export type FaturaDetailMode = "recentes" | "maiores";

/** Estado mínimo de paginação. NUNCA contém valor, descrição, telefone, etc. */
export type FaturaDetailSessionState = {
  kind: "consulta_fatura";
  cartaoId: string;
  mode: FaturaDetailMode;
  page: number;
};

export type FaturaResult =
  | { status: "answered"; resposta: string }
  | { status: "answered"; resposta: string; nextSession: FaturaDetailSessionState }
  | { status: "card_not_found"; resposta: string }
  | { status: "ambiguous_card"; resposta: string }
  | { status: "no_invoice_data"; resposta: string }
  | { status: "no_more_items"; resposta: string };


function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDDMM(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/**
 * Detecta intenção de consulta de fatura. Retorna null quando a mensagem
 * não é claramente sobre fatura/cartão de crédito. Não interpreta
 * "Uber 29,90" como fatura — exige token "fatura", "cart[ãa]o" + verbos
 * de consulta, ou "quanto devo no cart[ãa]o".
 */
export function detectFaturaIntent(texto: string): FaturaIntent | null {
  const t = norm(texto);
  if (!t) return null;

  // WA-F2 — detalhamento. Estes padrões precisam vir ANTES das regras
  // genéricas do WA-F1: "compras do Nubank" não deve cair em invoice_card.

  // "maiores compras", "maiores gastos do <cartao>", "onde gastei mais
  // no cartao", "compras mais caras"
  if (
    /\bmaior(?:es)?\s+(?:compras?|gastos?|lan[cç]amentos?)\b/.test(t) ||
    /\b(?:compras?|gastos?)\s+mais\s+(?:caras?|altas?|gordas?)\b/.test(t) ||
    /\bonde\s+(?:eu\s+)?gastei\s+mais\b/.test(t)
  ) {
    return { kind: "invoice_largest", termo: extractCartaoTermo(t) };
  }

  // "últimas compras", "compras recentes do cartão"
  if (
    /\b(?:ultim(?:a|as)|recentes?)\s+(?:compras?|gastos?|lan[cç]amentos?)\b/.test(t) ||
    /\b(?:compras?|gastos?|lan[cç]amentos?)\s+recentes?\b/.test(t) ||
    /\bo\s+que\s+(?:eu\s+)?comprei\s+(?:recentemente|hoje)\b.*\b(?:cart(?:ao|oes)|credito|fatura)\b/.test(t)
  ) {
    return { kind: "invoice_recent", termo: extractCartaoTermo(t) };
  }

  // "o que tem na minha fatura", "quais compras estão na fatura",
  // "compras da fatura", "compras do cartao", "me mostra as compras
  // do Nubank", "ver fatura do Inter"
  if (
    /\bo\s+que\s+tem\s+na\b.*\bfatura\b/.test(t) ||
    /\b(?:quais|que)\s+(?:compras?|gastos?|lan[cç]amentos?)\b/.test(t) ||
    /\b(?:compras?|gastos?|lan[cç]amentos?)\s+(?:da|do|na|no)\s+(?:fatura|cart(?:ao|oes)|credito)\b/.test(t) ||
    /\b(?:me\s+)?mostr(?:a|e|ar)\s+(?:as\s+)?(?:compras?|gastos?|lan[cç]amentos?|fatura)\b/.test(t) ||
    /\bver\s+(?:as\s+)?(?:compras?|gastos?|lan[cç]amentos?|fatura)\b/.test(t) ||
    /\bdetalh(?:ar|es?)\s+(?:a\s+)?fatura\b/.test(t)
  ) {
    return { kind: "invoice_items", termo: extractCartaoTermo(t) };
  }

  // "compras do <cartao>" / "gastos do <cartao>" — só dispara quando
  // há nome de cartão reconhecível, para não capturar frases neutras
  // como "compras do mercado".
  if (/\b(?:compras?|gastos?|lan[cç]amentos?)\s+(?:da|do|na|no)\b/.test(t)) {
    const termo = extractCartaoTermo(t);
    if (termo) return { kind: "invoice_items", termo };
  }


  // ---- WA-F1 (mantido) ----

  // "qual cartão está com a maior fatura?" / "fatura mais alta"
  if (
    /\b(qual|que)\b.*\bcart(ao|oes)\b.*\bmaior\b.*\bfatura\b/.test(t) ||
    /\bcart(ao|oes)\b.*\bmaior\b.*\bfatura\b/.test(t) ||
    /\bmaior\s+fatura\b/.test(t) ||
    /\bfatura\b.*\bmais\s+alta\b/.test(t)
  ) {
    return { kind: "invoice_highest" };
  }

  // "quando vence" → vencimento (com ou sem nome de cartão)
  if (/\b(quando|qual.*dia)\b.*\bvenc(e|imento)\b/.test(t)) {
    if (/\b(fatura|cart(ao|oes))\b/.test(t)) {
      const termo = extractCartaoTermo(t);
      return { kind: "invoice_due_date", termo };
    }
  }

  // "quando fecha meu cartão" → fechamento
  if (/\b(quando|qual.*dia)\b.*\bfech(a|amento)\b/.test(t)) {
    if (/\b(fatura|cart(ao|oes))\b/.test(t)) {
      const termo = extractCartaoTermo(t);
      return { kind: "invoice_closing_date", termo };
    }
  }

  // "quanto devo no cartão" / "quanto devo de cartão"
  if (/\bquanto\b.*\bdevo\b.*\bcart(ao|oes)\b/.test(t)) {
    return { kind: "invoice_total" };
  }

  // Qualquer menção a "fatura" → consulta. Se vier com termo de cartão,
  // vira invoice_card. Se for genérica, invoice_total.
  if (/\bfatura\b/.test(t)) {
    const termo = extractCartaoTermo(t);
    if (termo) return { kind: "invoice_card", termo };
    return { kind: "invoice_total" };
  }

  return null;
}


/**
 * Extrai um possível nome de cartão a partir da pergunta. Captura padrões
 * como "fatura do X", "fatura da X", "fatura X", "cartao X". Retorna
 * null se nada plausível for encontrado. NÃO valida que o termo seja um
 * cartão real — isso é feito pelo handler com filtro por user_id.
 */
function extractCartaoTermo(t: string): string | null {
  const STOP =
    /^(atual|aberta|fechada|mais|maior|maiores|do|da|de|dos|das|no|na|nos|nas|minha|meu|meus|minhas|cart(?:ao|oes)|credito|fatura|recente|recentes|ultimas?|compras?|gastos?|lan[cç]amentos?)$/;

  let m = t.match(/\bfatura\s+(?:do|da|de|dos|das)\s+([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/);
  if (m) return m[1].trim();
  m = t.match(/\bfatura\s+([a-z0-9]{2,30})(?:\s*\?|\s*$)/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  m = t.match(/\bcart(?:ao|oes)\s+(?:do|da|de)?\s*([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/);
  if (m) {
    const c = m[1].trim();
    if (c && !STOP.test(c)) return c;
  }
  // WA-F2 — "compras do nubank", "gastos da caixa", "lancamentos do inter"
  m = t.match(
    /\b(?:compras?|gastos?|lan[cç]amentos?)\s+(?:do|da|de|dos|das|no|na)\s+([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/,
  );
  if (m) {
    const c = m[1].trim();
    if (c && !STOP.test(c)) return c;
  }
  return null;
}

function logFaturaQuery(args: {
  intent: FaturaIntent["kind"];
  cardsMatchedCount: number;
  result: FaturaResult["status"];
}) {
  // Log seguro: SEM userId, telefone, valores, nome do cartão ou texto.
  console.info({
    event: "wa_invoice_query",
    intent: args.intent,
    cardsMatchedCount: args.cardsMatchedCount,
    result: args.result,
  });
}

/**
 * WA-F2 — log seguro de detalhamento. NUNCA inclui userId, telefone,
 * texto, valor, descrição ou nome de cartão.
 */
function logFaturaDetailQuery(args: {
  intent: "invoice_items" | "invoice_recent" | "invoice_largest" | "invoice_page";
  cardsMatchedCount: number;
  itemsReturnedCount: number;
  result:
    | "answered"
    | "ambiguous_card"
    | "card_not_found"
    | "no_invoice_data"
    | "no_more_items";
}) {
  console.info({
    event: "wa_invoice_detail_query",
    intent: args.intent,
    cardsMatchedCount: args.cardsMatchedCount,
    itemsReturnedCount: args.itemsReturnedCount,
    result: args.result,
  });
}


function ambiguousCardMessage(cartoes: CartaoRow[]): string {
  const linhas = cartoes
    .map((c) => `• ${(c.nome ?? "").trim() || (c.banco ?? "").trim() || "Cartão"}`)
    .join("\n");
  return (
    "Encontrei mais de um cartão.\n\n" +
    "Digite o nome de um deles para eu consultar a fatura:\n" +
    linhas
  );
}

function noDataMessage(): string {
  return (
    "Ainda não encontrei dados suficientes para calcular essa fatura com segurança.\n\n" +
    "Confira se o cartão e os gastos foram cadastrados no Gasto Inteligente."
  );
}

function formatFaturaCard(f: FaturaAtual): string {
  const venc = formatDDMM(f.vencimento);
  const fech = formatDDMM(f.fechamento);
  const linhas: string[] = [];
  linhas.push(`Fatura atual do ${f.cartaoNome}: ${formatBRL(f.total)}`);
  linhas.push("");
  if (venc) linhas.push(`Vencimento: ${venc}`);
  if (fech) linhas.push(`Fechamento: ${fech}`);
  if (f.limite > 0) linhas.push(`Limite disponível: ${formatBRL(f.disponivel)}`);
  return linhas.join("\n");
}

export async function handleFaturaIntent(
  userId: string,
  intent: FaturaIntent,
): Promise<FaturaResult> {
  const hoje = nowInAppTz();

  // WA-F2 — dispatch para o handler de detalhamento.
  if (
    intent.kind === "invoice_items" ||
    intent.kind === "invoice_recent" ||
    intent.kind === "invoice_largest"
  ) {
    return handleFaturaDetailIntent(userId, intent);
  }


  if (intent.kind === "invoice_total") {
    const cartoes = await loadCartoesDoUsuario(userId);
    if (cartoes.length === 0) {
      const out: FaturaResult = { status: "no_invoice_data", resposta: noDataMessage() };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 0, result: out.status });
      return out;
    }
    const resumos: FaturaAtual[] = [];
    for (const c of cartoes) resumos.push(await getFaturaAtualPorCartao(userId, c, hoje));
    const ativos = resumos.filter((f) => f.total > 0);
    if (ativos.length === 0) {
      const out: FaturaResult = {
        status: "answered",
        resposta: `Sua fatura atual está em ${formatBRL(0)}.`,
      };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: cartoes.length, result: out.status });
      return out;
    }
    const total = ativos.reduce((s, f) => s + f.total, 0);
    const linhas = ativos
      .sort((a, b) => b.total - a.total)
      .map((f) => `• ${f.cartaoNome}: ${formatBRL(f.total)}`);
    const maior = ativos.reduce((a, b) => (b.total > a.total ? b : a));
    const corpo =
      `Sua fatura atual está em ${formatBRL(total)}.\n\n` +
      linhas.join("\n") +
      (ativos.length > 1 ? `\n\nCartão com maior fatura: ${maior.cartaoNome}.` : "");
    const out: FaturaResult = { status: "answered", resposta: corpo };
    logFaturaQuery({ intent: intent.kind, cardsMatchedCount: cartoes.length, result: out.status });
    return out;
  }

  if (intent.kind === "invoice_card") {
    const matches = await findCartoesDoUsuarioByTerm(userId, intent.termo);
    if (matches.length === 0) {
      const out: FaturaResult = {
        status: "card_not_found",
        resposta:
          `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
          `Confira o nome cadastrado no Gasto Inteligente.`,
      };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (matches.length > 1) {
      const out: FaturaResult = {
        status: "ambiguous_card",
        resposta: ambiguousCardMessage(matches),
      };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: matches.length, result: out.status });
      return out;
    }
    const f = await getFaturaAtualPorCartao(userId, matches[0], hoje);
    const out: FaturaResult = { status: "answered", resposta: formatFaturaCard(f) };
    logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 1, result: out.status });
    return out;
  }

  if (intent.kind === "invoice_due_date" || intent.kind === "invoice_closing_date") {
    const cartoes = intent.termo
      ? await findCartoesDoUsuarioByTerm(userId, intent.termo)
      : await loadCartoesDoUsuario(userId);
    if (cartoes.length === 0) {
      const out: FaturaResult = intent.termo
        ? {
            status: "card_not_found",
            resposta:
              `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
              `Confira o nome cadastrado no Gasto Inteligente.`,
          }
        : { status: "no_invoice_data", resposta: noDataMessage() };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (cartoes.length > 1) {
      const out: FaturaResult = {
        status: "ambiguous_card",
        resposta: ambiguousCardMessage(cartoes),
      };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: cartoes.length, result: out.status });
      return out;
    }
    const f = await getFaturaAtualPorCartao(userId, cartoes[0], hoje);
    const label = intent.kind === "invoice_due_date" ? "vence" : "fecha";
    const d = intent.kind === "invoice_due_date" ? f.vencimento : f.fechamento;
    const dStr = formatDDMM(d);
    if (!dStr) {
      const out: FaturaResult = { status: "no_invoice_data", resposta: noDataMessage() };
      logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 1, result: out.status });
      return out;
    }
    const out: FaturaResult = {
      status: "answered",
      resposta: `A fatura do ${f.cartaoNome} ${label} em ${dStr}.`,
    };
    logFaturaQuery({ intent: intent.kind, cardsMatchedCount: 1, result: out.status });
    return out;
  }

  // invoice_highest
  const resumos = await getResumoFaturasAtuais(userId, hoje);
  const ativos = resumos.filter((f) => f.total > 0);
  if (ativos.length === 0) {
    const out: FaturaResult = { status: "no_invoice_data", resposta: noDataMessage() };
    logFaturaQuery({ intent: intent.kind, cardsMatchedCount: resumos.length, result: out.status });
    return out;
  }
  const maior = ativos.reduce((a, b) => (b.total > a.total ? b : a));
  const out: FaturaResult = {
    status: "answered",
    resposta: `Cartão com a maior fatura: ${maior.cartaoNome} (${formatBRL(maior.total)}).`,
  };
  logFaturaQuery({ intent: intent.kind, cardsMatchedCount: resumos.length, result: out.status });
  return out;
}





// =====================================================================
// WA-F2 — Detalhamento de fatura: itens, recentes, maiores, paginação.
// =====================================================================

const PAGE_SIZE = 5;

/**
 * Limpa resíduos visuais de descrição sem alterar conteúdo financeiro
 * ou inventar dados novos. Mantém somente o radical legível para o
 * usuário. NUNCA infere estabelecimento ou categoria.
 */
export function cleanDescricaoDisplay(raw: string | null | undefined): string {
  let s = (raw ?? "").toString();
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "Compra no cartão";
  // Maquininha / adquirente: "UBER *TRIP" → "UBER"
  s = s.replace(/\s*\*\s*[A-Za-z0-9_]+\s*$/g, "");
  // "IFOOD*PEDIDO" → "IFOOD"
  s = s.replace(/\*\s*[A-Za-z0-9_]+\s*$/g, "");
  // Tira vírgulas/pontos finais soltos e separadores residuais
  s = s.replace(/[,;|·•\s.]+$/g, "").trim();
  if (!s) return "Compra no cartão";
  // Marcas conhecidas com capitalização específica (case-insensitive).
  const KNOWN: Record<string, string> = {
    uber: "Uber",
    ifood: "iFood",
    netflix: "Netflix",
    spotify: "Spotify",
    "99": "99",
    rappi: "Rappi",
  };
  const low = s.toLowerCase();
  if (KNOWN[low]) return KNOWN[low];
  // ALL CAPS curto → Title Case
  if (s.length <= 30 && s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return s;
}

/**
 * Reconhece comandos de paginação. Estritamente exato — frases livres
 * com a palavra "mais" no meio não acionam paginação.
 */
export type PaginationCommand = "next" | "prev" | "cancel";
export function detectPaginationCommand(texto: string): PaginationCommand | null {
  const t = norm(texto);
  if (!t) return null;
  if (/^(ver\s+mais|mais|proxim[ao]s?(?:\s+compras?)?|continuar|seguinte)$/.test(t))
    return "next";
  if (/^(voltar|anterior|pagina\s+anterior)$/.test(t)) return "prev";
  if (/^(cancelar|cancela|sair|encerrar|parar)$/.test(t)) return "cancel";
  return null;
}

function formatItemLine(it: ItemFatura, index: number, numbered: boolean): string {
  const desc = cleanDescricaoDisplay(it.descricao);
  const valor = formatBRL(it.valor);
  const parcela =
    it.parcelaAtual && it.totalParcelas && it.totalParcelas >= 2
      ? ` · ${it.parcelaAtual}/${it.totalParcelas}`
      : "";
  const prefix = numbered ? `${index + 1}.` : "•";
  return `${prefix} ${desc} — ${valor}${parcela}`;
}

function pageSliceOrEmpty<T>(items: T[], page: number): { slice: T[]; hasMore: boolean } {
  const safe = Math.max(0, Math.floor(page));
  const start = safe * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  return { slice, hasMore: items.length > start + PAGE_SIZE };
}

function formatItemsResponse(
  cartaoNome: string,
  itensOrdenados: ItemFatura[],
  page: number,
  mode: FaturaDetailMode,
  totalFatura: number,
): { resposta: string; itemsReturnedCount: number; hasMore: boolean } {
  const { slice, hasMore } = pageSliceOrEmpty(itensOrdenados, page);
  if (slice.length === 0) {
    return { resposta: "", itemsReturnedCount: 0, hasMore: false };
  }
  const numbered = mode === "maiores";
  const titulo =
    mode === "maiores"
      ? `Maiores compras na fatura atual do ${cartaoNome}:`
      : `Compras na fatura atual do ${cartaoNome}:`;
  const linhas = slice.map((it, i) => formatItemLine(it, page * PAGE_SIZE + i, numbered));
  const parcial = slice.reduce((s, it) => s + it.valor, 0);
  const partes: string[] = [titulo, "", ...linhas, ""];
  if (mode === "recentes") {
    partes.push(`Total parcial exibido: ${formatBRL(parcial)}`);
  }
  partes.push(`Fatura atual: ${formatBRL(totalFatura)}`);
  if (hasMore) {
    partes.push("");
    partes.push('Digite "ver mais" para continuar.');
  }
  return { resposta: partes.join("\n"), itemsReturnedCount: slice.length, hasMore };
}

function sortForMode(itens: ItemFatura[], mode: FaturaDetailMode): ItemFatura[] {
  const copy = itens.slice();
  if (mode === "maiores") {
    copy.sort((a, b) => b.valor - a.valor);
  } else {
    copy.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  }
  return copy;
}

function ambiguousDetailMessage(cartoes: CartaoRow[]): string {
  const linhas = cartoes
    .map((c) => `• ${(c.nome ?? "").trim() || (c.banco ?? "").trim() || "Cartão"}`)
    .join("\n");
  return (
    "Encontrei mais de uma fatura em aberto.\n\n" +
    "Digite o nome do cartão para ver as compras:\n" +
    linhas
  );
}

/**
 * Handler do WA-F2 — interpreta intenção de detalhamento e devolve a
 * resposta. Quando há mais de 5 itens, retorna `nextSession` com
 * apenas {kind, cartaoId, mode, page} para a paginação seguinte.
 */
export async function handleFaturaDetailIntent(
  userId: string,
  intent:
    | { kind: "invoice_items"; termo: string | null }
    | { kind: "invoice_recent"; termo: string | null }
    | { kind: "invoice_largest"; termo: string | null },
): Promise<FaturaResult> {
  const hoje = nowInAppTz();
  const mode: FaturaDetailMode = intent.kind === "invoice_largest" ? "maiores" : "recentes";

  // Resolver cartão: termo explícito → busca; sem termo → desambiguação
  // se houver mais de um cartão com fatura ativa.
  let cartaoAlvo: CartaoRow | null = null;

  if (intent.termo) {
    const matches = await findCartoesDoUsuarioByTerm(userId, intent.termo);
    if (matches.length === 0) {
      const resposta =
        `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
        `Confira o nome cadastrado no Gasto Inteligente.`;
      logFaturaDetailQuery({
        intent: intent.kind, cardsMatchedCount: 0, itemsReturnedCount: 0,
        result: "card_not_found",
      });
      return { status: "card_not_found", resposta };
    }
    if (matches.length > 1) {
      logFaturaDetailQuery({
        intent: intent.kind, cardsMatchedCount: matches.length, itemsReturnedCount: 0,
        result: "ambiguous_card",
      });
      return { status: "ambiguous_card", resposta: ambiguousDetailMessage(matches) };
    }
    cartaoAlvo = matches[0];
  } else {
    const resumos = await getResumoItensFaturaAtual(userId, hoje);
    const ativos = resumos.filter((r) => r.itens.length > 0);
    if (resumos.length === 0) {
      logFaturaDetailQuery({
        intent: intent.kind, cardsMatchedCount: 0, itemsReturnedCount: 0,
        result: "no_invoice_data",
      });
      return { status: "no_invoice_data", resposta: noDataMessage() };
    }
    if (ativos.length === 0) {
      logFaturaDetailQuery({
        intent: intent.kind, cardsMatchedCount: resumos.length, itemsReturnedCount: 0,
        result: "no_invoice_data",
      });
      return {
        status: "no_invoice_data",
        resposta:
          "Não encontrei compras na fatura atual.\n\n" +
          "Quando houver lançamentos no cartão, eu mostro aqui.",
      };
    }
    if (ativos.length > 1) {
      logFaturaDetailQuery({
        intent: intent.kind, cardsMatchedCount: ativos.length, itemsReturnedCount: 0,
        result: "ambiguous_card",
      });
      return {
        status: "ambiguous_card",
        resposta: ambiguousDetailMessage(ativos.map((a) => a.cartao)),
      };
    }
    cartaoAlvo = ativos[0].cartao;
  }

  return renderPage(userId, cartaoAlvo, mode, 0, intent.kind, hoje);
}

async function renderPage(
  userId: string,
  cartao: CartaoRow,
  mode: FaturaDetailMode,
  page: number,
  intentKind:
    | "invoice_items"
    | "invoice_recent"
    | "invoice_largest"
    | "invoice_page",
  hoje: Date,
): Promise<FaturaResult> {
  const fatura = await getFaturaAtualPorCartao(userId, cartao, hoje);
  const itens = await getItensFaturaAtualPorCartao(userId, cartao, hoje);
  const ordenados = sortForMode(itens, mode);

  if (page > 0 && page * PAGE_SIZE >= ordenados.length) {
    logFaturaDetailQuery({
      intent: intentKind, cardsMatchedCount: 1, itemsReturnedCount: 0,
      result: "no_more_items",
    });
    return {
      status: "no_more_items",
      resposta:
        "Não há mais compras nessa fatura.\n\n" +
        `Total da fatura atual: ${formatBRL(fatura.total)}.`,
    };
  }
  if (ordenados.length === 0) {
    logFaturaDetailQuery({
      intent: intentKind, cardsMatchedCount: 1, itemsReturnedCount: 0,
      result: "no_invoice_data",
    });
    return {
      status: "no_invoice_data",
      resposta:
        `Não encontrei compras na fatura atual do ${cartao.nome}.\n\n` +
        `Quando houver lançamentos, eu mostro aqui.`,
    };
  }

  const { resposta, itemsReturnedCount, hasMore } = formatItemsResponse(
    cartao.nome, ordenados, page, mode, fatura.total,
  );

  logFaturaDetailQuery({
    intent: intentKind, cardsMatchedCount: 1, itemsReturnedCount,
    result: "answered",
  });

  if (hasMore) {
    return {
      status: "answered",
      resposta,
      nextSession: { kind: "consulta_fatura", cartaoId: cartao.id, mode, page },
    };
  }
  return { status: "answered", resposta };
}

/**
 * Avança/recua paginação a partir do estado mínimo persistido na
 * sessão temporária. Retorna `no_more_items` quando passa do fim ou
 * tenta voltar de uma página inexistente.
 */
export async function handleFaturaPagination(
  userId: string,
  state: FaturaDetailSessionState,
  direction: "next" | "prev",
): Promise<FaturaResult> {
  const hoje = nowInAppTz();
  // Recarrega o cartão para validar `cartaoId` contra o `user_id` atual.
  // Nunca aceitamos `state.cartaoId` cegamente.
  const cartoes = await loadCartoesDoUsuario(userId);
  const cartao = cartoes.find((c) => c.id === state.cartaoId) ?? null;
  if (!cartao) {
    logFaturaDetailQuery({
      intent: "invoice_page", cardsMatchedCount: 0, itemsReturnedCount: 0,
      result: "card_not_found",
    });
    return {
      status: "card_not_found",
      resposta: "Não encontrei mais esse cartão.\n\nDigite \"fatura\" para começar de novo.",
    };
  }
  if (direction === "prev" && state.page <= 0) {
    logFaturaDetailQuery({
      intent: "invoice_page", cardsMatchedCount: 1, itemsReturnedCount: 0,
      result: "no_more_items",
    });
    return {
      status: "no_more_items",
      resposta: "Você já está na primeira página.",
    };
  }
  const nextPage = direction === "next" ? state.page + 1 : state.page - 1;
  return renderPage(userId, cartao, state.mode, nextPage, "invoice_page", hoje);
}


// =====================================================================
// WA-F4 — Próximas faturas, parcelas futuras e saldo de compras parceladas.
// Apenas leitura. Reutiliza estritamente os helpers de
// `cartao-fatura.server.ts` e `cartao-parcelamento.server.ts`.
// Nunca cria, altera, exclui ou envia nada.
// =====================================================================

const MESES_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const NOME_MES_PT = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthLabel(mes: number): string {
  return NOME_MES_PT[mes] ?? "";
}

const PARCELADOS_PAGE_SIZE = 5;
const MAX_MONTHS_AHEAD = 12;

export type FutureFaturaIntent =
  | { kind: "future_invoice_total"; invoiceMonth: string }
  | { kind: "future_invoice_card"; termo: string; invoiceMonth: string }
  | { kind: "installment_list" }
  | { kind: "installment_detail"; termo: string };

export type ParceladoSessionState = {
  kind: "consulta_parcelamento";
  mode: "lista" | "detalhe" | "fatura_futura";
  cartaoId: string | null;
  installmentGroupIds: string[] | null;
  targetInvoiceMonth: string | null;
  page: number;
};

export type FutureFaturaResult =
  | { status: "answered"; resposta: string }
  | { status: "answered"; resposta: string; nextSession: ParceladoSessionState }
  | { status: "ambiguous_card"; resposta: string }
  | { status: "ambiguous_installment"; resposta: string; nextSession: ParceladoSessionState }
  | { status: "card_not_found"; resposta: string }
  | { status: "no_future_data"; resposta: string }
  | { status: "no_more_items"; resposta: string };

function normF4(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBRL_F4(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function logFutureQuery(args: {
  intent:
    | "future_invoice_total"
    | "future_invoice_card"
    | "installment_list"
    | "installment_detail"
    | "installment_page";
  cardsMatchedCount: number;
  groupsMatchedCount: number;
  result:
    | "answered"
    | "ambiguous_card"
    | "ambiguous_installment"
    | "card_not_found"
    | "no_future_data"
    | "no_more_items";
}) {
  // Log seguro: SEM userId, telefone, valor, descrição, cartão,
  // grupo_parcelamento_id ou texto da pergunta.
  console.info({
    event: "wa_future_invoice_query",
    intent: args.intent,
    cardsMatchedCount: args.cardsMatchedCount,
    groupsMatchedCount: args.groupsMatchedCount,
    result: args.result,
  });
}

/**
 * Resolve "mês X" (português) em invoice_month "YYYY-MM" relativo a
 * `hoje`. Regras:
 *  - se o mês já passou no ano atual, vai para o PRÓXIMO ano;
 *  - se houver ano explícito (4 dígitos), respeita;
 *  - retorna null se ultrapassar 12 meses à frente.
 */
export function resolveTargetInvoiceMonth(
  texto: string,
  hoje: Date = nowInAppTz(),
): { ym: string; mes: number; ano: number } | null {
  const t = normF4(texto);
  const re = new RegExp(
    `\\b(${Object.keys(MESES_PT).join("|")})\\b(?:\\s+(?:de\\s+)?(\\d{4}))?`,
  );
  const m = t.match(re);
  if (!m) return null;
  const mes = MESES_PT[m[1]];
  const hojeMes = hoje.getMonth() + 1;
  const hojeAno = hoje.getFullYear();
  let ano: number;
  if (m[2]) {
    ano = Number(m[2]);
  } else {
    ano = hojeAno;
    if (mes < hojeMes) ano += 1;
  }
  // Limite de 12 meses à frente, contando a partir do mês corrente.
  const diff = (ano - hojeAno) * 12 + (mes - hojeMes);
  if (diff > MAX_MONTHS_AHEAD || diff < 0) return null;
  return { ym: `${ano}-${String(mes).padStart(2, "0")}`, mes, ano };
}

function extractCartaoTermoF4(t: string): string | null {
  const STOP =
    /^(proxim[ao]|atual|aberta|fechada|mais|maior|do|da|de|dos|das|no|na|nos|nas|minha|meu|meus|minhas|cart(?:ao|oes)|credito|fatura|mes|que|vem|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/;
  let m = t.match(/\bno\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  m = t.match(/\bdo\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  m = t.match(/\bcart(?:ao|oes)\s+(?:do|da|de)?\s*([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/);
  if (m) {
    const c = m[1].trim();
    if (c && !STOP.test(c)) return c;
  }
  return null;
}

/**
 * Detecta intenções de fatura futura / parcelas em aberto. Retorna
 * null se a mensagem não casar. Usado APÓS `detectFaturaIntent`
 * (atual) — esta camada cobre só o "futuro / parcelas".
 */
export function detectFutureFaturaIntent(
  texto: string,
  hoje: Date = nowInAppTz(),
): FutureFaturaIntent | null {
  const t = normF4(texto);
  if (!t) return null;

  // ---- compras parceladas em aberto ----
  if (
    /\b(minhas\s+)?compras?\s+parcelad[ao]s?\b/.test(t) ||
    /\bquais?\s+parcelas?\s+(?:ainda\s+)?(?:faltam|restam)\b/.test(t) ||
    /\bparcelas?\s+(?:em\s+)?aberto\b/.test(t) ||
    /\bo\s+que\s+(?:eu\s+)?(?:ainda\s+)?(?:estou\s+)?pagando\s+no\s+cart(?:ao|oes)\b/.test(t) ||
    /\bquanto\s+(?:ainda\s+)?falta\s+pagar\s+(?:do|no)\s+cart(?:ao|oes)\b/.test(t)
  ) {
    return { kind: "installment_list" };
  }

  // ---- saldo de compra parcelada ("quanto falta pagar do tênis") ----
  let m = t.match(
    /\bquanto\s+(?:ainda\s+)?falta\s+(?:pagar\s+)?(?:do|da|de|dos|das)\s+([a-z0-9\s]{2,40}?)(?:\s*\?|\s*$)/,
  );
  if (m) return { kind: "installment_detail", termo: m[1].trim() };
  m = t.match(
    /\bdetalhes?\s+(?:da\s+)?compra\s+parcelad[ao]\s+(?:do|da|de|dos|das)\s+([a-z0-9\s]{2,40}?)(?:\s*\?|\s*$)/,
  );
  if (m) return { kind: "installment_detail", termo: m[1].trim() };

  // ---- futuro de fatura ----
  const target = resolveTargetInvoiceMonth(t, hoje);
  const futureCue =
    /\bprox(?:ima|imo)\b/.test(t) ||
    /\bmes\s+que\s+vem\b/.test(t) ||
    /\bfutur[ao]\b/.test(t) ||
    target !== null;
  if (!futureCue) return null;

  // Só dispara como "fatura futura" se houver token claro de fatura/cartão/pagamento.
  if (
    !(
      /\bfatura\b/.test(t) ||
      /\bcart(?:ao|oes)\b/.test(t) ||
      /\b(?:vou|vai|sera|sera)\s+pagar\b/.test(t) ||
      /\b(?:vai|vou)\s+(?:dar|ficar)\b/.test(t)
    )
  ) {
    return null;
  }

  // Se passa de 12 meses, bloqueamos no handler com no_future_data.
  let ym: string;
  if (target) {
    ym = target.ym;
  } else {
    // Próximo mês civil quando não há mês explícito.
    const nextMonth = hoje.getMonth() + 2 > 12
      ? { m: 1, y: hoje.getFullYear() + 1 }
      : { m: hoje.getMonth() + 2, y: hoje.getFullYear() };
    ym = `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}`;
  }
  const termo = extractCartaoTermoF4(t);
  if (termo) return { kind: "future_invoice_card", termo, invoiceMonth: ym };
  return { kind: "future_invoice_total", invoiceMonth: ym };
}

/** Detecta se mensagem solicita mês explícito mas > 12 meses à frente. */
export function isBeyondHorizon(
  texto: string,
  hoje: Date = nowInAppTz(),
): boolean {
  const t = normF4(texto);
  const re = new RegExp(
    `\\b(${Object.keys(MESES_PT).join("|")})\\b(?:\\s+(?:de\\s+)?(\\d{4}))?`,
  );
  const m = t.match(re);
  if (!m) return false;
  const mes = MESES_PT[m[1]];
  const hojeMes = hoje.getMonth() + 1;
  const hojeAno = hoje.getFullYear();
  let ano: number;
  if (m[2]) ano = Number(m[2]);
  else {
    ano = hojeAno;
    if (mes < hojeMes) ano += 1;
  }
  const diff = (ano - hojeAno) * 12 + (mes - hojeMes);
  return diff > MAX_MONTHS_AHEAD;
}

function formatDDMM_F4(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function ambiguousCardMsg_F4(cartoes: CartaoRow[]): string {
  const linhas = cartoes
    .map((c) => `• ${(c.nome ?? "").trim() || (c.banco ?? "").trim() || "Cartão"}`)
    .join("\n");
  return (
    "Encontrei mais de um cartão.\n\n" +
    "Digite o nome de um deles para eu calcular a fatura:\n" +
    linhas
  );
}

function noFutureDataMsg(): string {
  return (
    "Ainda não encontrei lançamentos para essa fatura futura.\n\n" +
    "Conforme novas compras forem registradas, eu consigo calcular."
  );
}

export async function handleFutureFaturaIntent(
  userId: string,
  intent: FutureFaturaIntent,
  hoje: Date = nowInAppTz(),
): Promise<FutureFaturaResult> {
  if (intent.kind === "future_invoice_total") {
    const resumos = await getResumoFaturasPorMes(userId, intent.invoiceMonth);
    const ativos = resumos.filter((f) => f.total > 0);
    if (ativos.length === 0) {
      const out: FutureFaturaResult = { status: "no_future_data", resposta: noFutureDataMsg() };
      logFutureQuery({
        intent: intent.kind, cardsMatchedCount: resumos.length, groupsMatchedCount: 0,
        result: out.status,
      });
      return out;
    }
    const total = ativos.reduce((s, f) => s + f.total, 0);
    const parsed = parseInvoiceMonth(intent.invoiceMonth);
    const monthName = parsed ? monthLabel(parsed.mes) : "do próximo mês";
    const linhas = ativos
      .sort((a, b) => b.total - a.total)
      .map((f) => `• ${f.cartaoNome}: ${formatBRL_F4(f.total)}`);
    const corpo =
      `Sua próxima fatura estimada de ${monthName} está em ${formatBRL_F4(total)}.\n\n` +
      linhas.join("\n") +
      `\n\nEsse valor pode mudar conforme novas compras forem registradas.`;
    const out: FutureFaturaResult = { status: "answered", resposta: corpo };
    logFutureQuery({
      intent: intent.kind, cardsMatchedCount: ativos.length, groupsMatchedCount: 0,
      result: out.status,
    });
    return out;
  }

  if (intent.kind === "future_invoice_card") {
    const matches = await findCartoesDoUsuarioByTerm(userId, intent.termo);
    if (matches.length === 0) {
      const out: FutureFaturaResult = {
        status: "card_not_found",
        resposta:
          `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
          `Confira o nome cadastrado no Gasto Inteligente.`,
      };
      logFutureQuery({
        intent: intent.kind, cardsMatchedCount: 0, groupsMatchedCount: 0, result: out.status,
      });
      return out;
    }
    if (matches.length > 1) {
      const out: FutureFaturaResult = {
        status: "ambiguous_card", resposta: ambiguousCardMsg_F4(matches),
      };
      logFutureQuery({
        intent: intent.kind, cardsMatchedCount: matches.length, groupsMatchedCount: 0,
        result: out.status,
      });
      return out;
    }
    const f = await getFaturaPorMes(userId, matches[0], intent.invoiceMonth);
    if (!f || f.total <= 0) {
      const out: FutureFaturaResult = { status: "no_future_data", resposta: noFutureDataMsg() };
      logFutureQuery({
        intent: intent.kind, cardsMatchedCount: 1, groupsMatchedCount: 0, result: out.status,
      });
      return out;
    }
    const parsed = parseInvoiceMonth(intent.invoiceMonth)!;
    const monthName = monthLabel(parsed.mes);
    const linhas: string[] = [];
    linhas.push(`A fatura estimada do ${f.cartaoNome} para ${monthName} está em ${formatBRL_F4(f.total)}.`);
    const venc = formatDDMM_F4(f.vencimento);
    const fech = formatDDMM_F4(f.fechamento);
    if (venc || fech) linhas.push("");
    if (venc) linhas.push(`Vencimento: ${venc}`);
    if (fech) linhas.push(`Fechamento: ${fech}`);
    const out: FutureFaturaResult = { status: "answered", resposta: linhas.join("\n") };
    logFutureQuery({
      intent: intent.kind, cardsMatchedCount: 1, groupsMatchedCount: 0, result: out.status,
    });
    return out;
  }

  if (intent.kind === "installment_list") {
    const compras = await getComprasParceladasEmAberto(userId, hoje);
    if (compras.length === 0) {
      const out: FutureFaturaResult = {
        status: "no_future_data",
        resposta:
          "Você não tem compras parceladas em aberto agora.\n\n" +
          "Quando registrar uma compra parcelada, eu acompanho aqui.",
      };
      logFutureQuery({
        intent: intent.kind, cardsMatchedCount: 0, groupsMatchedCount: 0, result: out.status,
      });
      return out;
    }
    return renderInstallmentPage(compras, 0, "installment_list");
  }

  // installment_detail
  const matches = await findCompraParceladaByTerm(userId, intent.termo, hoje);
  if (matches.length === 0) {
    const out: FutureFaturaResult = {
      status: "no_future_data",
      resposta:
        `Não encontrei nenhuma compra parcelada em aberto com a descrição "${intent.termo}".\n\n` +
        `Digite "minhas compras parceladas" para ver a lista.`,
    };
    logFutureQuery({
      intent: intent.kind, cardsMatchedCount: 0, groupsMatchedCount: 0, result: out.status,
    });
    return out;
  }
  if (matches.length > 1) {
    const linhas = matches.slice(0, 5).map((c, i) => `${i + 1}. ${c.descricao}`).join("\n");
    const out: FutureFaturaResult = {
      status: "ambiguous_installment",
      resposta:
        "Encontrei mais de uma compra parcelada com esse nome. Qual delas?\n\n" + linhas,
      nextSession: {
        kind: "consulta_parcelamento",
        mode: "detalhe",
        cartaoId: null,
        installmentGroupIds: matches.slice(0, 5).map((c) => c.grupoId),
        targetInvoiceMonth: null,
        page: 0,
      },
    };
    logFutureQuery({
      intent: intent.kind, cardsMatchedCount: 0, groupsMatchedCount: matches.length,
      result: out.status,
    });
    return out;
  }
  return renderInstallmentDetail(userId, matches[0], hoje);
}

function renderInstallmentPage(
  compras: CompraParcelada[],
  page: number,
  intentKind: "installment_list" | "installment_page",
): FutureFaturaResult {
  const start = page * PARCELADOS_PAGE_SIZE;
  if (start >= compras.length) {
    logFutureQuery({
      intent: intentKind, cardsMatchedCount: 0, groupsMatchedCount: 0,
      result: "no_more_items",
    });
    return {
      status: "no_more_items",
      resposta: "Não há mais compras parceladas em aberto.",
    };
  }
  const slice = compras.slice(start, start + PARCELADOS_PAGE_SIZE);
  const hasMore = compras.length > start + PARCELADOS_PAGE_SIZE;
  const total = compras.length;
  const titulo = `Você tem ${total} compra${total === 1 ? "" : "s"} parcelada${total === 1 ? "" : "s"} em aberto:`;
  const linhas = slice.map((c) => {
    const pagas = c.totalParcelas - c.parcelasRestantes.length;
    const faltam = c.parcelasRestantes.length;
    const desc = c.descricao || "Compra no cartão";
    return `• ${desc} — faltam ${faltam} de ${c.totalParcelas} parcelas (já cobradas: ${pagas})`;
  });
  const partes = [titulo, "", ...linhas, "", "Digite o nome da compra para ver mais detalhes."];
  if (hasMore) partes.push('Digite "ver mais" para continuar.');
  logFutureQuery({
    intent: intentKind, cardsMatchedCount: 0, groupsMatchedCount: slice.length,
    result: "answered",
  });
  const next: ParceladoSessionState = {
    kind: "consulta_parcelamento",
    mode: "lista",
    cartaoId: null,
    installmentGroupIds: compras.map((c) => c.grupoId),
    targetInvoiceMonth: null,
    page,
  };
  return { status: "answered", resposta: partes.join("\n"), nextSession: next };
}

async function renderInstallmentDetail(
  userId: string,
  compra: CompraParcelada,
  _hoje: Date,
): Promise<FutureFaturaResult> {
  const cartoes = await loadCartoesDoUsuario(userId);
  const cartao = cartoes.find((c) => c.id === compra.cartaoId);
  const nomeCartao = cartao?.nome ?? "Cartão";
  const pagas = compra.totalParcelas - compra.parcelasRestantes.length;
  const proxima = compra.proximaParcela;
  const linhas: string[] = [];
  linhas.push(compra.descricao || "Compra no cartão");
  linhas.push("");
  linhas.push(`• Total da compra: ${formatBRL_F4(compra.totalCompra)}`);
  linhas.push(`• Parcelas previstas até agora: ${pagas} de ${compra.totalParcelas}`);
  linhas.push(`• Parcelas restantes: ${compra.parcelasRestantes.length}`);
  linhas.push(`• Saldo previsto restante: ${formatBRL_F4(compra.saldoRestante)}`);
  if (proxima) {
    const ymKey = proxima.invoiceMonth ?? proxima.data.slice(0, 7);
    const parsed = parseInvoiceMonth(ymKey);
    const mesNome = parsed ? monthLabel(parsed.mes) : "";
    linhas.push(
      `• Próxima parcela: ${formatBRL_F4(proxima.valor)}${mesNome ? ` em ${mesNome}` : ""}`,
    );
  }
  linhas.push(`• Cartão: ${nomeCartao}`);
  logFutureQuery({
    intent: "installment_detail", cardsMatchedCount: 1, groupsMatchedCount: 1,
    result: "answered",
  });
  return { status: "answered", resposta: linhas.join("\n") };
}

/**
 * Paginação ativa (sessão `consulta_parcelamento`). Aceita também
 * escolha numérica em lista ambígua de compras parceladas.
 */
export async function handleParceladoPagination(
  userId: string,
  state: ParceladoSessionState,
  texto: string,
  hoje: Date = nowInAppTz(),
): Promise<FutureFaturaResult | null> {
  const t = normF4(texto);

  // Modo "detalhe" + lista ambígua → aceita "1".."5".
  if (state.mode === "detalhe" && state.installmentGroupIds && state.installmentGroupIds.length > 0) {
    const m = t.match(/^([1-9])$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      const grupoId = state.installmentGroupIds[idx];
      if (!grupoId) {
        return {
          status: "no_more_items",
          resposta: "Opção inválida. Digite o número correspondente ou \"cancelar\".",
        };
      }
      const detalhe = await getDetalheCompraParcelada(userId, grupoId, hoje);
      if (!detalhe) {
        return {
          status: "no_future_data",
          resposta: "Não encontrei essa compra parcelada.",
        };
      }
      return renderInstallmentDetail(userId, detalhe, hoje);
    }
  }

  // Modo "lista" → paginação.
  if (state.mode === "lista" && state.installmentGroupIds) {
    if (/^(ver\s+mais|mais|continuar|seguinte|proxim[ao]s?)$/.test(t)) {
      const compras = await getComprasParceladasEmAberto(userId, hoje);
      // Mantém só os grupos que ainda existem na sessão original (estabilidade).
      const filtrados = compras.filter((c) => state.installmentGroupIds!.includes(c.grupoId));
      return renderInstallmentPage(filtrados, state.page + 1, "installment_page");
    }
    if (/^(voltar|anterior|pagina\s+anterior)$/.test(t)) {
      if (state.page <= 0) {
        return {
          status: "no_more_items",
          resposta: "Você já está na primeira página.",
        };
      }
      const compras = await getComprasParceladasEmAberto(userId, hoje);
      const filtrados = compras.filter((c) => state.installmentGroupIds!.includes(c.grupoId));
      return renderInstallmentPage(filtrados, state.page - 1, "installment_page");
    }
  }

  if (/^(cancelar|cancela|sair|encerrar|parar)$/.test(t)) {
    return {
      status: "no_more_items",
      resposta: "Tudo bem, encerrei a consulta.",
    };
  }

  return null;
}
