// Diagnóstico mensal financeiro por regra.
// Reusa o cálculo de saúde financeira (financial-health-score) para definir
// o status global, e gera um resumo amigável + próximas ações a partir dos
// mesmos dados já disponíveis no Dashboard. 100% client-side, sem IA,
// sem persistência, sem chamadas externas.

import type {
  Cartao,
  ContaAPagar,
  Gasto,
  Guardado,
  Meta,
  Receita,
} from "@/lib/types";
import type { Recorrencia } from "@/lib/recorrencias";
import type { LinhaOrcamento } from "@/lib/orcamento";
import {
  calculateFinancialHealthScore,
  type FinancialHealthLevel,
} from "./financial-health-score";

export type MonthlyDiagnosisStatus = FinancialHealthLevel;

export type MonthlyDiagnosisAction = {
  label: string;
  href: string;
};

export type MonthlyDiagnosis = {
  status: MonthlyDiagnosisStatus;
  title: string;
  summary: string;
  highlights: string[];
  risks: string[];
  nextActions: MonthlyDiagnosisAction[];
};

export type MonthlyDiagnosisInput = {
  gastosDoMes: Gasto[];
  receitasDoMes: Receita[];
  contasAPagar: ContaAPagar[];
  cartoes: Cartao[];
  usoCartaoPct: Map<string, number>;
  recorrencias: Recorrencia[];
  linhasOrcamento: LinhaOrcamento[];
  metas: Meta[];
  guardado: Guardado[];
  hoje?: Date;
};

const MAX_HIGHLIGHTS = 2;
const MAX_RISKS = 2;
const MAX_ACTIONS = 3;

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

function isVencida(c: ContaAPagar, hoje: Date): boolean {
  if (c.status === "pago") return false;
  if (c.status === "atrasado") return true;
  const venc = c.dataVencimento;
  if (!venc) return false;
  return venc < hoje.toISOString().slice(0, 10);
}

function titleFor(status: MonthlyDiagnosisStatus, hasRisks: boolean): string {
  switch (status) {
    case "critico":
      return "Seu mês precisa de atenção";
    case "atencao":
      return hasRisks ? "Alguns pontos merecem revisão" : "Seu mês pede atenção";
    case "bom":
      return "Seu mês está sob controle";
    case "excelente":
      return "Você está indo muito bem este mês";
  }
}

function summaryFor(
  status: MonthlyDiagnosisStatus,
  topRisk: string | null,
  hasPositiveBalance: boolean,
): string {
  if (status === "excelente") {
    return "Você está mantendo um bom equilíbrio entre renda e gastos. Continue acompanhando para preservar esse ritmo.";
  }
  if (status === "bom") {
    if (topRisk) {
      return "Seu mês está positivo, mas vale ajustar alguns pontos para manter o equilíbrio.";
    }
    return "Suas finanças seguem em boa direção neste mês. Continue acompanhando.";
  }
  if (status === "atencao") {
    if (topRisk) return `O principal ponto de atenção é ${topRisk}`;
    return "Há alguns pontos para revisar e deixar seu mês mais leve.";
  }
  // critico
  if (topRisk) return `O ponto mais delicado deste mês é ${topRisk}`;
  if (hasPositiveBalance) {
    return "Mesmo com saldo positivo, há pontos importantes para revisar este mês.";
  }
  return "Seu mês tem alguns pontos críticos. Pequenos ajustes já ajudam a melhorar.";
}

