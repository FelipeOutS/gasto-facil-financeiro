/**
 * Snapshot financeiro PURO (sem I/O) para o Assistente de Compras.
 * Regras anti-dupla-contagem:
 * - Gasto de cartão entra UMA vez como gasto; faturas nunca são somadas.
 * - Contas a pagar com nome de fatura são ignoradas (já estão nos gastos do cartão).
 * - Contas ligadas a gasto (gasto_id) ou a recorrência já listada não duplicam.
 * - Parcelas: uma por grupo de parcelamento, só se ainda restam parcelas.
 * - Variáveis: média mensal dos gastos não fixos/não parcelados/não recorrentes
 *   dos MESMOS 3 meses completos.
 * - Receitas de transferência/resgate/estorno/reembolso não são renda.
 * - Guardado e limite de cartão nunca entram.
 */
import type { CapacidadeInput, Compromisso } from "./capacidade-compra";
import { ultimosMesesCompletos } from "./capacidade-compra";

export type ReceitaRow = { id: string; data: string; valor: number; descricao: string | null; origem: string | null; tipo: string | null };
export type GastoRow = {
  id: string; data: string; valor: number; gasto_fixo: boolean | null; recorrencia_id: string | null;
  total_parcelas: number | null; parcela_atual: number | null; grupo_parcelamento_id: string | null;
};
export type RecorrenciaRow = { id: string; valor: number; status: string; frequencia: string };
export type ContaRow = { id: string; nome: string; valor: number; status: string; gasto_id: string | null; recorrencia_id: string | null; data_vencimento: string };
export type FinanceRows = { receitas: ReceitaRow[]; gastos: GastoRow[]; recorrencias: RecorrenciaRow[]; contas: ContaRow[] };

const NAO_RENDA = /transfer|resgate|estorno|reembolso|devolu|entre contas/i;
const cents = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0);
const ym = (d: string) => d.slice(0, 7);

export function buildFinanceSnapshot(hoje: string, rows: FinanceRows): Omit<CapacidadeInput, "precoCents"> {
  const meses = ultimosMesesCompletos(hoje);
  const set = new Set(meses);
  const rendaPorMes: Record<string, number> = {};
  for (const r of rows.receitas) {
    if (!set.has(ym(r.data))) continue;
    if (NAO_RENDA.test(`${r.descricao ?? ""} ${r.origem ?? ""} ${r.tipo ?? ""}`)) continue;
    rendaPorMes[ym(r.data)] = (rendaPorMes[ym(r.data)] ?? 0) + cents(r.valor);
  }
  const compromissos: Compromisso[] = [];
  const recAtivas = rows.recorrencias.filter((r) => r.status === "ativa" && r.frequencia === "mensal");
  const recIds = new Set(recAtivas.map((r) => r.id));
  for (const r of recAtivas) compromissos.push({ id: `rec:${r.id}`, tipo: "assinatura", valorMensalCents: cents(r.valor) });
  const mesAtual = hoje.slice(0, 7);
  for (const c of rows.contas) {
    if (c.status === "pago" || ym(c.data_vencimento) !== mesAtual) continue;
    if (c.gasto_id || (c.recorrencia_id && recIds.has(c.recorrencia_id)) || /fatura/i.test(c.nome)) continue;
    compromissos.push({ id: `conta:${c.id}`, tipo: "fixa", valorMensalCents: cents(c.valor) });
  }
  const grupos = new Map<string, GastoRow>();
  let variavel = 0;
  for (const g of rows.gastos) {
    const parcelado = (g.total_parcelas ?? 1) > 1;
    if (parcelado) {
      const k = g.grupo_parcelamento_id ?? g.id;
      const prev = grupos.get(k);
      if (!prev || (g.parcela_atual ?? 0) > (prev.parcela_atual ?? 0)) grupos.set(k, g);
      continue;
    }
    if (g.gasto_fixo || (g.recorrencia_id && recIds.has(g.recorrencia_id)) || !set.has(ym(g.data))) continue;
    variavel += cents(g.valor);
  }
  for (const [k, g] of grupos) {
    if ((g.parcela_atual ?? 0) < (g.total_parcelas ?? 0) || ym(g.data) >= mesAtual)
      compromissos.push({ id: `parc:${k}`, tipo: "parcela", valorMensalCents: cents(g.valor) });
  }
  const mesesComRenda = meses.filter((m) => (rendaPorMes[m] ?? 0) > 0).length || 1;
  if (variavel > 0) compromissos.push({ id: "variaveis", tipo: "fixa", valorMensalCents: Math.floor(variavel / mesesComRenda) });
  return { hoje, rendaPorMes, compromissos };
}
