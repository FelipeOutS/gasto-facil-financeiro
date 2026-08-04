/**
 * WA-C1 — Helper compartilhado de VENCIMENTOS / CONTAS A PAGAR.
 * Apenas leitura. Fonte canônica: tabela `contas_a_pagar`, que possui
 * `data_vencimento`, `status` ('pendente' | 'pago') e `data_pagamento`.
 *
 * Esta camada é financeira; nunca toca em sessão, mensagem, log com
 * dado pessoal ou cria/edita registros. Toda query é restrita por
 * `user_id`.
 *
 * Distinções obrigatórias (definidas no plano WA-C1):
 *   - Conta a vencer   = `status = 'pendente'` AND data_vencimento >= hoje.
 *   - Conta atrasada   = `status = 'pendente'` AND data_vencimento < hoje
 *                        (afirmação SÓ pode ser feita porque o schema
 *                        possui status confiável de pagamento).
 *   - Conta paga       = `status = 'pago'` — NUNCA aparece como pendente.
 *   - Fatura de cartão = competência das fases WA-F1..F5 (não cruza).
 *   - Gasto comum      = tabela `gastos`, sem vencimento — NUNCA é
 *                        tratado como conta a pagar aqui.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nowInAppTz } from "./cartao-fatura.server";

export type ContaVencimentoRow = {
  id: string;
  nome: string;
  valor: number;
  dataVencimento: string; // YYYY-MM-DD
  status: "pendente" | "pago";
  dataPagamento: string | null;
  categoriaId: string | null;
  recorrente: boolean;
  frequenciaRecorrencia: string | null;
};

/** YYYY-MM-DD na timezone do app (America/Sao_Paulo). */
export function todayISOInAppTz(hoje: Date = nowInAppTz()): string {
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const d = String(hoje.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD do dia seguinte (local). */
export function tomorrowISOInAppTz(hoje: Date = nowInAppTz()): string {
  const t = new Date(hoje);
  t.setDate(t.getDate() + 1);
  return todayISOInAppTz(t);
}

/**
 * Intervalo [hoje, próximo domingo] em ISO local — "esta semana".
 * Se hoje já for domingo, devolve só o próprio dia.
 */
export function weekRangeInAppTz(hoje: Date = nowInAppTz()): {
  startISO: string;
  endISO: string;
} {
  const start = todayISOInAppTz(hoje);
  const end = new Date(hoje);
  // getDay(): 0=domingo .. 6=sábado.
  const daysToSunday = (7 - hoje.getDay()) % 7;
  end.setDate(end.getDate() + daysToSunday);
  return { startISO: start, endISO: todayISOInAppTz(end) };
}

/**
 * Intervalo [primeiro, último] dia do mês informado (YYYY-MM) — ou do
 * mês corrente quando `ym` é nulo.
 */
export function monthRangeInAppTz(
  ym: string | null = null,
  hoje: Date = nowInAppTz(),
): { startISO: string; endISO: string; yearMonth: string } {
  let y = hoje.getFullYear();
  let m = hoje.getMonth() + 1;
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const [yy, mm] = ym.split("-").map((s) => Number(s));
    y = yy;
    m = mm;
  }
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { startISO: start, endISO: end, yearMonth: `${y}-${String(m).padStart(2, "0")}` };
}

function rowToConta(r: Record<string, unknown>): ContaVencimentoRow {
  return {
    id: String(r.id ?? ""),
    nome: String(r.nome ?? ""),
    valor: Number(r.valor ?? 0) || 0,
    dataVencimento: String(r.data_vencimento ?? ""),
    status: String(r.status ?? "pendente") === "pago" ? "pago" : "pendente",
    dataPagamento: (r.data_pagamento as string | null) ?? null,
    categoriaId: (r.categoria_id as string | null) ?? null,
    recorrente: Boolean(r.recorrente ?? false),
    frequenciaRecorrencia: (r.frequencia_recorrencia as string | null) ?? null,
  };
}

/**
 * Compromissos PENDENTES com vencimento em [startISO, endISO] (inclusive).
 * Ordenados por (data_vencimento ASC, nome ASC). Apenas `status='pendente'`.
 */
export async function getVencimentosPorPeriodo(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<ContaVencimentoRow[]> {
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .select(
      "id,nome,valor,data_vencimento,status,data_pagamento,categoria_id,recorrente,frequencia_recorrencia",
    )
    .eq("user_id", userId)
    .eq("status", "pendente")
    .gte("data_vencimento", startISO)
    .lte("data_vencimento", endISO);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map(rowToConta)
    .sort((a, b) =>
      a.dataVencimento === b.dataVencimento
        ? a.nome.localeCompare(b.nome, "pt-BR")
        : a.dataVencimento.localeCompare(b.dataVencimento),
    );
}

/**
 * Compromissos PENDENTES com vencimento anterior a `referenceISO`.
 * Pode ser apresentado como "atrasado" no WhatsApp justamente porque
 * a tabela tem status confiável (`pendente` significa não pago).
 */
export async function getVencimentosComStatusAnterior(
  userId: string,
  referenceISO: string,
): Promise<ContaVencimentoRow[]> {
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .select(
      "id,nome,valor,data_vencimento,status,data_pagamento,categoria_id,recorrente,frequencia_recorrencia",
    )
    .eq("user_id", userId)
    .eq("status", "pendente")
    .lt("data_vencimento", referenceISO);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map(rowToConta)
    .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
}

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca contas PENDENTES cujo `nome` casa com `term` (normalizado para
 * acentos/caixa).
 *
 * WA-C3.2 — prioridade de casamento:
 *   1) match EXATO do nome normalizado;
 *   2) match por expressão COMPLETA (substring com fronteira de palavra);
 *   3) match parcial (substring qualquer).
 *
 * Sempre que um nível superior tem resultados, devolve só ele. Isso
 * evita escolher automaticamente uma conta só porque contém uma palavra
 * curta ("luz", "água", "plano"). Limita às 12 mais próximas, ordenadas
 * pela próxima data de vencimento.
 */
export async function findVencimentoByTerm(
  userId: string,
  term: string,
): Promise<ContaVencimentoRow[]> {
  const t = norm(term);
  if (!t) return [];
  const { data, error } = await supabaseAdmin
    .from("contas_a_pagar")
    .select(
      "id,nome,valor,data_vencimento,status,data_pagamento,categoria_id,recorrente,frequencia_recorrencia",
    )
    .eq("user_id", userId)
    .eq("status", "pendente");
  if (error || !Array.isArray(data)) return [];
  const rows = (data as Record<string, unknown>[]).map(rowToConta);
  const byDate = (a: ContaVencimentoRow, b: ContaVencimentoRow) =>
    a.dataVencimento.localeCompare(b.dataVencimento);
  const exact = rows.filter((r) => norm(r.nome) === t);
  if (exact.length > 0) return exact.sort(byDate).slice(0, 12);
  const wholeWord = rows.filter((r) => {
    const n = ` ${norm(r.nome)} `;
    return n.includes(` ${t} `);
  });
  if (wholeWord.length > 0) return wholeWord.sort(byDate).slice(0, 12);
  const partial = rows.filter((r) => norm(r.nome).includes(t));
  return partial.sort(byDate).slice(0, 12);
}

/** Lista de "nomes distintos" presentes no resultado da busca. */
export function distinctNamesFrom(rows: ContaVencimentoRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(r.nome);
  return Array.from(set);
}
