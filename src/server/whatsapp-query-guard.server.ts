/**
 * WA-Q-Hardening — Safety Net de Roteamento de Consultas
 * ======================================================
 *
 * Camada 100% READ-ONLY que se posiciona logo antes do parser genérico
 * de gasto/receita e impede que frases claramente consultivas — mas sem
 * intent conhecida — sejam interpretadas como lançamento financeiro por
 * acidente.
 *
 * NUNCA:
 *   - abre sessão de gasto/receita/conta/recorrência
 *   - pede valor ao usuário
 *   - grava em qualquer tabela financeira
 *   - faz claim de external_id
 *   - assume a intenção do usuário
 *
 * SÓ aciona quando:
 *   - não há sessão pendente (dever de quem chama)
 *   - não há intent conhecida (dever de quem chama — Q-Guard roda depois
 *     de conversacional, consultas, faturas, limites, vencimentos)
 *   - o texto tem *forma* de consulta (marcadores de posse/interrogação/
 *     listagem) e NÃO tem verbo de ação com valor monetário (que
 *     caracterizaria um lançamento).
 *
 * Ver plano `WA-Q-Hardening`.
 */

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Marcadores de forma consultiva. Basta um casar.
const QUERY_MARKERS: RegExp[] = [
  /\bmeus?\b/,
  /\bminhas?\b/,
  /\blistar?\b/,
  /\bliste\b/,
  /\bver\b/,
  /\bmostra(r|me)?\b/,
  /\bmostre\b/,
  /\bquais\b/,
  /\bquanto(s)?\b/,
  /\bcomo est[aã]o?\b/,
  /\bhist[oó]?rico\b/,
  /\bresumo\b/,
  /\bpendentes?\b/,
  /\bativas?\b/,
  /\bem aberto\b/,
  /\ba receber\b/,
  /\ba pagar\b/,
  /\bpor categoria(s)?\b/,
  /\bdo m[eê]s\b/,
  /\bda semana\b/,
  /\bdo ano\b/,
  /\bem atraso\b/,
  /\babertos?\b/,
  /\btodas?\b/,
  /\btodos\b/,
  /\bonde\b/,
];

// Verbos de escrita / ação que caracterizam LANÇAMENTO. Se algum casar
// e houver dígito/valor na frase, deixamos o parser tratar.
const WRITE_ACTION_VERBS =
  /\b(gastei|paguei|comprei|recebi|ganhei|transferi|cadastr(ar|e|ei)|criar|crie|criei|adicionar|adicione|adicionei|nova|novo|salvar|salve|salvei|editar|edite|editei|alterar|altere|alterei|excluir|apagar|remover|cancelar|cancele|cancelei|marcar|marque|marquei|adi[ae]r|adi[ae]i|quitei|dei baixa)\b/;

// Presença de valor monetário mínimo (R$, R$X, X reais, X,XX, X.XX).
const HAS_MONEY = /(r\$\s*\d+|\bR\$\s*\d+|\b\d+\s*(reais|conto|contos)\b|\b\d+[.,]\d{2}\b)/i;

/**
 * Fallbacks nomeados. Se a mensagem consulta uma área conhecida do produto
 * mas ainda sem handler no WhatsApp, respondemos com orientação específica.
 * Nada disso cria sessão ou escreve.
 */
export type KnownArea =
  | "cartoes"
  | "bancos"
  | "boletos"
  | "favorecidos"
  | "assinatura"
  | "investimentos"
  | "dinheiro_guardado"
  | "categorias"
  | "historico"
  | "impacto_renda";

const AREA_PATTERNS: Array<{ area: KnownArea; re: RegExp }> = [
  { area: "cartoes", re: /\b(meus?|minhas?|listar|ver|quais)?\s*cart[oõ]es?\b/ },
  { area: "bancos", re: /\b(meus?|minhas?)?\s*(bancos?|contas? banc[aá]rias?|saldo(s)?)\b/ },
  { area: "boletos", re: /\b(meus?|minhas?|listar|ver)?\s*boletos?\b/ },
  {
    area: "favorecidos",
    re: /\b(meus?|minhas?)?\s*(favorecidos?|chaves? pix|pix salvos?|contatos? pix)\b/,
  },
  { area: "assinatura", re: /\b(minha|meu)\s+(assinatura|plano)\b/ },
  { area: "investimentos", re: /\b(meus?|minhas?)?\s*(investimentos?|carteira|rendimentos?)\b/ },
  {
    area: "dinheiro_guardado",
    re: /\b(meu|meus|minha|minhas)?\s*(dinheiro guardado|reservas?|poupan[cç]a)\b/,
  },
  { area: "categorias", re: /\b(minhas?|listar|ver)\s+categorias?\b/ },
  { area: "historico", re: /\b(meu|meus)\s+(hist[oó]rico|lan[cç]amentos?)\b/ },
  {
    area: "impacto_renda",
    re: /\b(impacto (dos|das)?\s*(gastos|despesas)\s+na\s+renda|gastos?\s+na\s+renda)\b/,
  },
];

export type QueryGuardDecision =
  | { kind: "pass" } // não é consulta — deixa o parser rodar
  | { kind: "fallback"; area: KnownArea | null; resposta: string };

/**
 * Decide se a mensagem deve ser bloqueada como "consulta desconhecida".
 * Nunca modifica estado. Caller é responsável por não abrir sessão e
 * por gravar apenas `status='sem_pendencia'` quando `kind==='fallback'`.
 */
