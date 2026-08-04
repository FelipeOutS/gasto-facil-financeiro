// Motor simples de insights/dicas financeiras por regra.
// Sem IA, sem persistência, sem dedupe global — apenas avaliação síncrona
// sobre dados que o app já possui (gastos do mês, mês anterior, receitas,
// recorrências mensais e linhas de orçamento da tela /orcamento).
//
// Importante: dicas NÃO são alertas. Tom educativo, leve, sem urgência.

import type { Categoria, Gasto, Receita } from "@/lib/types";
import type { Recorrencia } from "@/lib/recorrencias";
import type { LinhaOrcamento } from "@/lib/orcamento";
import { formatBRL } from "@/lib/format";

export type InsightCategory =
  | "economia"
  | "orcamento"
  | "recorrencias"
  | "cartoes"
  | "metas"
  | "geral";

export type InsightPriority = "baixa" | "media" | "alta";

export type FinancialInsight = {
  id: string;
  type: string;
  title: string;
  description: string;
  category: InsightCategory;
  priority: InsightPriority;
  actionLabel?: string;
  actionHref?: string;
};

export type InsightInput = {
  gastosDoMes: Gasto[];
  gastosMesAnterior: Gasto[];
  receitasDoMes: Receita[];
  recorrencias: Recorrencia[];
  linhasOrcamento: LinhaOrcamento[];
  categorias: Categoria[];
  /** Indica se o app tem rotas de metas/guardado para sugerir como ação. */
  hasMetas?: boolean;
  hasGuardado?: boolean;
};

const PRIORITY_RANK: Record<InsightPriority, number> = {
  alta: 0,
  media: 1,
  baixa: 2,
};

const MAX_INSIGHTS = 5;

function sumValor<T extends { valor: number }>(items: T[]): number {
  return items.reduce((s, x) => s + (x.valor || 0), 0);
}

function recorrenciaMensalEstimada(r: Recorrencia): number {
  const base = (r.ultimoValor ?? r.valor) || 0;
  switch (r.frequencia) {
    case "semanal":
      return base * 4;
    case "quinzenal":
      return base * 2;
    case "anual":
      return base / 12;
    case "mensal":
    case "personalizada":
    default:
      return base;
  }
}

// ---------------- Regras ----------------

function ruleCategoriaDominante(input: InsightInput): FinancialInsight | null {
  const { gastosDoMes, categorias } = input;
  const total = sumValor(gastosDoMes);
  if (total < 200 || gastosDoMes.length < 5) return null;

  const porCat = new Map<string, number>();
  for (const g of gastosDoMes) {
    porCat.set(g.categoriaId, (porCat.get(g.categoriaId) ?? 0) + (g.valor || 0));
  }
  let topId = "";
  let topVal = 0;
  for (const [id, v] of porCat) {
    if (v > topVal) {
      topVal = v;
      topId = id;
    }
  }
  if (!topId || topVal < 100) return null;
  const share = topVal / total;
  if (share < 0.3) return null;

  const cat = categorias.find((c) => c.id === topId);
  const nome = cat?.nome ?? "essa categoria";
  return {
    id: `categoria_dominante:${topId}`,
    type: "categoria_dominante",
    title: "Essa categoria está pesando no mês",
    description: `Revise seus gastos em ${nome} (${Math.round(share * 100)}% do mês). Pequenos cortes aqui podem melhorar seu saldo.`,
    category: "economia",
    priority: share >= 0.5 ? "alta" : "media",
    actionLabel: "Ver gastos",
    actionHref: "/gastos",
  };
}

function ruleRecorrenciasAcumuladas(input: InsightInput): FinancialInsight | null {
  const { recorrencias, receitasDoMes } = input;
  const ativas = recorrencias.filter((r) => r.status === "ativa" || r.status === "suspeita");
  if (ativas.length < 2) return null;

  const totalMensal = ativas.reduce((s, r) => s + recorrenciaMensalEstimada(r), 0);
  if (totalMensal < 80) return null;

  const renda = sumValor(receitasDoMes);
  const share = renda > 0 ? totalMensal / renda : 0;
  if (totalMensal < 80 && share < 0.1) return null;

  const priority: InsightPriority = share >= 0.2 ? "alta" : share >= 0.1 ? "media" : "baixa";

  return {
    id: "recorrencias_acumuladas",
    type: "recorrencias_acumuladas",
    title: "Suas assinaturas merecem uma revisão",
    description: `Você tem ${formatBRL(totalMensal)} por mês em cobranças recorrentes. Vale revisar o que ainda faz sentido manter.`,
    category: "recorrencias",
    priority,
    actionLabel: "Revisar assinaturas",
    actionHref: "/assinaturas",
  };
}

