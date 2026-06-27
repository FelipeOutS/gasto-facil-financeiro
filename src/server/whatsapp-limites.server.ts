/**
 * WA-F5 — Consulta de LIMITE, UTILIZAÇÃO e VALOR COMPROMETIDO de
 * cartões via WhatsApp. Apenas leitura. Reusa estritamente os helpers
 * de `cartao-limite.server.ts` (que por sua vez reusa
 * `cartao-fatura.server.ts`) — nunca duplica regras financeiras.
 *
 * Garantias:
 * - Não cria/atualiza gasto, cartão, fatura, parcela, sessão de
 *   memória ou alerta.
 * - Não envia notificação automática.
 * - Filtra por `userId` (autorizado pelo gate canônico).
 * - Log seguro: nunca inclui valor, limite, nome de cartão, userId,
 *   telefone ou texto da pergunta.
 */
import {
  loadCartoesDoUsuario,
  findCartoesDoUsuarioByTerm,
  nowInAppTz,
  type CartaoRow,
} from "./cartao-fatura.server";
import {
  getResumoLimiteCartao,
  getResumoLimitesUsuario,
  type ResumoLimiteCartao,
} from "./cartao-limite.server";

export type LimiteIntent =
  | { kind: "limit_total" }
  | { kind: "limit_card"; termo: string }
  | { kind: "limit_lowest" }
  | { kind: "limit_highest" }
  | { kind: "commitment"; termo: string | null };

export type LimiteResult =
  | { status: "answered"; resposta: string }
  | { status: "ambiguous_card"; resposta: string }
  | { status: "card_not_found"; resposta: string }
  | { status: "no_limit_data"; resposta: string }
  | { status: "availability_not_reliable"; resposta: string };

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

function logLimiteQuery(args: {
  intent:
    | "limit_total"
    | "limit_card"
    | "limit_available"
    | "limit_lowest"
    | "limit_highest"
    | "commitment";
  cardsMatchedCount: number;
  result: LimiteResult["status"];
}) {
  console.info({
    event: "wa_card_limit_query",
    intent: args.intent,
    cardsMatchedCount: args.cardsMatchedCount,
    result: args.result,
  });
}

