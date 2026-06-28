/**
 * WA-C10.a — Parser puro de boletos por código de barras / linha digitável.
 *
 * Escopo desta etapa:
 *  - Linha digitável de cobrança (47 dígitos) e código de barras (44 dígitos).
 *  - Linha digitável de arrecadação (48 dígitos) e barcode arrecadação
 *    (44 dígitos iniciando em "8") — detecta e valida DV, mas NÃO extrai
 *    valor/vencimento (o handler pergunta ao usuário).
 *
 * Garantias:
 *  - Sem I/O. Sem log de dados brutos.
 *  - Sempre valida dígitos verificadores antes de classificar como boleto.
 *  - Nunca inventa valor, vencimento ou beneficiário.
 *  - `fingerprint` derivado por HMAC-like (SHA-256 com pepper) para usar
 *    em deduplicação e logs SEM expor a sequência original.
 *
 * Sequências de tamanho diferente de 44/47/48 NÃO são tratadas como boleto:
 * isso é o que mantém CPF (11), CNPJ (14), telefone (10-13), cartão (13-19)
 * e códigos arbitrários fora do detector.
 */
import { createHash } from "crypto";

export type BoletoTipo = "cobranca" | "arrecadacao";

export type BoletoParsed = {
  tipo: BoletoTipo;
  /** 44 dígitos do código de barras (normalizado). NUNCA logar. */
  codigoBarras: string;
  /** Sequência original normalizada (sem formatação). NUNCA logar. */
  linhaDigitavel: string;
  /** Valor em centavos quando tecnicamente extraível e > 0; senão null. */
  valorCentavos: number | null;
  /** Data de vencimento ISO local (YYYY-MM-DD) quando extraível; senão null. */
  vencimentoISO: string | null;
  /** Código do banco (3 dígitos) — apenas para cobrança. */
  banco?: string;
  /** Hash determinístico (32 hex) seguro para logs e deduplicação. */
  fingerprint: string;
  /** Mascarado para exibição: "****1234". */
  mascaraExibicao: string;
};

function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D+/g, "");
}

export function mascararCodigo(digits: string): string {
  const tail = digits.slice(-4);
  return `****${tail}`;
}

// ---------- dígitos verificadores ----------

