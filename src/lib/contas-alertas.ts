import { getContasAPagar, statusContaEfetivo, useStore } from "./store";
import { todayISO } from "./format";

/**
 * Resumo de alertas das contas a pagar — usado pelos indicadores da navegação.
 * - "vermelho": existe pelo menos uma conta atrasada
 * - "laranja":  existe pelo menos uma conta vencendo hoje ou amanhã
 * - "nenhum":   sem alertas ativos
 */
export type AlertaContas = "vermelho" | "laranja" | "nenhum";

export function calcularAlertaContas(hojeISO = todayISO()): AlertaContas {
  const contas = getContasAPagar();
  const hoje = new Date(hojeISO + "T00:00:00").getTime();
  let temAtrasada = false;
  let temUrgente = false;
  for (const c of contas) {
    const s = statusContaEfetivo(c, hojeISO);
    if (s === "pago") continue;
    if (s === "atrasado") {
      temAtrasada = true;
      continue;
    }
    const v = new Date(c.dataVencimento + "T00:00:00").getTime();
    const dias = Math.round((v - hoje) / (1000 * 60 * 60 * 24));
    if (dias === 0 || dias === 1) temUrgente = true;
  }
  if (temAtrasada) return "vermelho";
  if (temUrgente) return "laranja";
  return "nenhum";
}

export function useAlertaContas(): AlertaContas {
  return useStore(() => calcularAlertaContas());
}
