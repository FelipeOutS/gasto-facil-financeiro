/**
 * Snapshot financeiro PURO (sem I/O) para o Assistente de Compras.
 * Regras (centavos inteiros; meses = 3 meses COMPLETOS antes de `hoje`, fuso do chamador):
 * - Renda: só receitas operacionais; transferência/resgate/estorno/reembolso não são renda.
 *   Mês "ativo" (qualquer receita ou gasto registrado) sem renda conta como ZERO;
 *   mês sem nenhum registro é "sem histórico" e reduz a confiança (não vira zero silencioso).
 * - Gasto de cartão entra UMA vez como gasto; faturas nunca são somadas.
 *   Conta com "fatura" no nome é ignorada. Conta com nome de cartão/banco de cartão
 *   (sem "fatura") só é ignorada se houver gastos de cartão no período; senão é mantida
 *   (conservador) e gera alerta.
 * - Fixos: max(contas do mês atual — pagas ou não —, média mensal histórica de contas +
 *   gastos fixos não ligados a conta). Nunca soma os dois, nunca some com aluguel já pago.
 * - Contas vencidas não pagas de meses anteriores: dívida em aberto, valor cheio, sem diluir.
 * - Recorrências ativas convertidas para mês: semanal×52/12, quinzenal×26/12, anual/12.
 *   Frequência desconhecida → tratada como mensal (conservador) + alerta.
 * - Parcelas: uma por grupo de parcelamento, só se ainda restam parcelas.
 * - Variáveis: soma dos gastos não fixos/não parcelados/não recorrentes ÷ meses ATIVOS.
 * - Linhas de outro usuário (quando informado) → snapshot inconclusivo (fail-closed).
 * - Guardado, investimentos e limite de cartão nunca entram.
 */
import type { CapacidadeInput, Compromisso } from "./capacidade-compra";
import { ultimosMesesCompletos } from "./capacidade-compra";

type Owned = { user_id?: string | null };
export type ReceitaRow = Owned & { id: string; data: string; valor: number; descricao: string | null; origem: string | null; tipo: string | null };
export type GastoRow = Owned & {
  id: string; data: string; valor: number; gasto_fixo: boolean | null; recorrencia_id: string | null;
  total_parcelas: number | null; parcela_atual: number | null; grupo_parcelamento_id: string | null;
  cartao_id?: string | null;
};
export type RecorrenciaRow = Owned & { id: string; valor: number; status: string; frequencia: string };
export type ContaRow = Owned & { id: string; nome: string; valor: number; status: string; gasto_id: string | null; recorrencia_id: string | null; data_vencimento: string };
export type CartaoRow = Owned & { id: string; nome: string; banco: string | null };
export type FinanceRows = { receitas: ReceitaRow[]; gastos: GastoRow[]; recorrencias: RecorrenciaRow[]; contas: ContaRow[]; cartoes?: CartaoRow[] };
export type FinanceSnapshot = Omit<CapacidadeInput, "precoCents">;

const NAO_RENDA = /transfer|resgate|estorno|reembolso|devolu|entre contas/i;
const cents = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0);
const ym = (d: string) => d.slice(0, 7);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Fator mensal em frações exatas (numerador/denominador) para centavos consistentes. */
const FREQ: Record<string, [number, number]> = {
  mensal: [1, 1], semanal: [52, 12], quinzenal: [26, 12], bimestral: [1, 2],
  trimestral: [1, 3], semestral: [1, 6], anual: [1, 12],
};

