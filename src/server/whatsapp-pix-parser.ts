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

/** Dica externa (ex.: marcador "chave celular X") para desambiguar. */
export type PixKeyHint = "email" | "telefone" | "cpf" | "cnpj" | "aleatoria";

/** Valida CPF pelos dígitos verificadores (padrão Receita Federal). */
function isValidCPF(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (factor - i);
    }
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(digits.slice(0, 9), 10);
  const d2 = calc(digits.slice(0, 10), 11);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

/** Padrão celular BR: DDD válido (11–99, sem zero) + prefixo 9 + 8 dígitos. */
function isBrazilianMobilePattern(digits: string): boolean {
  return /^[1-9][1-9]9\d{8}$/.test(digits);
}

/**
 * Reconhece email, telefone BR, CPF, CNPJ e UUID v4 (aleatória).
 *
 * `hint` vem de marcadores explícitos no texto ("chave celular X",
 * "telefone X", "chave cpf X"). Quando presente, força a classificação
 * — nunca "adivinha" outro tipo por cima.
 */
export function detectPixKeyType(raw: string, hint?: PixKeyHint): PixKeyType {
  const k = (raw ?? "").trim();
  if (!k) return "desconhecida";

  // 1) Dica explícita do usuário tem prioridade absoluta.
  if (hint) {
    const digits = k.replace(/\D+/g, "");
    if (hint === "email") {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) ? "email" : "desconhecida";
    }
    if (hint === "telefone") {
      return digits.length >= 10 && digits.length <= 13 ? "telefone" : "desconhecida";
    }
    if (hint === "cpf") return digits.length === 11 ? "cpf" : "desconhecida";
    if (hint === "cnpj") return digits.length === 14 ? "cnpj" : "desconhecida";
    if (hint === "aleatoria") {
      return /^[0-9a-f-]{8,}$/i.test(k) ? "aleatoria" : "desconhecida";
    }
  }

  // 2) Detecção estrutural sem dica.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return "email";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
    return "aleatoria";
  }
  const digits = k.replace(/\D+/g, "");

  // Prefixo +55 → telefone BR.
  if (k.startsWith("+")) {
    if (digits.length >= 10 && digits.length <= 13) return "telefone";
  }

  if (digits.length === 11) {
    // Máscara CPF explícita ("123.456.789-00") → CPF.
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(k)) return "cpf";
    // Máscara de telefone (parênteses/espaços/+) → telefone.
    if (/[()\s+]/.test(k)) return "telefone";
    // Sem máscara: desambigua por padrão brasileiro de celular
    // (DDD válido + prefixo 9). Só cai em CPF quando o padrão de celular
    // NÃO bate e o número é um CPF matematicamente válido.
    if (isBrazilianMobilePattern(digits)) return "telefone";
    if (isValidCPF(digits)) return "cpf";
    // Nada bate: fallback conservador → telefone (evita cadastrar
    // silenciosamente um CPF inválido como se fosse chave real).
    return "telefone";
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
];

export function detectSavePixIntent(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (!t) return false;
  // exclui consultas claras ("qual o pix do joão", "chave pix do joão",
  // "pix do joão" isolado — trata-se como query, não save).
  if (/^\s*(qual|me\s+manda|manda\s+o|envia\s+o|cade|cadê|onde)\b/i.test(t)) {
    return false;
  }
  if (/^\s*chave(?:\s+pix)?\s+(?:do|da|de|dos|das)\b/i.test(t)) {
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
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)\s*(?::|=|(?:\s|^)(?:e|eh|é|sera|será)(?:\s|$))\s*([^\s].{0,80}?)\s*$/i;
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
    // "qual (é/a/o) (a chave)? pix do João"
    /\b(?:qual|cade|cadê|onde\s+(?:esta|está))\b[^?]*\bpix\b/i.test(t) ||
    // "qual a chave do João" (sem a palavra pix, mas com "chave")
    /\bqual\b[^?]*\bchave\b[^?]*\b(?:do|da|de|dos|das)\s+\S+/i.test(t) ||
    // "me manda/passa/envia (o) (chave)? pix"
    /\bme\s+(?:manda|passa|envia|diz)\s+(?:o\s+|a\s+)?(?:chave\s+(?:pix\s+)?)?pix\b/i.test(t) ||
    // "manda/envia/passa (o|a) (chave)? pix"
    /\b(?:manda|envia|passa)\s+(?:o|a)\s+(?:chave\s+(?:pix\s+)?)?pix\b/i.test(t) ||
    // "chave pix do João" / "chave do João" isolado no início
    /^\s*(?:a\s+|o\s+)?chave(?:\s+pix)?\s+(?:do|da|de|dos|das)\s+\S+/i.test(t) ||
    // "pix do João" isolado (sem separador de key → não é save)
    /^\s*(?:o\s+|a\s+)?pix\s+(?:do|da|de|dos|das)\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\s-]{0,60}\s*[?.!]?\s*$/i.test(t) ||
    /\bquero\s+pagar\s+\w+.*\bpix\b/i.test(t)
  );
}

