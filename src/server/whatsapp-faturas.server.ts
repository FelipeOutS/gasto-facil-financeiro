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
  nowInAppTz,
  type CartaoRow,
  type FaturaAtual,
} from "./cartao-fatura.server";

export type FaturaIntent =
  | { kind: "invoice_total" }
  | { kind: "invoice_card"; termo: string }
  | { kind: "invoice_due_date"; termo: string | null }
  | { kind: "invoice_closing_date"; termo: string | null }
  | { kind: "invoice_highest" };

export type FaturaResult =
  | { status: "answered"; resposta: string }
  | { status: "card_not_found"; resposta: string }
  | { status: "ambiguous_card"; resposta: string }
  | { status: "no_invoice_data"; resposta: string };

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
  let m = t.match(/\bfatura\s+(?:do|da|de|dos|das)\s+([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/);
  if (m) return m[1].trim();
  m = t.match(/\bfatura\s+([a-z0-9]{2,30})(?:\s*\?|\s*$)/);
  if (m && !/^(atual|aberta|fechada|mais|maior|do|da|de|minha|meu)$/.test(m[1])) {
    return m[1].trim();
  }
  m = t.match(/\bcart(?:ao|oes)\s+(?:do|da|de)?\s*([a-z0-9\s]{2,30}?)(?:\s*\?|\s*$)/);
  if (m) {
    const candidate = m[1].trim();
    if (candidate && !/^(esta|estao|com|maior|mais|alta|fatura)$/.test(candidate)) {
      return candidate;
    }
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
