/**
 * Parser local de itens de cupom fiscal (NFC-e) a partir de texto colado.
 *
 * Funções puras: sem React, sem fetch, sem localStorage, sem Supabase, sem DOM.
 * O objetivo é apenas extrair o melhor possível um conjunto de itens a partir
 * de texto bruto e devolver uma prévia que o usuário ainda vai revisar.
 *
 * Nada aqui salva, sincroniza ou consulta qualquer serviço externo.
 */

export type CupomItemConfidence = "alta" | "media" | "baixa";

export interface CupomItemPreview {
  id: string;
  nome: string;
  quantidade: number;
  unidade?: string;
  valorUnitario?: number;
  valorTotal?: number;
  codigoBarras?: string;
  confianca: CupomItemConfidence;
}

export interface CupomParseResult {
  status:
    | "empty"
    | "no_items"
    | "parsed"
    | "receipt_url_detected"
    | "receipt_url_no_items"
    | "low_confidence_items";
  items: CupomItemPreview[];
  warnings: string[];
}

// Texto que indica referência de NFC-e (URL/QR/chave) e NUNCA é nome de produto.
const RECEIPT_REFERENCE_TOKENS = [
  "http://",
  "https://",
  "www.",
  ".gov.br",
  "fazenda",
  "sefaz",
  "nfce",
  "nfc-e",
  "nfeconsulta",
  "nfceconsulta",
  "consultapublica",
  "chnfe",
  "qrcode",
  "tpamb",
  "nversao",
];

function looksLikeReceiptReference(raw: string): boolean {
  const s = raw.toLowerCase();
  if (RECEIPT_REFERENCE_TOKENS.some((tok) => s.includes(tok))) return true;
  // Chave de acesso de 44 dígitos contínuos (ignora separadores comuns).
  const onlyDigits = raw.replace(/\D+/g, "");
  if (/\d{44}/.test(onlyDigits)) return true;
  return false;
}

function nameLooksLikeReceiptReference(name: string): boolean {
  if (!name) return true;
  if (looksLikeReceiptReference(name)) return true;
  // Nome com pouquíssimo texto comercial real não é produto.
  const letters = name.replace(/[^a-zA-Zà-úÀ-Ú]/g, "");
  if (letters.length < 3) return true;
  return false;
}

// ---------- helpers ----------

const IGNORE_KEYWORDS = [
  "cnpj",
  "endereço",
  "endereco",
  "rua ",
  "av ",
  "avenida",
  "bairro",
  "municipio",
  "município",
  "uf:",
  "chave de acesso",
  "chave acesso",
  "protocolo",
  "autorização",
  "autorizacao",
  "tributos",
  "trib aprox",
  "forma de pagamento",
  "forma pagamento",
  "valor pago",
  "valor a pagar",
  "valor total",
  "vl total",
  "total r$",
  "total da compra",
  "total da nota",
  "total geral",
  "total dos itens",
  "total de itens",
  "qtd. total",
  "qtde total",
  "quantidade total",
  "desconto",
  "acréscimo",
  "acrescimo",
  "subtotal",
  "troco",
  "dinheiro",
  "cartão",
  "cartao",
  "pix",
  "consumidor",
  "nfc-e",
  "nfc e",
  "nf-e",
  "danfe",
  "sefaz",
  "documento auxiliar",
  "emissão",
  "emissao",
];

function isIgnorableLine(raw: string): boolean {
  const line = raw.toLowerCase().trim();
  if (!line) return true;
  return IGNORE_KEYWORDS.some((k) => line.includes(k));
}