export type QueryPixParsed = { nome: string };

export function parseQueryPix(texto: string): QueryPixParsed | null {
  if (!texto) return null;
  // "pix do/da NOME"
  const re =
    /pix\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)(?:\s*[?.!]|\s*$)/i;
  const m = texto.match(re);
  if (m) {
    const nome = cleanNome(m[1]);
    if (nome) return { nome };
  }
  // "chave (pix)? do/da NOME"
  const reChave =
    /chave(?:\s+pix)?\s+(?:do|da|de|dos|das)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{0,40}?)(?:\s*[?.!]|\s*$)/i;
  const mc = texto.match(reChave);
  if (mc) {
    const nome = cleanNome(mc[1]);
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

// Stopwords ADICIONAIS só do contexto de pagamento — preposições/artigos que
// aparecem imediatamente antes da forma de pagamento (Pix, cartão, etc.) e
// que, se engolidos como sobrenome, quebram o match com o favorecido.
// Ex.: "paguei 50 pro João no Pix" NÃO deve virar "João No".
// NÃO é aplicada globalmente (NOME_STOPWORDS continua conservador) para não
// quebrar nomes compostos legítimos em outros parsers.
const PAGAR_PESSOA_EXTRA_STOPWORDS = new Set([
  "no", "na", "nos", "nas",
  "pelo", "pela", "pelos", "pelas",
  "via", "com", "usando", "por",
]);

function cleanNomeStrict(s: string): string {
  // Walk tokens em ordem e PARA no primeiro stopword (não pré-filtra),
  // assim "João do almoço" devolve apenas "João" em vez de "João Almoço".
  const tokens = s.trim().split(/\s+/);
  const valid: string[] = [];
  for (const t of tokens) {
    const n = norm(t);
    if (n.length < 2) break;
    if (NOME_STOPWORDS.has(n)) break;
    if (PAGAR_PESSOA_EXTRA_STOPWORDS.has(n)) break;
    if (/\d/.test(t)) break;
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

// =========================================================================
// 4) Pix inline: "Pix VALOR para NOME chave CHAVE"
//
// Este parser é APENAS para o formato natural iniciado pela palavra "pix"
// seguido de valor + destinatário + chave. Deve rodar ANTES do parser
// genérico de gasto e ANTES do fluxo pagar-pessoa (que não captura chave).
//
// NÃO envia Pix externo. Registra um pagamento interno + upsert do
// favorecido com a chave já vinculada.
// =========================================================================

export type PagarPixInlineParsed = {
  nome: string;
  valorCentavos: number;
  pixKey: string;
  pixKeyType: PixKeyType;
};

/**
 * Detecta o formato inline "Pix VALOR para NOME chave CHAVE" (com ou sem
 * a palavra "chave"). Requer todos os elementos: iniciar por "pix",
 * ter valor, preposição de destino, nome e chave reconhecível.
 */
export function detectPagarPixInlineIntent(texto: string): boolean {
  if (!texto) return false;
  const raw = texto.trim();
  // Deve começar com "pix" (opcional artigo).
  if (!/^\s*(?:um\s+|o\s+)?pix\b/i.test(raw)) return false;
  // Exclui claramente consultas / cadastros existentes.
  if (detectSavePixIntent(raw)) return false;
  if (detectQueryPixIntent(raw)) return false;
  return parsePagarPixInline(raw) !== null;
}

/**
 * Extrai valor + nome + chave do texto. Retorna null se qualquer
 * componente estiver ausente ou se a chave não for reconhecível
 * (tipo `desconhecida` também retorna null — chave inválida).
 */
export function parsePagarPixInline(texto: string): PagarPixInlineParsed | null {
  if (!texto) return null;
  const t = texto.trim();

  // 4.1) Formato canônico com marcador "chave":
  //   Pix 50 para João Silva chave 11999998888
  //   Pix R$ 50,00 pra Maria chave joao@email.com
  //   Pix 50 para João chave celular 11999998888   ← dica explícita
  //   Pix 50 para João celular 11999998888          ← dica sem "chave"
  const reComChave =
    /^\s*(?:um\s+|o\s+)?pix\s+(?:r\$?\s*)?(\d+(?:[.,]\d{1,2})?)\s+(?:pra|para|pro|ao|à)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\s-]{1,50}?)\s+(?:chave(?:\s+(celular|telefone|cpf|cnpj|email|aleat[oó]ria))?|(celular|telefone|cpf|cnpj|email|aleat[oó]ria))\s+(\S(?:.*\S)?)\s*$/i;
  const m1 = t.match(reComChave);
  if (m1) {
    const valorCentavos = parseBRLToCentavosPix(m1[1]);
    const nome = cleanNomeInline(m1[2]);
    const hint = normalizeHint(m1[3] ?? m1[4]);
    const raw = (m1[5] ?? "").trim();
    if (valorCentavos > 0 && nome && raw) {
      const type = detectPixKeyType(raw, hint);
      if (type === "desconhecida") return null;
      return {
        nome,
        valorCentavos,
        pixKey: normalizePixKey(raw, type),
        pixKeyType: type,
      };
    }
  }

  // 4.2) Formato sem "chave" — nome seguido diretamente pela chave.
  const reSemChave =
    /^\s*(?:um\s+|o\s+)?pix\s+(?:r\$?\s*)?(\d+(?:[.,]\d{1,2})?)\s+(?:pra|para|pro|ao|à)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\s-]{1,50}?)\s+(\S+@\S+\.\S+|\+?[\d.()\-\s]{10,25}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;
  const m2 = t.match(reSemChave);
  if (m2) {
    const valorCentavos = parseBRLToCentavosPix(m2[1]);
    const nome = cleanNomeInline(m2[2]);
    const raw = (m2[3] ?? "").trim();
    if (valorCentavos > 0 && nome && raw) {
      const type = detectPixKeyType(raw);
      if (type === "desconhecida") return null;
      return {
        nome,
        valorCentavos,
        pixKey: normalizePixKey(raw, type),
        pixKeyType: type,
      };
    }
  }

  return null;
}