export function buildFinanceSnapshot(hoje: string, rows: FinanceRows, opts: { userId?: string } = {}): FinanceSnapshot {
  const meses = ultimosMesesCompletos(hoje);
  const set = new Set(meses);
  const mesAtual = hoje.slice(0, 7);
  const alertas: string[] = [];

  if (opts.userId) {
    const all: Owned[] = [...rows.receitas, ...rows.gastos, ...rows.recorrencias, ...rows.contas, ...(rows.cartoes ?? [])];
    if (all.some((r) => r.user_id != null && r.user_id !== opts.userId)) {
      return { hoje, rendaPorMes: {}, compromissos: [], mesesAtivos: [], alertas: [], inconclusivo: true };
    }
  }

  // Meses ativos: houve qualquer registro (receita ou gasto) naquele mês completo.
  const ativos = new Set<string>();
  for (const r of rows.receitas) if (set.has(ym(r.data))) ativos.add(ym(r.data));
  for (const g of rows.gastos) if (set.has(ym(g.data))) ativos.add(ym(g.data));
  const mesesAtivos = meses.filter((m) => ativos.has(m));

  const rendaPorMes: Record<string, number> = {};
  for (const m of mesesAtivos) rendaPorMes[m] = 0;
  for (const r of rows.receitas) {
    if (!set.has(ym(r.data))) continue;
    if (NAO_RENDA.test(`${r.descricao ?? ""} ${r.origem ?? ""} ${r.tipo ?? ""}`)) continue;
    rendaPorMes[ym(r.data)] += cents(r.valor);
  }

  const compromissos: Compromisso[] = [];
  const recAtivas = rows.recorrencias.filter((r) => r.status === "ativa");
  const recIds = new Set(recAtivas.map((r) => r.id));
  for (const r of recAtivas) {
    let f = FREQ[norm(r.frequencia)];
    if (!f) { f = [1, 1]; alertas.push("Uma assinatura tem frequência fora do padrão; contei como mensal."); }
    compromissos.push({ id: `rec:${r.id}`, tipo: "assinatura", valorMensalCents: Math.ceil((cents(r.valor) * f[0]) / f[1]) });
  }

  // Faturas: palavra explícita, ou nome de cartão/banco do cartão.
  const temGastoCartao = rows.gastos.some((g) => !!g.cartao_id);
  const nomesCartao = new Set<string>();
  for (const c of rows.cartoes ?? []) { if (c.nome) nomesCartao.add(norm(c.nome)); if (c.banco) nomesCartao.add(norm(c.banco)); }
  const tipoConta = (c: ContaRow): "fatura" | "talvez_fatura" | "normal" => {
    const n = norm(c.nome);
    if (/fatura/.test(n)) return "fatura";
    if (/cartao|credit card/.test(n) || [...nomesCartao].some((k) => k.length >= 3 && (n === k || n.includes(k)))) return "talvez_fatura";
    return "normal";
  };
  const contaConta = (c: ContaRow): boolean => {
    if (c.recorrencia_id && recIds.has(c.recorrencia_id)) return false;
    const t = tipoConta(c);
    if (t === "fatura") return false;
    if (t === "talvez_fatura") {
      if (temGastoCartao) { alertas.push(`Considerei "${c.nome}" como fatura de cartão (os gastos do cartão já foram contados).`); return false; }
      alertas.push(`"${c.nome}" parece fatura de cartão, mas não achei gastos de cartão; mantive como conta.`);
    }
    return true;
  };

  const contaGastoIds = new Set(rows.contas.map((c) => c.gasto_id).filter((x): x is string => !!x));
  let fixoAtual = 0;
  const fixoHist: Record<string, number> = {};
  for (const c of rows.contas) {
    if (!contaConta(c)) continue;
    const m = ym(c.data_vencimento);
    const v = cents(c.valor);
    if (m === mesAtual) fixoAtual += v;
    if (set.has(m)) fixoHist[m] = (fixoHist[m] ?? 0) + v;
    if (m < mesAtual && c.status !== "pago" && v > 0) {
      compromissos.push({ id: `vencida:${c.id}`, tipo: "divida", valorMensalCents: v });
    }
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
    if (g.recorrencia_id && recIds.has(g.recorrencia_id)) continue;
    if (!set.has(ym(g.data))) continue;
    if (g.gasto_fixo) {
      if (!contaGastoIds.has(g.id)) fixoHist[ym(g.data)] = (fixoHist[ym(g.data)] ?? 0) + cents(g.valor);
      continue;
    }
    variavel += cents(g.valor);
  }

  const div = Math.max(mesesAtivos.length, 1);
  const fixoMedio = Math.floor(Object.values(fixoHist).reduce((s, v) => s + v, 0) / div);
  if (fixoAtual > 0) compromissos.push({ id: "fixas:mes-atual", tipo: "fixa", valorMensalCents: fixoAtual });
  if (fixoMedio > fixoAtual) compromissos.push({ id: "fixas:historico-extra", tipo: "fixa", valorMensalCents: fixoMedio - fixoAtual });

  for (const [k, g] of grupos) {
    if ((g.parcela_atual ?? 0) < (g.total_parcelas ?? 0) || ym(g.data) >= mesAtual)
      compromissos.push({ id: `parc:${k}`, tipo: "parcela", valorMensalCents: cents(g.valor) });
  }
  if (variavel > 0) compromissos.push({ id: "variaveis", tipo: "fixa", valorMensalCents: Math.floor(variavel / div) });
  return { hoje, rendaPorMes, compromissos, mesesAtivos, alertas: [...new Set(alertas)], inconclusivo: false };
}