function ruleGastoCrescente(input: InsightInput): FinancialInsight | null {
  const { gastosDoMes, gastosMesAnterior } = input;
  if (gastosMesAnterior.length < 5) return null;
  const atual = sumValor(gastosDoMes);
  const anterior = sumValor(gastosMesAnterior);
  if (anterior <= 0) return null;
  const diff = atual - anterior;
  if (diff < 100) return null;
  const ratio = diff / anterior;
  if (ratio < 0.2) return null;

  return {
    id: "gasto_crescente",
    type: "gasto_crescente",
    title: "Seus gastos aumentaram neste mês",
    description: `Você gastou ${formatBRL(diff)} a mais que no mês anterior (+${Math.round(ratio * 100)}%). Compare os principais grupos para entender onde houve aumento.`,
    category: "economia",
    priority: ratio >= 0.5 ? "alta" : "media",
    actionLabel: "Ver relatórios",
    actionHref: "/relatorios",
  };
}

function ruleOrcamentoPertoLimite(input: InsightInput): FinancialInsight | null {
  const { linhasOrcamento } = input;
  // Apenas linhas com limite ativo, próximas do limite mas SEM estouro
  // (não duplicar alerta de estouro existente).
  const candidatas = linhasOrcamento
    .filter((l) => l.planejado > 0 && l.status === "atencao" && l.pct >= 80 && l.pct < 100)
    .sort((a, b) => b.pct - a.pct);
  const top = candidatas[0];
  if (!top) return null;

  return {
    id: `orcamento_perto_limite:${top.cat.id}`,
    type: "orcamento_perto_limite",
    title: `Você está perto do limite em ${top.cat.nome}`,
    description: `Já usou ${Math.round(top.pct)}% do orçamento de ${top.cat.nome}. Tente segurar novos gastos nessa categoria até o fim do mês.`,
    category: "orcamento",
    priority: top.pct >= 90 ? "alta" : "media",
    actionLabel: "Abrir orçamento",
    actionHref: "/orcamento",
  };
}

function ruleSaldoPositivo(input: InsightInput): FinancialInsight | null {
  const { gastosDoMes, receitasDoMes, hasMetas, hasGuardado } = input;
  if (receitasDoMes.length === 0) return null;
  const renda = sumValor(receitasDoMes);
  const gastos = sumValor(gastosDoMes);
  const saldo = renda - gastos;
  if (saldo < 50) return null;
  if (renda <= 0) return null;
  if (saldo / renda < 0.05) return null;

  const href = hasGuardado ? "/guardado" : hasMetas ? "/metas" : undefined;
  const label = hasGuardado ? "Ir para guardado" : hasMetas ? "Ver metas" : undefined;

  return {
    id: "saldo_positivo",
    type: "saldo_positivo",
    title: "Você pode reservar parte do saldo",
    description: `Seu mês está positivo em ${formatBRL(saldo)}. Considere guardar uma parte para uma meta ou reserva.`,
    category: "metas",
    priority: "baixa",
    actionLabel: label,
    actionHref: href,
  };
}

// ---------------- API ----------------

export function generateFinancialInsights(input: InsightInput): FinancialInsight[] {
  const rules: Array<(i: InsightInput) => FinancialInsight | null> = [
    ruleCategoriaDominante,
    ruleRecorrenciasAcumuladas,
    ruleGastoCrescente,
    ruleOrcamentoPertoLimite,
    ruleSaldoPositivo,
  ];

  const seen = new Set<string>();
  const out: FinancialInsight[] = [];
  for (const rule of rules) {
    const r = rule(input);
    if (!r) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }

  return out
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_INSIGHTS);
}
