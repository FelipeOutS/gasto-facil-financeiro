/**
 * WA-C7 — Parser puro (sem efeitos colaterais) para os 3 fluxos de Pix:
 *
 *  - detectSavePixIntent + parseSavePix         → cadastrar Pix do João
 *  - detectQueryPixIntent + parseQueryPix       → "qual o Pix do João?"
 *  - detectPagarPessoaIntent + parsePagarPessoa → "paguei 50 ao João do almoço"
 *
 * Garantias:
 *  - 100% determinístico, sem I/O. Pode ser exercitado em testes unitários
 *    sem mocks.
 *  - Nunca retorna texto cru do usuário; só campos extraídos.
 *  - Não loga nada. Logs ficam por conta dos handlers.
 *
 * Tipos de chave Pix suportados (alinhados ao CHECK da migration):
 *  email | telefone | cpf | cnpj | aleatoria | desconhecida
 */

export type PixKeyType =
  | "email"
  | "telefone"
  | "cpf"
  | "cnpj"
  | "aleatoria"
  | "desconhecida";

// --- Stopwords que não podem ser nome de favorecido ----------------------
const NOME_STOPWORDS = new Set([
  "pix", "chave", "conta", "fatura", "internet", "luz", "agua", "água",
  "aluguel", "academia", "boleto", "cartao", "cartão", "credito", "crédito",
  "debito", "débito", "dinheiro", "reais", "real", "voce", "você", "mim",
  "eu", "ele", "ela", "alguem", "alguém", "favorecido", "pessoa",
  "fornecedor", "isso", "essa", "esse", "minha", "meu", "essa", "uma",
  "um", "a", "o", "as", "os", "de", "do", "da", "dos", "das", "para",
  "pra", "pro", "ao", "à", "à", "ja", "já", "hoje", "ontem", "amanha",
  "amanhã",
]);

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normNome(s: string): string {
  // Capitaliza primeira letra de cada palavra preservando acentos.
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// =========================================================================
// Classificação de tipo de chave Pix
// =========================================================================

/** Reconhece email simples, telefone BR, CPF, CNPJ e UUID v4 (aleatória). */
export function detectPixKeyType(raw: string): PixKeyType {
  const k = (raw ?? "").trim();
  if (!k) return "desconhecida";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return "email";
  // UUID v4 ou parecido (chave aleatória do BCB tem formato UUID v4).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
    return "aleatoria";
  }
  const digits = k.replace(/\D+/g, "");
  if (digits.length === 11 && !k.startsWith("+")) {
    // 11 dígitos puros: pode ser CPF ou celular com DDD. Heurística:
    // se a entrada tinha pontos ou traços ("123.456.789-00"), CPF.
    // Se tinha parênteses/espaços/+, telefone.
    if (/[.\-]/.test(k) && !/[()\s+]/.test(k)) return "cpf";
    if (/[()\s+]/.test(k)) return "telefone";
    // Sem máscara, 11 dígitos: privilegia CPF (regra mais comum no Brasil
    // ao "ditar Pix"). Telefone normalmente vem com DDD entre parênteses
    // ou com +55.
    return "cpf";
  }
  if (digits.length === 14) return "cnpj";
  if (digits.length >= 10 && digits.length <= 13) return "telefone";
  return "desconhecida";
}

/** Normaliza a chave para armazenamento: remove máscaras quando faz sentido. */
export function normalizePixKey(raw: string, type: PixKeyType): string {
  const k = (raw ?? "").trim();
  if (type === "cpf" || type === "cnpj") return k.replace(/\D+/g, "");
  if (type === "telefone") {
    const d = k.replace(/\D+/g, "");
    return d.startsWith("55") || d.length >= 12 ? `+${d}` : d;
  }
  if (type === "email") return k.toLowerCase();
  return k;
}

// =========================================================================
// 1) Cadastrar Pix
// =========================================================================

const SAVE_PIX_TRIGGERS = [
  /\b(?:salv|cadastr|guard|grav|anot)[aeoiu][a-z]*\b.{0,30}\bpix\b/i,
  /\bpix\s+(?:do|da|de|dos|das)\s+\S+.{0,80}\b(?:e|eh|é|=|:|sera|será)\b/i,
  /^\s*(?:o|a)?\s*pix\s+(?:do|da|de|dos|das)\b/i,
];

export function detectSavePixIntent(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (!t) return false;
  // exclui consultas claras ("qual o pix do joão")
  if (/^\s*(qual|me\s+manda|manda\s+o|envia\s+o|cade|cadê|onde)\b/i.test(t)) {
    return false;
  }
  return SAVE_PIX_TRIGGERS.some((re) => re.test(t));
}

export type SavePixParsed = {
  nome: string;
  pixKey: string;
  pixKeyType: PixKeyType;
};

