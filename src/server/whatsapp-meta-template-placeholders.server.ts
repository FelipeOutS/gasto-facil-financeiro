/**
 * WA-C11 FASE 4B.2.a — Validação e sanitização dos placeholders dos templates
 * Meta produtivos ({{1}} = data dd/mm/aaaa, {{2}} = rótulo).
 *
 * SERVER-ONLY. Puro (sem I/O). Fail-closed: entradas inválidas retornam
 * discriminado com motivo sanitizado; jamais lançam.
 *
 * Regras críticas de segurança:
 *  - {{1}}: string exata "dd/mm/aaaa", com data real (rejeita 29/02 em
 *    ano não-bissexto, dia 31 em mês incompatível, mês 0/13+, etc.).
 *  - {{2}}: trim, uma linha, 1-40 chars, sem HTML, sem URL, sem telefone,
 *    CPF, CNPJ, chave Pix, linha digitável (boleto), cartão, valor
 *    monetário. Fallback "Conta cadastrada" quando não passa.
 */

// ─────────────────────────────────────────────────────────────────────────────
// {{1}} — Data dd/mm/aaaa

export type DateValidationResult =
  | { ok: true; value: string; day: number; month: number; year: number }
  | { ok: false; reason: "not_string" | "wrong_format" | "impossible_date" };

const DATE_PATTERN = /^([0-3][0-9])\/([0-1][0-9])\/([0-9]{4})$/;

export function validateDatePlaceholder(input: unknown): DateValidationResult {
  if (typeof input !== "string") return { ok: false, reason: "not_string" };
  const m = DATE_PATTERN.exec(input);
  if (!m) return { ok: false, reason: "wrong_format" };
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12) return { ok: false, reason: "impossible_date" };
  if (day < 1) return { ok: false, reason: "impossible_date" };
  const maxDay = daysInMonth(month, year);
  if (day > maxDay) return { ok: false, reason: "impossible_date" };
  // Reconstrução server-side (garante que o valor emitido seja canônico).
  const canonical = `${pad2(day)}/${pad2(month)}/${year}`;
  return { ok: true, value: canonical, day, month, year };
}

function daysInMonth(month: number, year: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// {{2}} — Rótulo sanitizado

export const LABEL_FALLBACK = "Conta cadastrada";

export type LabelSanitizationResult = {
  value: string;
  usedFallback: boolean;
  reason:
    | "ok"
    | "not_string"
    | "empty"
    | "too_long"
    | "control_chars"
    | "multi_line"
    | "html"
    | "url"
    | "phone"
    | "cpf"
    | "cnpj"
    | "pix_key"
    | "boleto_line"
    | "card_number"
    | "monetary_value";
};

// Padrões de conteúdo sensível — aplicados sobre a string já normalizada.
const HTML_PATTERN = /<[^>]*>|&#?\w+;/;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)|\b[a-z0-9.-]+\.(?:com|br|net|org|io|co|app|dev|shop|xyz)\b/i;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const CNPJ_PATTERN = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const BOLETO_LINE_PATTERN = /\b\d{5}[.\s]?\d{5}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d[.\s]?\d{14}\b|\b\d{44,48}\b/;
const CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/;
const PHONE_PATTERN = /(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}\b/;
const MONETARY_PATTERN = /(?:R\$\s?\d)|(?:\b\d{1,3}(?:\.\d{3})+,\d{2}\b)|(?:\b\d+,\d{2}\s?(?:reais|BRL)\b)/i;
const PIX_EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
// Pix chave aleatória: UUID v4-like
const PIX_RANDOM = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

export function sanitizeLabelPlaceholder(input: unknown): LabelSanitizationResult {
  if (typeof input !== "string") return fallback("not_string");
  const trimmed = input.trim();
  if (trimmed.length === 0) return fallback("empty");
  if (/\r|\n/.test(trimmed)) return fallback("multi_line");
  if (CONTROL_CHARS.test(trimmed)) return fallback("control_chars");
  if (trimmed.length > 40) return fallback("too_long");
  if (HTML_PATTERN.test(trimmed)) return fallback("html");
  if (URL_PATTERN.test(trimmed)) return fallback("url");
  if (PIX_EMAIL.test(trimmed)) return fallback("pix_key");
  if (PIX_RANDOM.test(trimmed)) return fallback("pix_key");
  if (CNPJ_PATTERN.test(trimmed)) return fallback("cnpj");
  if (CPF_PATTERN.test(trimmed)) return fallback("cpf");
  if (BOLETO_LINE_PATTERN.test(trimmed)) return fallback("boleto_line");
  if (PHONE_PATTERN.test(trimmed)) return fallback("phone");
  if (CARD_PATTERN.test(trimmed)) return fallback("card_number");
  if (MONETARY_PATTERN.test(trimmed)) return fallback("monetary_value");
  return { value: trimmed, usedFallback: false, reason: "ok" };
}

function fallback(reason: LabelSanitizationResult["reason"]): LabelSanitizationResult {
  return { value: LABEL_FALLBACK, usedFallback: true, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação combinada dos placeholders {{1}} e {{2}} conforme schema local.

export type PlaceholderSchema = Readonly<{
  1: { type: "date"; format: "dd/mm/yyyy"; required: true };
  2: { type: "label"; min: number; max: number; required: true; sanitize: true };
}>;

export type PlaceholderInput = {
  1?: unknown;
  2?: unknown;
};

export type PlaceholderResolveResult =
  | {
      ok: true;
      values: { 1: string; 2: string };
      labelFallbackUsed: boolean;
      labelReason: LabelSanitizationResult["reason"];
    }
  | { ok: false; reason: "invalid_date" | "invalid_input"; detail?: string };

export function resolveAndSanitizePlaceholders(input: PlaceholderInput): PlaceholderResolveResult {
  if (!input || typeof input !== "object") return { ok: false, reason: "invalid_input" };
  const date = validateDatePlaceholder(input[1]);
  if (!date.ok) return { ok: false, reason: "invalid_date", detail: date.reason };
  const label = sanitizeLabelPlaceholder(input[2]);
  return {
    ok: true,
    values: { 1: date.value, 2: label.value },
    labelFallbackUsed: label.usedFallback,
    labelReason: label.reason,
  };
}