export function generateMonthlyDiagnosis(
  input: MonthlyDiagnosisInput,
): MonthlyDiagnosis | null {
  const {
    gastosDoMes,
    receitasDoMes,
    contasAPagar,
    cartoes,
    usoCartaoPct,
    recorrencias,
    linhasOrcamento,
    metas,
    guardado,
  } = input;

  // Sem dados suficientes — não inventa diagnóstico.
  if (gastosDoMes.length === 0 && receitasDoMes.length === 0) {
    return null;
  }

  const hoje = input.hoje ?? new Date();
  const renda = sumValor(receitasDoMes);
  const gastos = sumValor(gastosDoMes);
  const saldo = renda - gastos;

  // Reusa o motor de saúde financeira para definir o status global.
  const health = calculateFinancialHealthScore({
    gastosDoMes,
    receitasDoMes,
    contasAPagar,
    cartoes,
    usoCartaoPct,
    recorrencias,
    linhasOrcamento,
    metas,
    guardado,
    hoje,
  });
  const status: MonthlyDiagnosisStatus = health?.level ?? "atencao";

  const highlights: string[] = [];
  const risks: string[] = [];
  // topRiskShort serve para o summary (frase curta, em minúsculas).
  let topRiskShort: string | null = null;
  const actions: MonthlyDiagnosisAction[] = [];
  const pushedHrefs = new Set<string>();
  const pushAction = (a: MonthlyDiagnosisAction) => {
    if (pushedHrefs.has(a.href)) return;
    if (actions.length >= MAX_ACTIONS) return;
    pushedHrefs.add(a.href);
    actions.push(a);
  };

  // A) Saldo do mês
  if (renda > 0 && saldo >= 0) {
    highlights.push("Você está fechando o mês com saldo positivo.");
  } else if (renda > 0 && saldo < 0) {
    risks.push("Seus gastos passaram da sua renda neste mês.");
    if (!topRiskShort) topRiskShort = "os gastos passarem da renda.";
    pushAction({ label: "Revisar gastos", href: "/gastos" });
  }

  // B) Contas vencidas
  const vencidas = contasAPagar.filter((c) => isVencida(c, hoje));
  if (vencidas.length > 0) {
    risks.push("Existem contas vencidas que merecem prioridade.");
    if (!topRiskShort) topRiskShort = "as contas vencidas em aberto.";
    pushAction({ label: "Ver contas vencidas", href: "/contas-a-pagar" });
  }

  // C) Cartão comprometido
  let maiorPct = 0;
  for (const c of cartoes) {
    const pct = usoCartaoPct.get(c.id) ?? 0;
    if (pct > maiorPct) maiorPct = pct;
  }
  if (maiorPct >= 70) {
    risks.push("O uso do cartão está alto em relação ao limite.");
    if (!topRiskShort) topRiskShort = "o uso alto do cartão.";
    pushAction({ label: "Revisar cartões", href: "/cartoes" });
  }

  // D) Recorrências altas
  const recAtivas = recorrencias.filter(
    (r) => r.status === "ativa" || r.status === "suspeita",
  );
  const totalRecorrente = recAtivas.reduce(
    (s, r) => s + recorrenciaMensalEstimada(r),
    0,
  );
  if (renda > 0 && totalRecorrente / renda > 0.2) {
    risks.push(
      "Suas assinaturas e recorrências estão consumindo uma parte relevante da renda.",
    );
    if (!topRiskShort) topRiskShort = "o peso das assinaturas na sua renda.";
    pushAction({ label: "Ver assinaturas", href: "/assinaturas" });
  }

  // E) Orçamento estourado / perto do limite
  const linhasComLimite = linhasOrcamento.filter((l) => l.planejado > 0);
  const estouradas = linhasComLimite.filter((l) => l.status === "estouro");
  const proximas = linhasComLimite.filter((l) => l.status === "atencao");
  if (estouradas.length > 0 || proximas.length > 0) {
    risks.push("Algumas categorias estão próximas ou acima do orçamento.");
    if (!topRiskShort) topRiskShort = "categorias acima do orçamento.";
    pushAction({ label: "Ajustar orçamento", href: "/orcamento" });
  } else if (linhasComLimite.length > 0) {
    highlights.push("Seu orçamento está dentro do planejado.");
  }

  // F) Pontos positivos extras
  const temGuardado = guardado.some((g) => (g.valor || 0) > 0);
  const temMetaAtiva = metas.some((m) => (m.valorAtual || 0) > 0);
  if (temGuardado || temMetaAtiva) {
    highlights.push(
      "Você já possui dinheiro reservado ou metas em andamento.",
    );
  } else if (renda > 0 && saldo > 0 && actions.length < MAX_ACTIONS) {
    // Sugere construir reserva quando há sobra
    pushAction({ label: "Guardar dinheiro", href: "/guardado" });
  }

  // Garante pelo menos uma ação útil mesmo em meses sem riscos
  if (actions.length === 0) {
    if (status === "excelente" || status === "bom") {
      if (!temMetaAtiva) pushAction({ label: "Criar uma meta", href: "/metas" });
      else pushAction({ label: "Guardar dinheiro", href: "/guardado" });
    } else {
      pushAction({ label: "Revisar gastos", href: "/gastos" });
    }
  }

  const hasRisks = risks.length > 0;
  const hasPositiveBalance = renda > 0 && saldo >= 0;

  return {
    status,
    title: titleFor(status, hasRisks),
    summary: summaryFor(status, topRiskShort, hasPositiveBalance),
    highlights: highlights.slice(0, MAX_HIGHLIGHTS),
    risks: risks.slice(0, MAX_RISKS),
    nextActions: actions.slice(0, MAX_ACTIONS),
  };
}