/**
 * Extrai nome + chave Pix do texto. Retorna null se não conseguir isolar
 * ambos com segurança — handler deve responder pedindo no formato canônico.
 */
export function parseSavePix(texto: string): SavePixParsed | null {
  if (!texto) return null;
  // Tenta primeiro o formato "pix do/da NOME ... CHAVE" com separador.
  // Aceita ":", "=", "é", "eh", "e" (apenas como separador explícito).
  const reFull =
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)\s*(?::|=|\b(?:e|eh|é)\b|\bsera\b|\bserá\b)\s*([^\s].{0,80}?)\s*$/i;
  const m1 = texto.match(reFull);
  if (m1) {
    const nome = cleanNome(m1[1]);
    const raw = (m1[2] ?? "").trim();
    if (nome && raw) {
      const type = detectPixKeyType(raw);
      return { nome, pixKey: normalizePixKey(raw, type), pixKeyType: type };
    }
  }
  // Fallback: "salva o pix do joão joao@email.com" (sem separador explícito).
  const reFallback =
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)\s+(\S+@\S+\.\S+|[0-9][\d.\-\s()+]{8,})/i;
  const m2 = texto.match(reFallback);
  if (m2) {
    const nome = cleanNome(m2[1]);
    const raw = (m2[2] ?? "").trim();
    if (nome && raw) {
      const type = detectPixKeyType(raw);
      return { nome, pixKey: normalizePixKey(raw, type), pixKeyType: type };
    }
  }
  // Fallback: "cadastra pix do pedro cpf 123.456.789-00"
  const reCpf =
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)\s+(?:cpf|cnpj|telefone|celular|email|chave)\s+(\S.{0,80}?)\s*$/i;
  const m3 = texto.match(reCpf);
  if (m3) {
    const nome = cleanNome(m3[1]);
    const raw = (m3[2] ?? "").trim();
    if (nome && raw) {
      const type = detectPixKeyType(raw);
      return { nome, pixKey: normalizePixKey(raw, type), pixKeyType: type };
    }
  }
  return null;
}

function cleanNome(s: string): string {
  // remove preposições residuais à direita e palavras de tipo de chave.
  const tokens = s.trim().split(/\s+/).filter((w) => {
    const n = norm(w);
    return n.length > 0 && !NOME_STOPWORDS.has(n)
      && !/^(cpf|cnpj|email|telefone|celular|chave|aleatoria|aleatória)$/i.test(w);
  });
  if (tokens.length === 0) return "";
  return normNome(tokens.join(" "));
}

// =========================================================================
// 2) Consultar Pix
// =========================================================================

export function detectQueryPixIntent(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (!t) return false;
  if (detectSavePixIntent(t)) return false;
  return (
    /\b(?:qual|cade|cadê|onde\s+(?:esta|está))\s+(?:e\s+)?(?:o\s+)?pix\b/i.test(t) ||
    /\bme\s+(?:manda|passa|envia|diz)\s+(?:o\s+)?pix\b/i.test(t) ||
    /\b(?:manda|envia|passa)\s+o\s+pix\b/i.test(t) ||
    /\bquero\s+pagar\s+\w+.*\bpix\b/i.test(t)
  );
}

export type QueryPixParsed = { nome: string };

export function parseQueryPix(texto: string): QueryPixParsed | null {
  if (!texto) return null;
  const re =
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)(?:\s*[?.!]|\s*$)/i;
  const m = texto.match(re);
  if (m) {
    const nome = cleanNome(m[1]);
    if (nome) return { nome };
  }
  // "quero pagar o joão, manda o pix dele"
  const re2 = /quero\s+pagar\s+(?:o|a)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)\b.*pix/i;
  const m2 = texto.match(re2);
  if (m2) {
    const nome = cleanNome(m2[1]);
    if (nome) return { nome };
  }
  return null;
}

// =========================================================================
// 3) Pagamento para pessoa
// =========================================================================

const VERBOS_PAGAMENTO = [
  "paguei", "pago", "quitei", "ja paguei", "já paguei",
  "acabei de pagar", "transferi", "pix pra", "pix para",
];

