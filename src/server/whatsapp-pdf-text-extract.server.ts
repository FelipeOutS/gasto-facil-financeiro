/**
 * WA-C10.b.1 — Extração textual leve de PDF para encontrar candidatos
 * de boleto SEM chamar IA/OCR.
 *
 * Estratégia (pura JS, compatível com Cloudflare Workers):
 *  - Trata os bytes do PDF como latin1 e procura sequências de dígitos
 *    de 44 a 48 caracteres (com tolerância a separadores comuns).
 *  - Funciona para PDFs textuais cujos content streams não estão comprimidos,
 *    OU cujo `/T` (form fields), `/Contents` ou metadados expõem a linha
 *    digitável em claro.
 *  - PDFs 100% escaneados ou com streams totalmente comprimidos retornam
 *    `null` → caller cai no pipeline OCR normal.
 *
 * Princípios:
 *  - NUNCA persiste texto bruto.
 *  - NUNCA loga conteúdo.
 *  - Limita o escopo de análise (até 2 MB) para não travar Workers.
 *  - Falha silenciosa em qualquer exceção.
 */

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * Retorna candidatos numéricos plausíveis encontrados no PDF.
 * Cada candidato é uma string com apenas dígitos (44/47/48).
 * A validação por DV é responsabilidade do caller (`tryParseBoleto`).
 */
export function extractBoletoCandidatesFromPdf(buf: Uint8Array): string[] {
  if (!buf || buf.byteLength === 0) return [];
  try {
    const slice = buf.subarray(0, Math.min(buf.length, MAX_SCAN_BYTES));
    // Decode bytes as latin1 (preserva 0x00-0xFF 1:1, sem perda).
    let s = "";
    const CHUNK = 64 * 1024;
    for (let i = 0; i < slice.length; i += CHUNK) {
      s += String.fromCharCode(...slice.subarray(i, Math.min(i + CHUNK, slice.length)));
    }
    // Localiza qualquer sequência com 44-54 dígitos OU dígitos separados
    // por espaços/pontos comuns em linha digitável (até 60 chars).
    // Depois normaliza removendo separadores e filtra por 44/47/48.
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /[0-9](?:[ .]?[0-9]){43,60}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const digits = m[0].replace(/[^0-9]/g, "");
      if (digits.length !== 44 && digits.length !== 47 && digits.length !== 48) continue;
      if (seen.has(digits)) continue;
      seen.add(digits);
      out.push(digits);
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}