export function detectConsultaShape(texto: string): QueryGuardDecision {
  const t = norm(texto);
  if (!t) return { kind: "pass" };

  // Verbo de ação + valor monetário → é lançamento, não consulta.
  if (WRITE_ACTION_VERBS.test(t) && HAS_MONEY.test(t)) {
    return { kind: "pass" };
  }
  // "paguei a internet", "cadastrar internet 119,90 vence dia 5",
  // "cancelar streaming", "adiar conta" — verbos fortes de escrita
  // sem forma consultiva → pass.
  if (WRITE_ACTION_VERBS.test(t)) {
    // Se ao mesmo tempo não tem marcador consultivo forte, deixa parser.
    const hasStrongQuery = /\b(meus?|minhas?|quais|listar?|liste)\b/.test(t);
    if (!hasStrongQuery) return { kind: "pass" };
  }

  // Consulta a uma área conhecida sem handler dedicado. Precede o teste
  // de query-shape porque frases como "impacto dos gastos na renda" não
  // trazem marcador de posse mas ainda são consultas de área conhecida.
  for (const { area, re } of AREA_PATTERNS) {
    if (re.test(t)) {
      return { kind: "fallback", area, resposta: respostaPorArea(area) };
    }
  }

  // Precisa de pelo menos um marcador consultivo para o fallback genérico.
  const hasQueryShape = QUERY_MARKERS.some((re) => re.test(t));
  if (!hasQueryShape) return { kind: "pass" };

  // Mensagem muito longa (≥ 90 caracteres) com valor + nome de item
  // provavelmente é um lançamento em texto livre. Não bloqueia.
  if (texto.length >= 90 && HAS_MONEY.test(t)) {
    return { kind: "pass" };
  }

  // Consulta genérica desconhecida.
  return { kind: "fallback", area: null, resposta: respostaGenerica() };
}

function respostaGenerica(): string {
  return [
    "Não identifiquei qual consulta você quer fazer. 🤔",
    "",
    "Você pode pedir, por exemplo:",
    "• “meus gastos do mês”",
    "• “minhas contas a pagar”",
    "• “minhas receitas”",
    "• “minhas metas”",
    "• “resumo do mês”",
    "",
    "Digite “menu” para ver todas as opções ou abra o site/app para consultas completas.",
  ].join("\n");
}

function respostaPorArea(area: KnownArea): string {
  const base = (titulo: string, dica: string) =>
    [
      `${titulo}`,
      "",
      dica,
      "",
      "Pelo WhatsApp você pode: registrar gastos, criar/pagar/adiar/cancelar contas, ver resumo, maiores gastos, receitas, metas, transferências, orçamento e faturas de cartão.",
      "",
      "Digite “menu” para ver as opções.",
    ].join("\n");

  switch (area) {
    case "cartoes":
      return base(
        "Consulta de cartões ainda não está disponível pelo WhatsApp. 💳",
        "Para ver seus cartões cadastrados, abra o site ou o app do Gasto Inteligente. Aqui eu já consigo mostrar sua fatura: peça “minha fatura” ou “fatura do Nubank”.",
      );
    case "bancos":
      return base(
        "Consulta de bancos e saldos ainda não está disponível pelo WhatsApp. 🏦",
        "Para ver seus bancos e saldos, abra o site ou o app do Gasto Inteligente.",
      );
    case "boletos":
      return base(
        "Listagem de boletos ainda não está disponível pelo WhatsApp. 📄",
        "Aqui eu leio boletos que você me envia (foto, PDF ou linha digitável) e cadastro em Contas a Pagar. Para ver todos os boletos já registrados, abra o site ou o app.",
      );
    case "favorecidos":
      return base(
        "Listagem de favorecidos/chaves Pix ainda não está disponível pelo WhatsApp. 🔑",
        "Eu já sei consultar chave de uma pessoa específica: peça “qual o Pix do João?”. Para ver a lista completa, abra o site ou o app.",
      );
    case "assinatura":
      return base(
        "Consulta da sua assinatura do Gasto Inteligente não é feita por aqui. 🧾",
        "Para ver seu plano, cobranças e formas de pagamento, abra o site ou o app.",
      );
    case "investimentos":
      return base(
        "Investimentos ainda não são consultados pelo WhatsApp. 📈",
        "Para ver sua carteira, rendimentos e movimentações, abra o site ou o app.",
      );
    case "dinheiro_guardado":
      return base(
        "Consulta de reservas / dinheiro guardado ainda não está disponível pelo WhatsApp. 💰",
        "Para ver suas reservas, abra o site ou o app.",
      );
    case "categorias":
      return base(
        "Listagem de categorias ainda não está disponível pelo WhatsApp. 🗂️",
        "Aqui eu já mostro gastos agrupados: peça “gastos por categoria”. Para gerenciar categorias, abra o site ou o app.",
      );
    case "historico":
      return base(
        "Histórico completo é melhor no site ou no app. 📜",
        "Pelo WhatsApp posso mostrar “meus gastos do mês”, “minhas receitas”, “resumo do mês”, “maiores gastos” e “gastos por categoria”.",
      );
    case "impacto_renda":
      return base(
        "Impacto detalhado dos gastos na renda é melhor no site ou no app. 📊",
        "Aqui eu consigo mostrar “resumo do mês” e “gastos por categoria”, que já ajudam a visualizar o peso das despesas.",
      );
  }
}