function normalizeHint(raw: string | undefined): PixKeyHint | undefined {
  if (!raw) return undefined;
  const h = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (h === "celular" || h === "telefone") return "telefone";
  if (h === "cpf") return "cpf";
  if (h === "cnpj") return "cnpj";
  if (h === "email") return "email";
  if (h === "aleatoria") return "aleatoria";
  return undefined;
}

function parseBRLToCentavosPix(s: string): number {
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100);
}

function cleanNomeInline(s: string): string {
  // Igual a cleanNome, mas rejeita se restar apenas stopwords ou se a
  // última palavra for "chave"/tipo (residual quando o regex captura
  // demais). Filtra pontuação lateral.
  const raw = s
    .trim()
    .replace(/[,.;:!?]+$/g, "")
    .trim();
  const tokens = raw.split(/\s+/).filter((w) => {
    const n = norm(w);
    return (
      n.length > 0 &&
      !NOME_STOPWORDS.has(n) &&
      !/^(cpf|cnpj|email|telefone|celular|chave|aleatoria|aleatória|pix)$/i.test(w)
    );
  });
  if (tokens.length === 0) return "";
  return normNome(tokens.slice(0, 3).join(" "));
}

// =========================================================================
// 5) Máscara de chave Pix para exibição SEGURA (preview, sucesso, logs)
//
// Nunca expor chave completa em resposta ao usuário para não vazar em
// screenshots/backups do WhatsApp da conversa alheia. Cumpre LGPD.
// =========================================================================

export function maskPixKey(pixKey: string, type: PixKeyType): string {
  const k = (pixKey ?? "").trim();
  if (!k) return "";
  switch (type) {
    case "email": {
      const [user, dom] = k.split("@");
      if (!user || !dom) return "***";
      const uMask = user.length <= 2
        ? user[0] + "*"
        : user[0] + "***" + user.slice(-1);
      return `${uMask}@${dom}`;
    }
    case "telefone": {
      // Preserva DDD e últimos 4. Ex.: 11999998888 → "+55 11 9∗∗∗∗-8888".
      // Usa U+2217 (∗) em vez de U+002A (*) para evitar que o WhatsApp
      // interprete `****` como marcação de negrito (`**...**`) e engula
      // pares de asteriscos no render — o que fazia aparecer "9**-8888".
      // A chave em si permanece completa em memória / banco; só o render
      // exibido é mascarado.
      const d = k.replace(/\D+/g, "");
      if (d.length < 4) return "∗∗∗";
      const last4 = d.slice(-4);
      // Remove código de país 55 se presente para extrair DDD.
      const local = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
      if (local.length === 11) {
        const ddd = local.slice(0, 2);
        return `+55 ${ddd} 9∗∗∗∗-${last4}`;
      }
      if (local.length === 10) {
        const ddd = local.slice(0, 2);
        return `+55 ${ddd} ∗∗∗∗-${last4}`;
      }
      return `+∗∗ (∗∗) ∗∗∗∗∗-${last4}`;
    }
    case "cpf": {
      // Totalmente mascarado — nunca expor final do CPF.
      return "***.***.***-**";
    }
    case "cnpj": {
      const d = k.replace(/\D+/g, "");
      if (d.length < 4) return "***";
      return `**.***.***/****-${d.slice(-2)}`;
    }
    case "aleatoria": {
      if (k.length <= 8) return "********";
      return `${k.slice(0, 4)}****${k.slice(-4)}`;
    }
    default:
      return "***";
  }
}