function dvMod10(num: string): number {
  let sum = 0;
  let mult = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * mult;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    mult = mult === 2 ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

function dvMod11Cobranca(barcodeSem5: string): number {
  // Peso 2..9 cíclico, da direita para a esquerda.
  let sum = 0;
  let w = 2;
  for (let i = barcodeSem5.length - 1; i >= 0; i--) {
    sum += Number(barcodeSem5[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  const dv = 11 - r;
  if (dv === 0 || dv === 10 || dv === 11) return 1;
  return dv;
}

function dvMod11Arrecad(num: string): number {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  const dv = 11 - r;
  if (dv === 10 || dv === 11) return 0;
  return dv;
}

// ---------- conversão linha ↔ barcode ----------

function linhaToBarcodeCobranca(linha47: string): string {
  const f1 = linha47.slice(0, 10);
  const f2 = linha47.slice(10, 21);
  const f3 = linha47.slice(21, 32);
  const dv = linha47.slice(32, 33);
  const f5 = linha47.slice(33, 47);
  return (
    f1.slice(0, 4) +
    dv +
    f5 +
    f1.slice(4, 9) +
    f2.slice(0, 10) +
    f3.slice(0, 10)
  );
}

function barcodeToLinhaCobranca(barcode44: string): string {
  const banco = barcode44.slice(0, 3);
  const moeda = barcode44.slice(3, 4);
  const dvGlobal = barcode44.slice(4, 5);
  const venc = barcode44.slice(5, 9);
  const valor = barcode44.slice(9, 19);
  const livre = barcode44.slice(19, 44);
  // Campos 1, 2, 3 com DV mod10
  const f1Base = banco + moeda + livre.slice(0, 5);
  const f1 = f1Base + String(dvMod10(f1Base));
  const f2Base = livre.slice(5, 15);
  const f2 = f2Base + String(dvMod10(f2Base));
  const f3Base = livre.slice(15, 25);
  const f3 = f3Base + String(dvMod10(f3Base));
  const f5 = venc + valor;
  return f1 + f2 + f3 + dvGlobal + f5;
}

// ---------- vencimento (fator) ----------

function fatorToISO(fator: number): string | null {
  if (!Number.isFinite(fator) || fator <= 0) return null;
  // Base Febraban original: 07/10/1997 (fator 1000 corresponde a 03/07/2000).
  // Em 22/02/2025 a Febraban "resetou" o fator para 1000 com nova base.
  // Estratégia: tenta base antiga; se a data resultante for muito antiga
  // (< 2010), assume nova base 22/02/2025 (fator 1000).
  const tryFromBase = (base: Date, baseFator: number): Date => {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + (fator - baseFator));
    return d;
  };
  let dt = tryFromBase(new Date(Date.UTC(1997, 9, 7)), 0);
  if (dt.getUTCFullYear() < 2010) {
    dt = tryFromBase(new Date(Date.UTC(2025, 1, 22)), 1000);
  }
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------- fingerprint ----------

function fingerprintOf(digits: string): string {
  const pepper =
    process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET ||
    process.env.WHATSAPP_DISPATCHER_SECRET ||
    "wa-c10a-boleto-fp";
  return createHash("sha256").update(`${pepper}:${digits}`).digest("hex").slice(0, 32);
}

// ---------- parser principal ----------

/**
 * Tenta interpretar uma sequência (que pode incluir frase) como boleto.
 * Retorna `null` se nada confiável for encontrado. NUNCA inventa dados.
 */
export function tryParseBoleto(input: string): BoletoParsed | null {
  if (!input) return null;
  const digits = onlyDigits(input);
  return parseDigits(digits);
}

function parseDigits(digits: string): BoletoParsed | null {
  if (digits.length === 44) {
    // Pode ser cobrança ou arrecadação (inicia com 8).
    if (digits[0] === "8") return parseArrecadBarcode(digits);
    return parseCobrancaBarcode(digits);
  }
  if (digits.length === 47) return parseCobrancaLinha(digits);
  if (digits.length === 48) return parseArrecadLinha(digits);
  return null;
}

function parseCobrancaBarcode(barcode: string): BoletoParsed | null {
  if (barcode.length !== 44) return null;
  const without = barcode.slice(0, 4) + barcode.slice(5);
  const dvExpected = dvMod11Cobranca(without);
  if (Number(barcode[4]) !== dvExpected) return null;
  return buildCobranca(barcode, barcodeToLinhaCobranca(barcode));
}

function parseCobrancaLinha(linha: string): BoletoParsed | null {
  if (linha.length !== 47) return null;
  const f1 = linha.slice(0, 10);
  const f2 = linha.slice(10, 21);
  const f3 = linha.slice(21, 32);
  if (Number(f1[9]) !== dvMod10(f1.slice(0, 9))) return null;
  if (Number(f2[10]) !== dvMod10(f2.slice(0, 10))) return null;
  if (Number(f3[10]) !== dvMod10(f3.slice(0, 10))) return null;
  const barcode = linhaToBarcodeCobranca(linha);
  const without = barcode.slice(0, 4) + barcode.slice(5);
  const dvExpected = dvMod11Cobranca(without);
  if (Number(barcode[4]) !== dvExpected) return null;
  return buildCobranca(barcode, linha);
}

function buildCobranca(barcode: string, linha: string): BoletoParsed {
  const fator = Number(barcode.slice(5, 9));
  const valorRaw = Number(barcode.slice(9, 19));
  const valorCentavos = Number.isFinite(valorRaw) && valorRaw > 0 ? valorRaw : null;
  const vencimentoISO = fator > 0 ? fatorToISO(fator) : null;
  return {
    tipo: "cobranca",
    codigoBarras: barcode,
    linhaDigitavel: linha,
    valorCentavos,
    vencimentoISO,
    banco: barcode.slice(0, 3),
    fingerprint: fingerprintOf(barcode),
    mascaraExibicao: mascararCodigo(linha),
  };
}

function parseArrecadBarcode(barcode: string): BoletoParsed | null {
  if (barcode.length !== 44 || barcode[0] !== "8") return null;
  const useMod10 = barcode[2] === "6" || barcode[2] === "7";
  const without = barcode.slice(0, 3) + barcode.slice(4);
  const dvExpected = useMod10 ? dvMod10(without) : dvMod11Arrecad(without);
  if (Number(barcode[3]) !== dvExpected) return null;
  return buildArrecad(barcode, barcode);
}

function parseArrecadLinha(linha: string): BoletoParsed | null {
  if (linha.length !== 48) return null;
  // 4 blocos de 12 dígitos; cada um termina em DV mod10 ou mod11
  const blocks = [
    linha.slice(0, 12),
    linha.slice(12, 24),
    linha.slice(24, 36),
    linha.slice(36, 48),
  ];
  const barcode = blocks.map((b) => b.slice(0, 11)).join("");
  if (barcode.length !== 44 || barcode[0] !== "8") return null;
  const useMod10 = barcode[2] === "6" || barcode[2] === "7";
  for (const b of blocks) {
    const expected = useMod10 ? dvMod10(b.slice(0, 11)) : dvMod11Arrecad(b.slice(0, 11));
    if (Number(b[11]) !== expected) return null;
  }
  return buildArrecad(barcode, linha);
}

function buildArrecad(barcode: string, linha: string): BoletoParsed {
  // Arrecadação: valor e vencimento variam por convênio.
  // Política WA-C10.a: NUNCA assumir — handler pergunta ao usuário.
  return {
    tipo: "arrecadacao",
    codigoBarras: barcode,
    linhaDigitavel: linha,
    valorCentavos: null,
    vencimentoISO: null,
    fingerprint: fingerprintOf(barcode),
    mascaraExibicao: mascararCodigo(linha),
  };
}

// ---------- detector tolerante a frase ----------

/**
 * Detecta boleto dentro de um texto livre. Aceita frases como:
 *  - "GI, adiciona esse boleto: <linha>"
 *  - "Registra esse código pra mim <linha>"
 *  - apenas a sequência (com ou sem formatação).
 *
 * Retorna `null` quando não há candidato com DV válido — nada de
 * heurísticas "talvez seja boleto".
 */
export function detectBoletoFromText(text: string): BoletoParsed | null {
  if (!text) return null;
  // 1) tenta o texto inteiro (cobre o caso "envia só os números").
  const whole = tryParseBoleto(text);
  if (whole) return whole;
  // 2) procura runs de dígitos+separadores comuns.
  const candidates = text.match(/[\d][\d\s.\-/\n]{29,}[\d]/g) ?? [];
  for (const c of candidates) {
    const p = tryParseBoleto(c);
    if (p) return p;
  }
  return null;
}

// ---------- helpers para testes ----------

/**
 * Constrói uma linha digitável de COBRANÇA válida para testes.
 * Exposto sob nome `_buildBoletoCobrancaForTest` para deixar claro
 * que NÃO é API de runtime.
 */
export function _buildBoletoCobrancaForTest(opts: {
  banco?: string;
  moeda?: string;
  fator?: number;
  valorCentavos?: number;
  livre?: string;
}): { barcode: string; linha: string } {
  const banco = (opts.banco ?? "341").padStart(3, "0").slice(0, 3);
  const moeda = (opts.moeda ?? "9").slice(0, 1);
  const fator = String(opts.fator ?? 9999).padStart(4, "0").slice(0, 4);
  const valor = String(opts.valorCentavos ?? 12000).padStart(10, "0").slice(0, 10);
  const livre = (opts.livre ?? "1234567890123456789012345").padStart(25, "0").slice(0, 25);
  const without = banco + moeda + fator + valor + livre;
  const dv = String(dvMod11Cobranca(without));
  const barcode = banco + moeda + dv + fator + valor + livre;
  const linha = barcodeToLinhaCobranca(barcode);
  return { barcode, linha };
}

export function _buildBoletoArrecadForTest(opts: {
  segmento?: string;
  identificador?: string; // 8 inicial é fixo
}): { barcode: string; linha: string } {
  const seg = (opts.segmento ?? "1").slice(0, 1); // segmento varia
  // Usa identificador mod11 (dígito 3 != 6/7)
  // barcode = "8" + seg + "9" + dv + (40 dígitos)
  const payload = (opts.identificador ?? "0123456789012345678901234567890123456789").padStart(40, "0").slice(0, 40);
  const without = "8" + seg + "9" + payload;
  const dv = String(dvMod11Arrecad(without));
  const barcode = "8" + seg + "9" + dv + payload;
  // Linha digitável: 4 blocos de 12 (11 + DV mod11 cada)
  const blocks: string[] = [];
  for (let i = 0; i < 4; i++) {
    const b = barcode.slice(i * 11, i * 11 + 11);
    const blockDv = String(dvMod11Arrecad(b));
    blocks.push(b + blockDv);
  }
  return { barcode, linha: blocks.join("") };
}
