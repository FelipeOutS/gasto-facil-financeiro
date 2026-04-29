// Centralized budget calculation logic.
// Reused by: rota /orcamento, Dashboard (/), NotificationBell.
//
// Regras (alinhadas ao pedido do produto):
//  - Considera apenas DESPESAS confirmadas (gastos.confirmado !== false).
//  - Usa categoriaId do gasto + mes/ano (já materializados pelo store em
//    cadastro/importação). Se um gasto mudar de categoria, o totalizador
//    recalcula automaticamente porque consome o estado vivo do store.
//  - Não considera receitas, transferências internas nem movimentações de
//    Guardado (essas tabelas são separadas e nunca entram em `gastos`).
//  - Threshold por categoria: <70% ok, 70%–99% atenção, >=100% estouro.

import type { Categoria, Gasto } from "./types";

export type StatusOrcamento = "ok" | "atencao" | "estouro" | "sem_limite";

export interface LinhaOrcamento {
  cat: Categoria;
  realizado: number;
  planejado: number;
  status: StatusOrcamento;
  /** Percentual usado (0–999). 0 quando não há limite. */
  pct: number;
  /** Quanto resta (planejado - realizado). Pode ser negativo (estouro). */
  restante: number;
}

export const LIMIAR_ATENCAO = 0.7; // 70%
export const LIMIAR_ESTOURO = 1.0; // 100%

export function statusOrcamento(realizado: number, planejado: number): StatusOrcamento {
  if (planejado <= 0) return "sem_limite";
  const pct = realizado / planejado;
  if (pct >= LIMIAR_ESTOURO) return "estouro";
  if (pct >= LIMIAR_ATENCAO) return "atencao";
  return "ok";
}

/** Soma os gastos confirmados do mês por categoriaId. */
export function realizadoPorCategoria(
  gastos: Gasto[],
  mes: number,
  ano: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of gastos) {
    if (g.confirmado === false) continue;
    if (g.mes !== mes || g.ano !== ano) continue;
    map.set(g.categoriaId, (map.get(g.categoriaId) ?? 0) + (g.valor || 0));
  }
  return map;
}

export function buildLinhasOrcamento(
  categorias: Categoria[],
  gastos: Gasto[],
  mes: number,
  ano: number,
  getLimite: (catId: string) => number | undefined,
): LinhaOrcamento[] {
  const realizado = realizadoPorCategoria(gastos, mes, ano);

  return categorias
    .map<LinhaOrcamento>((c) => {
      const r = realizado.get(c.id) ?? 0;
      const p = getLimite(c.id) ?? 0;
      const pct = p > 0 ? (r / p) * 100 : 0;
      return {
        cat: c,
        realizado: r,
        planejado: p,
        status: statusOrcamento(r, p),
        pct,
        restante: p - r,
      };
    })
    .sort((a, b) => {
      // Com limite primeiro, depois com gasto, depois resto
      const sa = a.planejado > 0 ? 0 : a.realizado > 0 ? 1 : 2;
      const sb = b.planejado > 0 ? 0 : b.realizado > 0 ? 1 : 2;
      if (sa !== sb) return sa - sb;
      // Dentro de cada grupo: maiores % usados primeiro (mais urgentes)
      if (a.planejado > 0 && b.planejado > 0) return b.pct - a.pct;
      return b.realizado - a.realizado;
    });
}

export interface ResumoOrcamento {
  linhas: LinhaOrcamento[];
  comLimite: LinhaOrcamento[];
  semLimiteComGasto: LinhaOrcamento[];
  totalPlanejado: number;
  totalRealizado: number;
  diff: number;
  pctGeral: number;
  qtdOk: number;
  qtdAtencao: number;
  qtdEstouro: number;
  /** Top 3 categorias com maior % de uso (com limite definido). */
  top3: LinhaOrcamento[];
  /** Tem ao menos um limite configurado neste mês. */
  temOrcamento: boolean;
}

export function resumirOrcamento(linhas: LinhaOrcamento[]): ResumoOrcamento {
  const comLimite = linhas.filter((l) => l.planejado > 0);
  const semLimiteComGasto = linhas.filter((l) => l.planejado === 0 && l.realizado > 0);
  const totalPlanejado = comLimite.reduce((s, l) => s + l.planejado, 0);
  const totalRealizado = comLimite.reduce((s, l) => s + l.realizado, 0);
  const pctGeral = totalPlanejado > 0 ? (totalRealizado / totalPlanejado) * 100 : 0;

  return {
    linhas,
    comLimite,
    semLimiteComGasto,
    totalPlanejado,
    totalRealizado,
    diff: totalPlanejado - totalRealizado,
    pctGeral,
    qtdOk: comLimite.filter((l) => l.status === "ok").length,
    qtdAtencao: comLimite.filter((l) => l.status === "atencao").length,
    qtdEstouro: comLimite.filter((l) => l.status === "estouro").length,
    top3: [...comLimite].sort((a, b) => b.pct - a.pct).slice(0, 3),
    temOrcamento: comLimite.length > 0,
  };
}

export interface AlertaOrcamento {
  catId: string;
  nome: string;
  status: "atencao" | "estouro";
  pct: number;
  realizado: number;
  planejado: number;
  excedente: number; // só preenchido em "estouro"
}

export function buildAlertasOrcamento(linhas: LinhaOrcamento[]): AlertaOrcamento[] {
  const alertas: AlertaOrcamento[] = [];
  for (const l of linhas) {
    if (l.status === "estouro") {
      alertas.push({
        catId: l.cat.id,
        nome: l.cat.nome,
        status: "estouro",
        pct: l.pct,
        realizado: l.realizado,
        planejado: l.planejado,
        excedente: l.realizado - l.planejado,
      });
    } else if (l.status === "atencao") {
      alertas.push({
        catId: l.cat.id,
        nome: l.cat.nome,
        status: "atencao",
        pct: l.pct,
        realizado: l.realizado,
        planejado: l.planejado,
        excedente: 0,
      });
    }
  }
  // Estouros primeiro, depois maior % usado
  return alertas.sort((a, b) => {
    if (a.status !== b.status) return a.status === "estouro" ? -1 : 1;
    return b.pct - a.pct;
  });
}

export function textoAlertaOrcamento(a: AlertaOrcamento): string {
  if (a.status === "estouro") {
    const fmt = a.excedente.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    return `Você ultrapassou o orçamento de ${a.nome} em ${fmt}.`;
  }
  return `Você já usou ${Math.round(a.pct)}% do orçamento de ${a.nome}.`;
}