function extractCartaoTermo(t: string): string | null {
  const STOP =
    /^(do|da|de|dos|das|no|na|nos|nas|minha|meu|meus|minhas|cart(?:ao|oes)|credito|limite|disponivel|comprometido|comprometid[ao]s?|mais|menos|maior|menor|qual|tem|esta|ja|ainda|usei|gastei|tenho|sobra|atual|de)$/;
  // "limite do nubank"  / "limite no inter"
  let m = t.match(/\blimite\s+(?:do|da|de|no|na)\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  m = t.match(/\blimite\s+([a-z0-9]{2,30})(?:\s*\?|\s*$)/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  // "quanto usei do nubank" / "quanto ja gastei do inter"
  m = t.match(/\b(?:usei|gastei|comprometi)\s+(?:do|da|de|no|na)\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  // "disponivel no nubank" / "disponivel do inter"
  m = t.match(/\bdisponivel\s+(?:do|da|de|no|na)\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  // "comprometido no nubank"
  m = t.match(/\bcomprometid[ao]s?\s+(?:do|da|de|no|na)\s+([a-z0-9]{2,30})\b/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  // "cartao X"
  m = t.match(/\bcart(?:ao|oes)\s+(?:do|da|de)?\s*([a-z0-9]{2,30})(?:\s*\?|\s*$)/);
  if (m && !STOP.test(m[1])) return m[1].trim();
  return null;
}

/**
 * Detecta intenção de consulta de limite/utilização/comprometimento.
 * Retorna null quando a mensagem não é claramente sobre limite.
 *
 * Importante: NÃO captura "fatura" — esse caso é WA-F1. Roda DEPOIS de
 * `detectFaturaIntent` na pipeline.
 */
export function detectLimiteIntent(texto: string): LimiteIntent | null {
  const t = norm(texto);
  if (!t) return null;

  // "comprometido" / "parcelas futuras" no cartão
  if (
    /\bcomprometid[ao]s?\b/.test(t) ||
    /\bquanto\s+(?:ainda\s+)?(?:tenho\s+)?em\s+parcelas?\s+futuras?\b/.test(t)
  ) {
    return { kind: "commitment", termo: extractCartaoTermo(t) };
  }

  // Ranking — vem antes de limit_total para "qual cartao tem menos limite".
  if (
    /\bqual\s+cart(?:ao|oes)\b.*\b(menos|menor)\b.*\b(limite|disponivel)\b/.test(t) ||
    /\bcart(?:ao|oes)\b.*\bmenor\s+(limite|disponivel)\b/.test(t) ||
    /\bmenor\s+(limite|disponivel)\b/.test(t)
  ) {
    return { kind: "limit_lowest" };
  }
  if (
    /\bqual\s+cart(?:ao|oes)\b.*\b(mais|maior)\b.*\b(limite|disponivel)\b/.test(t) ||
    /\bcart(?:ao|oes)\b.*\bmaior\s+(limite|disponivel)\b/.test(t) ||
    /\bmaior\s+(limite|disponivel)\b/.test(t)
  ) {
    return { kind: "limit_highest" };
  }

  // Cartão específico com palavra "limite", "disponivel", "usei" ou "gastei do".
  const termo = extractCartaoTermo(t);
  const mentionsLimite =
    /\blimite\b/.test(t) ||
    /\bdisponivel\b/.test(t) ||
    /\b(?:usei|gastei)\b.*\bcart/.test(t) ||
    /\b(?:usei|gastei)\s+(?:do|da|de|no|na)\b/.test(t);

  if (termo && mentionsLimite) {
    return { kind: "limit_card", termo };
  }

  // Consolidado
  if (
    /\bqual\s+(?:e\s+)?(?:o\s+)?meu\s+limite\b/.test(t) ||
    /\bquanto\s+(?:eu\s+)?tenho\s+de\s+limite\b/.test(t) ||
    /\bquanto\s+(?:eu\s+)?ainda\s+tenho\s+disponivel\b/.test(t) ||
    /\bquanto\s+(?:eu\s+)?tenho\s+disponivel\b/.test(t) ||
    /\bmeu\s+limite\b/.test(t) ||
    /\blimite\s+(?:do|dos|nos)\s+cart(?:ao|oes)\b/.test(t)
  ) {
    return { kind: "limit_total" };
  }

  return null;
}

function ambiguousCardMessage(cartoes: CartaoRow[]): string {
  const linhas = cartoes
    .map((c) => `• ${(c.nome ?? "").trim() || (c.banco ?? "").trim() || "Cartão"}`)
    .join("\n");
  return (
    "Encontrei mais de um cartão.\n\n" +
    "Digite o nome de um deles para eu consultar:\n" +
    linhas
  );
}

function formatResumoCartao(r: ResumoLimiteCartao): string {
  const nome = (r.cartao.nome ?? "").trim() || "Cartão";
  const linhas: string[] = [];
  linhas.push(nome);
  linhas.push("");
  if (r.hasLimite) {
    linhas.push(`• Limite cadastrado: ${formatBRL(r.limite)}`);
  } else {
    linhas.push("• Limite cadastrado: não informado");
  }
  linhas.push(`• Fatura atual: ${formatBRL(r.faturaAtual)}`);
  if (r.proximaFaturaEstimada > 0) {
    linhas.push(`• Próxima fatura estimada: ${formatBRL(r.proximaFaturaEstimada)}`);
  }
  if (r.parcelasFuturasAposProximo > 0) {
    linhas.push(
      `• Parcelas futuras previstas após o próximo ciclo: ${formatBRL(r.parcelasFuturasAposProximo)}`,
    );
  }
  if (r.disponivelEstimado !== null) {
    linhas.push(`• Limite disponível estimado: ${formatBRL(r.disponivelEstimado)}`);
    linhas.push("");
    linhas.push(
      "Esse valor não considera pagamentos já feitos da fatura nem bloqueios da operadora.",
    );
  } else {
    linhas.push("");
    linhas.push(
      "Ainda não consigo calcular o limite disponível porque o cartão não tem limite cadastrado no Gasto Inteligente.",
    );
  }
  return linhas.join("\n");
}

function formatResumoConsolidado(resumos: ResumoLimiteCartao[]): string {
  const partes: string[] = [];
  partes.push("Seus cartões:");
  partes.push("");
  let limiteTotal = 0;
  for (const r of resumos) {
    const nome = (r.cartao.nome ?? "").trim() || "Cartão";
    partes.push(`• ${nome}`);
    if (r.hasLimite) {
      partes.push(`  Limite cadastrado: ${formatBRL(r.limite)}`);
      limiteTotal += r.limite;
    } else {
      partes.push("  Limite cadastrado: não informado");
    }
    partes.push(`  Fatura atual: ${formatBRL(r.faturaAtual)}`);
    partes.push("");
  }
  if (limiteTotal > 0) {
    partes.push(`Limite total cadastrado: ${formatBRL(limiteTotal)}`);
  }
  return partes.join("\n").trimEnd();
}

export async function handleLimiteIntent(
  userId: string,
  intent: LimiteIntent,
): Promise<LimiteResult> {
  const hoje = nowInAppTz();

  if (intent.kind === "limit_total") {
    const resumos = await getResumoLimitesUsuario(userId, hoje);
    if (resumos.length === 0) {
      const out: LimiteResult = {
        status: "no_limit_data",
        resposta:
          "Ainda não encontrei cartões cadastrados no Gasto Inteligente.\n\n" +
          "Cadastre um cartão para eu acompanhar o limite.",
      };
      logLimiteQuery({ intent: "limit_total", cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (resumos.length === 1) {
      const out: LimiteResult = {
        status: "answered",
        resposta: formatResumoCartao(resumos[0]),
      };
      logLimiteQuery({ intent: "limit_total", cardsMatchedCount: 1, result: out.status });
      return out;
    }
    const out: LimiteResult = {
      status: "answered",
      resposta: formatResumoConsolidado(resumos),
    };
    logLimiteQuery({
      intent: "limit_total", cardsMatchedCount: resumos.length, result: out.status,
    });
    return out;
  }

  if (intent.kind === "limit_card") {
    const matches = await findCartoesDoUsuarioByTerm(userId, intent.termo);
    if (matches.length === 0) {
      const out: LimiteResult = {
        status: "card_not_found",
        resposta:
          `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
          `Confira o nome cadastrado no Gasto Inteligente.`,
      };
      logLimiteQuery({ intent: "limit_card", cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (matches.length > 1) {
      const out: LimiteResult = {
        status: "ambiguous_card",
        resposta: ambiguousCardMessage(matches),
      };
      logLimiteQuery({
        intent: "limit_card", cardsMatchedCount: matches.length, result: out.status,
      });
      return out;
    }
    const r = await getResumoLimiteCartao(userId, matches[0], hoje);
    const out: LimiteResult = { status: "answered", resposta: formatResumoCartao(r) };
    logLimiteQuery({ intent: "limit_card", cardsMatchedCount: 1, result: out.status });
    return out;
  }

  if (intent.kind === "limit_lowest" || intent.kind === "limit_highest") {
    const resumos = await getResumoLimitesUsuario(userId, hoje);
    const elegiveis = resumos.filter((r) => r.disponivelEstimado !== null);
    if (elegiveis.length === 0) {
      // Sem disponibilidade confiável em nenhum cartão → fallback transparente
      // usando fatura atual.
      const comFatura = resumos.filter((r) => r.faturaAtual > 0);
      if (comFatura.length === 0) {
        const out: LimiteResult = {
          status: "no_limit_data",
          resposta:
            "Ainda não consigo comparar o limite dos cartões com segurança.\n\n" +
            "Cadastre o limite dos cartões para eu acompanhar.",
        };
        logLimiteQuery({
          intent: intent.kind === "limit_lowest" ? "limit_lowest" : "limit_highest",
          cardsMatchedCount: resumos.length, result: out.status,
        });
        return out;
      }
      const maior = comFatura.reduce((a, b) => (b.faturaAtual > a.faturaAtual ? b : a));
      const out: LimiteResult = {
        status: "availability_not_reliable",
        resposta:
          `O cartão com maior fatura atual é o ${(maior.cartao.nome ?? "Cartão").trim()}.\n\n` +
          "Para comparar qual tem mais ou menos limite disponível com precisão, " +
          "preciso ter o limite cadastrado nos cartões.",
      };
      logLimiteQuery({
        intent: intent.kind === "limit_lowest" ? "limit_lowest" : "limit_highest",
        cardsMatchedCount: resumos.length, result: out.status,
      });
      return out;
    }
    const escolhido = intent.kind === "limit_lowest"
      ? elegiveis.reduce((a, b) => ((b.disponivelEstimado ?? 0) < (a.disponivelEstimado ?? 0) ? b : a))
      : elegiveis.reduce((a, b) => ((b.disponivelEstimado ?? 0) > (a.disponivelEstimado ?? 0) ? b : a));
    const nome = (escolhido.cartao.nome ?? "Cartão").trim();
    const verbo = intent.kind === "limit_lowest" ? "menor" : "maior";
    const out: LimiteResult = {
      status: "answered",
      resposta:
        `O cartão com ${verbo} limite disponível estimado é o ${nome} ` +
        `(${formatBRL(escolhido.disponivelEstimado ?? 0)}).\n\n` +
        "Esse valor não considera pagamentos já feitos da fatura nem bloqueios da operadora.",
    };
    logLimiteQuery({
      intent: intent.kind === "limit_lowest" ? "limit_lowest" : "limit_highest",
      cardsMatchedCount: elegiveis.length, result: out.status,
    });
    return out;
  }

  // commitment
  let alvo: CartaoRow[] = [];
  if (intent.termo) {
    alvo = await findCartoesDoUsuarioByTerm(userId, intent.termo);
    if (alvo.length === 0) {
      const out: LimiteResult = {
        status: "card_not_found",
        resposta:
          `Não encontrei nenhum cartão com o nome "${intent.termo}".\n\n` +
          `Confira o nome cadastrado no Gasto Inteligente.`,
      };
      logLimiteQuery({ intent: "commitment", cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (alvo.length > 1) {
      const out: LimiteResult = {
        status: "ambiguous_card",
        resposta: ambiguousCardMessage(alvo),
      };
      logLimiteQuery({
        intent: "commitment", cardsMatchedCount: alvo.length, result: out.status,
      });
      return out;
    }
  } else {
    alvo = await loadCartoesDoUsuario(userId);
    if (alvo.length === 0) {
      const out: LimiteResult = {
        status: "no_limit_data",
        resposta:
          "Ainda não encontrei cartões cadastrados no Gasto Inteligente.",
      };
      logLimiteQuery({ intent: "commitment", cardsMatchedCount: 0, result: out.status });
      return out;
    }
    if (alvo.length > 1) {
      const out: LimiteResult = {
        status: "ambiguous_card",
        resposta: ambiguousCardMessage(alvo),
      };
      logLimiteQuery({
        intent: "commitment", cardsMatchedCount: alvo.length, result: out.status,
      });
      return out;
    }
  }
  const r = await getResumoLimiteCartao(userId, alvo[0], hoje);
  const nome = (r.cartao.nome ?? "Cartão").trim();
  const linhas: string[] = [];
  linhas.push(nome);
  linhas.push("");
  linhas.push(`• Fatura atual: ${formatBRL(r.faturaAtual)}`);
  linhas.push(`• Próxima fatura estimada: ${formatBRL(r.proximaFaturaEstimada)}`);
  linhas.push(
    `• Parcelas futuras previstas após o próximo ciclo: ${formatBRL(r.parcelasFuturasAposProximo)}`,
  );
  const out: LimiteResult = { status: "answered", resposta: linhas.join("\n") };
  logLimiteQuery({ intent: "commitment", cardsMatchedCount: 1, result: out.status });
  return out;
}
