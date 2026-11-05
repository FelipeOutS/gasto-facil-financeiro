/**
 * WA-INTENT-GATE — Portão de intenção antes do parser genérico de gasto.
 * =====================================================================
 *
 * Posição no pipeline: DEPOIS de todas as intents conhecidas (conversacional,
 * consultas, faturas, limites, vencimentos, contas a pagar, Pix, pagar-pessoa)
 * e ANTES da análise de lote por voz e do parser genérico de despesa.
 *
 * Regra central: o parser genérico de despesa só roda quando a mensagem tem
 * SINAL FINANCEIRO claro — valor monetário, dígito, verbo de lançamento ou
 * comando explícito de registro. Perguntas, cumprimentos e mensagens sem
 * sinal financeiro recebem resposta natural ou pedido de esclarecimento.
 *
 * A AUSÊNCIA de valor monetário NUNCA é motivo para classificar uma mensagem
 * como "despesa incompleta": quem decide entrar no fluxo de despesa é a
 * presença de intenção financeira, não a falta de um campo.
 *
 * Áudio e texto passam pelo MESMO portão (o texto do áudio já chega
 * transcrito e normalizado pelo webhook).
 *
 * NUNCA:
 *   - abre sessão financeira
 *   - escreve em qualquer tabela
 *   - presume intenção de lançamento
 */

export type IntentGateDecision =
  | { kind: "pass" } // sinal financeiro presente → pipeline segue normal
  | { kind: "capability" } // pergunta sobre o assistente/áudio → confirmar entendimento
  | { kind: "clarify" }; // sem sinal financeiro → pedir esclarecimento

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// --- Pergunta sobre capacidade/compreensão do assistente ------------------
// "você entende esse áudio?", "vc consegue me ouvir?", "tá me ouvindo?",
// "entendeu o que eu falei?", "está funcionando?", "teste", "testando".
const CAPABILITY_RES: RegExp[] = [
  /\b(voce|vc)\b[^?]*\b(entende|entendeu|consegue|consegues|ouve|ouvir|escuta|escutou)\b/,
  /\b(entende|entendeu|consegue|ouve|ouvindo|escuta|escutou)\b[^?]*\b(audio|voz|mensagem|mim|o que eu|isso|esse|essa|este|esta)\b/,
  /\b(ta|tava|esta|estava)?\s*(me\s+)?(ouvindo|escutando)\b/,
  /\b(esta|ta)\b[^?]*\b(funcionando|funciona)\b/,
  /^(teste|testando|teste de audio|testando audio|so um teste|so testando)[.!]*$/,
];

// --- Sinais financeiros ----------------------------------------------------
// Valor monetário forte: "R$ 50", "50 reais", "48,90", "2.500,00", "4 mil".
const STRONG_MONEY_RE =
  /(r\$\s*\d|\b\d+(?:[.,]\d{1,2})?\s*(?:reais|real|conto|contos|pila|pilas)\b|\b\d+[.,]\d{2}\b|\b\d+\s*mil\b|\bmil\s*reais\b)/;

// Qualquer dígito: "mercado 50", "Uber 25", "almoço 32" — o parser decide.
const ANY_DIGIT_RE = /\d/;

// Verbos de lançamento financeiro (despesa).
const EXPENSE_VERB_RE =
  /\b(gastei|gastamos|paguei|pagamos|comprei|compramos|torrei|desembolsei|lancei|lancar|lanca|registrar|registra|registrei|adicionar|adiciona|adicionei|anota|anotar|anotei|coloca|colocar|bota|botar)\b/;

// Comando explícito de registro: "quero registrar um gasto", "novo gasto",
// "lançar despesa" — intenção + substantivo do domínio, em qualquer ordem.
const LAUNCH_COMMAND_RE =
  /\b(registrar|lancar|adicionar|anotar|novo|nova|quero|preciso)\b[^?]*\b(gasto|gastos|despesa|despesas|lancamento|lancamentos)\b|\b(gasto|gastos|despesa|despesas|lancamento|lancamentos)\b[^?]*\b(registrar|lancar|adicionar|anotar)\b/;

export function hasExpenseSignal(texto: string): boolean {
  const t = norm(texto);
  if (!t) return false;
  return (
    STRONG_MONEY_RE.test(t) ||
    ANY_DIGIT_RE.test(t) ||
    EXPENSE_VERB_RE.test(t) ||
    LAUNCH_COMMAND_RE.test(t)
  );
}

export function isCapabilityQuestion(texto: string): boolean {
  const t = norm(texto);
  if (!t) return false;
  return CAPABILITY_RES.some((re) => re.test(t));
}

/**
 * Decide se a mensagem pode seguir para o parser genérico de despesa.
 * Puro: não lê banco, não grava nada, não depende de sessão.
 *
 * Ordem: sinal financeiro primeiro (um pedido real com valor nunca vira
 * resposta de capacidade), depois pergunta de capacidade, por fim
 * esclarecimento.
 */
export function evaluateIntentGate(texto: string): IntentGateDecision {
  const t = norm(texto);
  if (!t) return { kind: "pass" };
  if (hasExpenseSignal(t)) return { kind: "pass" };
  if (isCapabilityQuestion(t)) return { kind: "capability" };
  return { kind: "clarify" };
}

export const intentGateMsgs = {
  /** Confirma que a mensagem (texto ou áudio transcrito) foi entendida. */
  capability(source: string | undefined): string {
    const canal = source === "audio" ? "seu áudio" : "sua mensagem";
    return [
      `Sim, consegui entender ${canal}. 👂`,
      "",
      "Se quiser, posso:",
      '• registrar um gasto — ex.: "gastei 48,90 no mercado"',
      '• registrar uma receita — ex.: "recebi 500 de freelance"',
      '• responder consultas — ex.: "resumo do mês"',
      "",
      'Ou digite "menu" para ver tudo que eu faço.',
    ].join("\n");
  },
  /** Pede esclarecimento sem presumir lançamento nem abrir sessão. */
  clarify(): string {
    return [
      "Não identifiquei um gasto ou receita aí. 🤔",
      "",
      'Se quiser registrar um gasto, me diga com o valor, ex.: "gastei 48,90 no mercado".',
      'Para uma receita, ex.: "recebi 500 de freelance".',
      'Ou digite "menu" para ver o que eu consigo fazer.',
    ].join("\n");
  },
};
