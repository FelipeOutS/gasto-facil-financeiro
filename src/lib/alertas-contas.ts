/**
 * Lógica centralizada de alertas/vencimentos para Contas a pagar.
 *
 * Reutilizada por:
 *  - aba Contas a pagar (badges, cards, mensagens)
 *  - Dashboard (bloco de alertas)
 *  - Sininho de notificações
 *
 * Datas são tratadas em horário local para evitar erros de UTC/fuso.
 * Uma conta é considerada "paga" se status === "pago" OU se tiver dataPagamento.
 */
import type { ContaAPagar } from "@/lib/types";

export type SeveridadeAlerta = "atrasada" | "hoje" | "amanha" | "em7";

export type AlertaConta = {
  id: string;
  conta: ContaAPagar;
  severidade: SeveridadeAlerta;
  /** Dias entre hoje e o vencimento (negativo = atrasada). */
  dias: number;
};

export type ResumoAlertas = {
  atrasadas: AlertaConta[];
  hoje: AlertaConta[];
  amanha: AlertaConta[];
  proximos7: AlertaConta[]; // dia 2..7 (não inclui hoje/amanha)
  /** Lista única ordenada por severidade — usada pelo sininho. */
  todos: AlertaConta[];
  /** Total que importa para o contador do sininho (atrasadas+hoje+amanha+próximos 7). */
  totalRelevantes: number;
};

/** YYYY-MM-DD do "hoje" no fuso local. */
export function todayLocalISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Diferença em dias inteiros entre duas datas YYYY-MM-DD em horário local. */
export function diasEntre(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/** Considera uma conta paga se já há status "pago" ou dataPagamento preenchida. */
export function contaEstaPaga(c: ContaAPagar): boolean {
  return c.status === "pago" || !!c.dataPagamento;
}

/** Calcula a severidade de uma conta NÃO paga; retorna null se não for alerta. */
function calcularSeveridade(dias: number): SeveridadeAlerta | null {
  if (dias < 0) return "atrasada";
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanha";
  if (dias <= 7) return "em7";
  return null;
}

const ORDEM: Record<SeveridadeAlerta, number> = {
  atrasada: 0,
  hoje: 1,
  amanha: 2,
  em7: 3,
};

/** Constrói o resumo de alertas a partir da lista bruta de contas. */
export function buildResumoAlertas(
  contas: ContaAPagar[],
  hojeISO: string = todayLocalISO(),
): ResumoAlertas {
  const atrasadas: AlertaConta[] = [];
  const hoje: AlertaConta[] = [];
  const amanha: AlertaConta[] = [];
  const proximos7: AlertaConta[] = [];

  for (const c of contas) {
    if (contaEstaPaga(c)) continue;
    const dias = diasEntre(hojeISO, c.dataVencimento);
    const sev = calcularSeveridade(dias);
    if (!sev) continue;
    const alerta: AlertaConta = { id: c.id, conta: c, severidade: sev, dias };
    if (sev === "atrasada") atrasadas.push(alerta);
    else if (sev === "hoje") hoje.push(alerta);
    else if (sev === "amanha") amanha.push(alerta);
    else proximos7.push(alerta);
  }

  const todos = [...atrasadas, ...hoje, ...amanha, ...proximos7];
  todos.sort((a, b) => {
    const s = ORDEM[a.severidade] - ORDEM[b.severidade];
    if (s !== 0) return s;
    return a.conta.dataVencimento.localeCompare(b.conta.dataVencimento);
  });

  return {
    atrasadas,
    hoje,
    amanha,
    proximos7,
    todos,
    totalRelevantes: todos.length,
  };
}

/** Texto curto para mostrar no sininho/Dashboard. */
export function textoSeveridade(sev: SeveridadeAlerta, dias: number): string {
  switch (sev) {
    case "atrasada":
      return `Atrasada ${Math.abs(dias)}d`;
    case "hoje":
      return "Vence hoje";
    case "amanha":
      return "Vence amanhã";
    case "em7":
      return `Vence em ${dias}d`;
  }
}
