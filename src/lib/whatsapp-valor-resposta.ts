/**
 * Parser estrito de valor para RESPOSTAS curtas do WhatsApp
 * (comprovante aguardando valor/ajuste e boleto aguardando valor).
 *
 * Reutiliza o parser central `parseValor` (src/lib/whatsappParser.ts) e
 * acrescenta guardas de contexto: exige exatamente UM token numérico
 * (rejeita datas "10/11", linha digitável com separadores, "2 de 1.950")
 * e rejeita sinal negativo. Retorna REAIS (não centavos).
 */
import { parseValor } from "./whatsappParser";

export function parseValorRespostaReais(text: string): number | null {
  if (typeof text !== "string") return null;
  const tokens = text.match(/\d[\d.,]*/g);
  if (!tokens || tokens.length !== 1) return null;
  if (/-\s*(?:r\$\s*)?\d/i.test(text)) return null;
  return parseValor(text);
}

/** Conversão única e exata reais → centavos. */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

export function parseValorRespostaCentavos(text: string): number | null {
  const v = parseValorRespostaReais(text);
  return v === null ? null : reaisParaCentavos(v);
}