function safeNumber(n: number | undefined | null): number | undefined {
  if (n === undefined || n === null) return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function parseBR(value: string): number | undefined {
  if (!value) return undefined;
  // Remove R$, espaços e separadores de milhar.
  const cleaned = value
    .replace(/r\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // remove pontos como separador de milhar
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return safeNumber(n);
}

function makeId(): string {
  return `item_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

const UNIT_REGEX = /\b(un|und|unid|pç|pc|pç\.|cx|kg|g|gr|grs|l|lt|ml|mt|m|pct|pcte)\b/i;

function normalizeUnit(u?: string): string | undefined {
  if (!u) return undefined;
  const x = u.toLowerCase().replace(/\.$/, "");
  if (["un", "und", "unid", "pç", "pc", "pcte", "pct"].includes(x)) return "un";
  if (["kg"].includes(x)) return "kg";
  if (["g", "gr", "grs"].includes(x)) return "g";
  if (["l", "lt"].includes(x)) return "L";
  if (["ml"].includes(x)) return "ml";
  if (["cx"].includes(x)) return "cx";
  return x;
}

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d{1,3})?|\d+(?:[.,]\d{1,3})?`;

/**
 * Tenta extrair um item a partir de uma única linha.
 * Aceita variações tipo:
 *   "ARROZ TIPO 1 5KG  1 UN x 24,90  24,90"
 *   "1 ARROZ 5KG 24,90"
 *   "ARROZ 5KG 2 x 12,99 25,98"
 *   "LEITE 3,99"
 */
function tryParseLine(rawLine: string): CupomItemPreview | undefined {
  const line = rawLine.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  if (isIgnorableLine(line)) return undefined;

  // pegar todos os números no formato BR
  const numbers = Array.from(line.matchAll(new RegExp(NUM, "g"))).map((m) => m[0]);
  if (numbers.length === 0) return undefined;

  // EAN (8 a 14 dígitos puros)
  let codigoBarras: string | undefined;
  const eanMatch = line.match(/\b(\d{8,14})\b/);
  if (eanMatch) codigoBarras = eanMatch[1];

  // Padrão "Qtd x Vunit" e "Vtotal"
  // Ex.: "2 UN X 12,99 = 25,98", "2 x 12,99 25,98", "1,000 X 24,90 24,90"
  const qVuVt = line.match(
    new RegExp(
      `(${NUM})\\s*(?:${UNIT_REGEX.source})?\\s*[xX]\\s*(${NUM})(?:\\s*=?\\s*(${NUM}))?`,
    ),
  );

  let quantidade: number | undefined;
  let valorUnitario: number | undefined;
  let valorTotal: number | undefined;
  let unidade: string | undefined;

  // unidade na linha (qualquer ocorrência)
  const unitMatch = line.match(UNIT_REGEX);
  if (unitMatch) unidade = normalizeUnit(unitMatch[1]);

  if (qVuVt) {
    quantidade = parseBR(qVuVt[1]);
    valorUnitario = parseBR(qVuVt[2]);
    if (qVuVt[3]) valorTotal = parseBR(qVuVt[3]);
  } else {
    // fallback: último número = valorTotal (ou unitário)
    const last = parseBR(numbers[numbers.length - 1]);
    if (numbers.length >= 2) {
      const prev = parseBR(numbers[numbers.length - 2]);
      // Se o anterior parece quantidade pequena (<= 99) e termina inteiro, considerar como qtd
      if (prev !== undefined && prev > 0 && prev <= 99 && Number.isInteger(prev)) {
        quantidade = prev;
        valorUnitario = last;
      } else {
        valorTotal = last;
      }
    } else {
      valorTotal = last;
    }
  }

  // Nome: remover do início números de índice tipo "001 ", "12 -", e remover os
  // trechos numéricos finais para deixar só o texto descritivo.
  let nome = line
    .replace(/^\s*\d{1,4}\s*[-.)]?\s*/, "") // "001 ", "12-"
    .replace(new RegExp(`(${NUM})\\s*(?:${UNIT_REGEX.source})?\\s*[xX]\\s*(${NUM})(?:\\s*=?\\s*(${NUM}))?`), "")
    .replace(new RegExp(`(?:${UNIT_REGEX.source}\\s*)?(${NUM})\\s*$`), "")
    .replace(/r\$/gi, "")
    .replace(/[|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (codigoBarras) nome = nome.replace(codigoBarras, "").trim();
  // Strip dangling unidade no fim
  nome = nome.replace(new RegExp(`\\s*${UNIT_REGEX.source}\\s*$`, "i"), "").trim();
  // Strip pontuação solta
  nome = nome.replace(/^[\s.\-:_]+|[\s.\-:_]+$/g, "");

  if (!nome || nome.length < 2) return undefined;
  // Linhas que viraram só números não são produto
  if (/^[\d\s.,/-]+$/.test(nome)) return undefined;

  // Defaults seguros
  if (!quantidade || !Number.isFinite(quantidade) || quantidade <= 0) {
    quantidade = 1;
  }
  valorUnitario = safeNumber(valorUnitario);
  valorTotal = safeNumber(valorTotal);

  if (valorTotal === undefined && valorUnitario !== undefined) {
    const calc = quantidade * valorUnitario;
    if (Number.isFinite(calc)) valorTotal = Math.round(calc * 100) / 100;
  }

  // Confiança:
  // alta = tem quantidade + valor unitário + valor total
  // média = tem ao menos nome + (valor total OU valor unitário)
  // baixa = só nome ou valores duvidosos
  let confianca: CupomItemConfidence = "baixa";
  if (valorUnitario !== undefined && valorTotal !== undefined && qVuVt) {
    confianca = "alta";
  } else if (valorTotal !== undefined || valorUnitario !== undefined) {
    confianca = "media";
  }

  return {
    id: makeId(),
    nome,
    quantidade,
    unidade,
    valorUnitario,
    valorTotal,
    codigoBarras,
    confianca,
  };
}

export function parseCupomItemsFromText(input: string): CupomParseResult {
  const warnings: string[] = [];
  if (!input || !input.trim()) {
    return { status: "empty", items: [], warnings };
  }

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const items: CupomItemPreview[] = [];
  for (const line of lines) {
    try {
      const item = tryParseLine(line);
      if (item) items.push(item);
    } catch {
      // Linha mal-formada — ignora silenciosamente.
    }
  }

  if (items.length === 0) {
    return { status: "no_items", items: [], warnings };
  }

  // Sanitização final defensiva: remove NaN/Infinity de qualquer campo numérico.
  const safe = items.map((it) => ({
    ...it,
    quantidade: safeNumber(it.quantidade) ?? 1,
    valorUnitario: safeNumber(it.valorUnitario),
    valorTotal: safeNumber(it.valorTotal),
  }));

  return { status: "parsed", items: safe, warnings };
}

export function makeEmptyCupomItem(): CupomItemPreview {
  return {
    id: makeId(),
    nome: "",
    quantidade: 1,
    unidade: undefined,
    valorUnitario: undefined,
    valorTotal: undefined,
    codigoBarras: undefined,
    confianca: "baixa",
  };
}
