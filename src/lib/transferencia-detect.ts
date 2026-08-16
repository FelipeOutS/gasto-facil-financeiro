/**
 * Detecção de transferências em importações de extrato.
 *
 * Objetivo: separar três situações que os bancos escrevem de forma parecida:
 *  - `transferencia_interna`: dinheiro que só mudou de lugar entre contas do
 *    próprio usuário (não é gasto nem receita).
 *  - `terceiro`: Pix/TED/DOC enviado ou recebido de outra pessoa/empresa
 *    (é gasto ou receita de verdade).
 *  - `incerta`: o texto indica transferência, mas não dá para saber a
 *    titularidade — precisa de revisão manual do usuário.
 */

export type TransferenciaClass = "transferencia_interna" | "terceiro" | "incerta";

export type TransferenciaDeteccao = {
  classe: TransferenciaClass;
  /** Confiança da heurística. */
  certeza: "alta" | "media" | "baixa";
  /** Motivo legível (usado em observação/tooltip). */
  motivo: string;
};

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sinais fortes de movimentação entre contas do MESMO titular. */
const PADROES_INTERNOS: Array<[RegExp, string]> = [
  [/entre\s+contas/, "menciona transferência entre contas"],
  [/mesma\s+titularidade/, "menciona mesma titularidade"],
  [/mesmo\s+titular/, "menciona mesmo titular"],
  [/pr[oó]pria\s+conta|conta\s+pr[oó]pria/, "menciona conta própria"],
  [/transfer[eê]ncia\s+interna/, "transferência interna explícita"],
  [/aplica[cç][aã]o\s+autom/, "aplicação automática (conta/poupança)"],
  [/resgate\s+autom/, "resgate automático (conta/poupança)"],
  [/para\s+poupan[cç]a|da\s+poupan[cç]a/, "movimentação com poupança"],
  [/cofrinho|caixinha|reserva\s+de\s+emerg/, "movimentação para reserva própria"],
];

/** Sinais fortes de que o outro lado é um terceiro (gasto/receita real). */
const PADROES_TERCEIRO: Array<[RegExp, string]> = [
  [/pix\s+(enviado|recebido)\s+\S+/, "Pix com contraparte identificada"],
  [/(pagamento|compra|recarga|assinatura|mensalidade)\b/, "descrição de pagamento/compra"],
  [/\bboleto\b/, "pagamento de boleto"],
  [/\b(ltda|me\b|mei\b|s\.?a\.?|eireli)\b/, "contraparte é pessoa jurídica"],
  [/\bcnpj\b/, "contraparte com CNPJ"],
  [/sal[aá]rio|proventos|rendimento\s+do\s+trabalho/, "recebimento de terceiro"],
];

/** Palavras que apenas indicam "é uma transferência", sem dizer de quem. */
const PADROES_TRANSFERENCIA = /\b(ted|doc|tef|pix|transf(er[eê]ncia)?)\b/;

/**
 * Classifica uma movimentação a partir da descrição (e opcionalmente da
 * contraparte informada pelo extrato).
 */
export function detectarTransferencia(
  descricao: string,
  contraparte?: string | null,
): TransferenciaDeteccao {
  const texto = norm([descricao, contraparte].filter(Boolean).join(" "));
  if (!texto) return { classe: "terceiro", certeza: "baixa", motivo: "sem descrição" };

  for (const [re, motivo] of PADROES_INTERNOS) {
    if (re.test(texto)) return { classe: "transferencia_interna", certeza: "alta", motivo };
  }
  for (const [re, motivo] of PADROES_TERCEIRO) {
    if (re.test(texto)) return { classe: "terceiro", certeza: "alta", motivo };
  }
  if (PADROES_TRANSFERENCIA.test(texto)) {
    return {
      classe: "incerta",
      certeza: "baixa",
      motivo: "transferência sem identificação do titular da outra conta",
    };
  }
  return { classe: "terceiro", certeza: "media", motivo: "movimentação comum" };
}

export type TipoMovimentacaoDetectado = "despesa" | "receita" | "transferencia_interna";

/**
 * Resolve o tipo final do lançamento importado.
 * `valorAssinado` < 0 = saída da conta.
 */
export function resolverTipoMovimentacao(
  descricao: string,
  valorAssinado: number,
  contraparte?: string | null,
): {
  tipo: TipoMovimentacaoDetectado;
  precisaRevisao: boolean;
  deteccao: TransferenciaDeteccao;
} {
  const deteccao = detectarTransferencia(descricao, contraparte);
  const base: TipoMovimentacaoDetectado = valorAssinado < 0 ? "despesa" : "receita";
  if (deteccao.classe === "transferencia_interna") {
    return { tipo: "transferencia_interna", precisaRevisao: false, deteccao };
  }
  if (deteccao.classe === "incerta") {
    // Mantém o tipo pelo sinal do valor, mas pede confirmação: pode ser
    // apenas dinheiro trocando de conta e viraria um gasto/receita falso.
    return { tipo: base, precisaRevisao: true, deteccao };
  }
  return { tipo: base, precisaRevisao: false, deteccao };
}