const VERBO_RE = new RegExp(
  `\\b(?:${VERBOS_PAGAMENTO.map((v) => v.replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i",
);

/**
 * Detecta pagamento explícito para pessoa.
 *
 * Critérios (todos obrigatórios):
 *  1. verbo de pagamento
 *  2. valor monetário (R$ X ou "X reais" ou "X" próximo de "pra/ao/para")
 *  3. destinatário explícito via preposição "para/pra/pro/ao/à"
 *     OU padrão "paguei <Nome> <valor>" / "paguei o <Nome>"
 *
 * NÃO dispara quando o texto cita conta/boleto/fatura/cartão — esses ficam
 * com WA-C3 (baixa de conta a pagar).
 */
export function detectPagarPessoaIntent(texto: string): boolean {
  const raw = (texto ?? "").trim();
  if (!raw) return false;
  const t = norm(raw);
  if (!VERBO_RE.test(t)) return false;
  // Exclui boletos / contas conhecidas (deixa para WA-C3).
  if (/\b(boleto|fatura|conta\s+de\s+\w+|cartao|cartão)\b/.test(t)) return false;
  // Precisa de valor monetário (R$ X, X reais, ou número solto).
  if (!/\b\d/.test(t)) return false;
  // Precisa de destinatário: "para/pra/pro/ao + nome" OU pattern direto.
  if (/\b(?:para|pra|pro|ao|a)\s+[a-zà-ÿ][a-zà-ÿ]+/.test(t)) return true;
  // "paguei o joão 50" / "paguei maria 120"
  if (/^(?:paguei|pago|quitei|ja\s+paguei|acabei\s+de\s+pagar)\s+(?:o\s+|a\s+)?[a-zà-ÿ][a-zà-ÿ]+\s+(?:r?\$?\s*)?\d/i.test(raw)) {
    return true;
  }
  return false;
}

export type PagarPessoaParsed = {
  nome: string;
  valorCentavos: number;
  descricao: string | null;
  formaPagamento: "pix" | "outro";
};

/** Parser do "paguei R$ X ao João do almoço". */
export function parsePagarPessoa(texto: string): PagarPessoaParsed | null {
  if (!texto) return null;
  const valor = extrairValorCentavos(texto);
  if (valor === null) return null;
  const nome = extrairNomePessoa(texto);
  if (!nome) return null;
  const descricao = extrairDescricaoPagamento(texto);
  const formaPagamento =
    /\bpix\b/i.test(texto) || /\bno\s+pix\b/i.test(texto) ? "pix" : "outro";
  return { nome, valorCentavos: valor, descricao, formaPagamento };
}

function extrairValorCentavos(texto: string): number | null {
  // R$ 1.234,56 | R$ 50 | 50,00 reais | 50 reais | 80 (após "pra/ao")
  const reMoeda = /r\$?\s*([\d.]+(?:,\d{1,2})?)/i;
  const m1 = texto.match(reMoeda);
  if (m1) return parseBRLToCentavos(m1[1]);
  const reReais = /\b(\d+(?:[.,]\d{1,2})?)\s*reais?\b/i;
  const m2 = texto.match(reReais);
  if (m2) return parseBRLToCentavos(m2[1]);
  // número solto perto da preposição: "paguei 50 ao joão", "joão 120 da faxina"
  const reNum = /\b(\d{1,6}(?:[.,]\d{1,2})?)\b/;
  const m3 = texto.match(reNum);
  if (m3) return parseBRLToCentavos(m3[1]);
  return null;
}

function parseBRLToCentavos(s: string): number {
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100);
}

function extrairNomePessoa(texto: string): string | null {
  // Preferência: "para/pra/pro/ao + <nome 1-3 palavras>"
  const re1 =
    /\b(?:para|pra|pro|ao|à)\s+(?:o\s+|a\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{1,30}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{1,30}){0,2})\b/i;
  const m1 = texto.match(re1);
  if (m1) {
    const nome = cleanNomeStrict(m1[1]);
    if (nome) return nome;
  }
  // "paguei o joão 50 do almoço"
  const re2 =
    /^(?:paguei|pago|quitei|ja\s+paguei|já\s+paguei|acabei\s+de\s+pagar)\s+(?:o\s+|a\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{1,30}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{1,30}){0,2})\s+/i;
  const m2 = texto.match(re2);
  if (m2) {
    const nome = cleanNomeStrict(m2[1]);
    if (nome) return nome;
  }
  return null;
}

function cleanNomeStrict(s: string): string {
  const tokens = s.trim().split(/\s+/).filter((w) => {
    const n = norm(w);
    return n.length > 1 && !NOME_STOPWORDS.has(n) && !/^\d+$/.test(w);
  });
  // Para no primeiro token que seja stopword (não corta palavras válidas).
  const valid: string[] = [];
  for (const t of tokens) {
    const n = norm(t);
    if (NOME_STOPWORDS.has(n) || /\d/.test(t)) break;
    valid.push(t);
    if (valid.length >= 3) break;
  }
  if (valid.length === 0) return "";
  return normNome(valid.join(" "));
}

function extrairDescricaoPagamento(texto: string): string | null {
  // "do almoço", "da faxina", "de serviço", "do trabalho de quinta"
  const re = /\b(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,30}?)(?:\s*[.!?]|\s*$)/i;
  const m = texto.match(re);
  if (m) {
    const desc = m[1].trim();
    const n = norm(desc);
    // descarta se for só stopword ou nome de pessoa (heurística simples)
    if (NOME_STOPWORDS.has(n) || /^\d/.test(desc)) return null;
    return desc;
  }
  return null;
}
