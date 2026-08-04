// Score de saúde financeira por regra. Sem IA, sem persistência.
// Lê apenas dados já agregados pelo Dashboard (gastos do mês, receitas,
// contas a pagar, cartões, recorrências, orçamento, metas, guardado) e
// devolve um diagnóstico explicável (0–100, level, positives, warnings).

import type { Cartao, ContaAPagar, Gasto, Guardado, Meta, Receita } from "@/lib/types";
import type { Recorrencia } from "@/lib/recorrencias";
import type { LinhaOrcamento } from "@/lib/orcamento";

export type FinancialHealthLevel = "critico" | "atencao" | "bom" | "excelente";

export type FinancialHealthScore = {
  /** 0 a 100, arredondado. */
  score: number;
  level: FinancialHealthLevel;
  title: string;
  description: string;
  positives: string[];
  warnings: string[];
};

export type FinancialHealthInput = {
  gastosDoMes: Gasto[];
  receitasDoMes: Receita[];
  contasAPagar: ContaAPagar[];
  cartoes: Cartao[];
  /** Pct usado por cartão (0-100). A chave é o id do cartão. */
  usoCartaoPct: Map<string, number>;
  recorrencias: Recorrencia[];
  linhasOrcamento: LinhaOrcamento[];
  metas: Meta[];
  guardado: Guardado[];
  /** Data de referência (default: hoje). */
  hoje?: Date;
};

const MIN_POSITIVES = 0;
const MAX_LISTED = 3;

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
  // pendente com vencimento no passado conta como vencida
  const venc = c.dataVencimento;
  if (!venc) return false;
  return venc < hoje.toISOString().slice(0, 10);
}

function levelFromScore(score: number): FinancialHealthLevel {
  if (score < 40) return "critico";
  if (score < 70) return "atencao";
  if (score < 85) return "bom";
  return "excelente";
}

function titleFor(level: FinancialHealthLevel): string {
  switch (level) {
    case "critico":
      return "Sua saúde financeira precisa de atenção";
    case "atencao":
      return "Sua saúde financeira está em atenção";
    case "bom":
      return "Sua saúde financeira está boa";
    case "excelente":
      return "Sua saúde financeira está excelente";
  }
}

function descriptionFor(level: FinancialHealthLevel): string {
  switch (level) {
    case "critico":
      return "Alguns pontos do seu mês merecem cuidado. Pequenos ajustes já ajudam a melhorar o quadro.";
    case "atencao":
      return "Você está no caminho, mas há ajustes que podem deixar suas finanças mais leves.";
    case "bom":
      return "Você está cuidando bem das suas finanças. Continue acompanhando para manter o ritmo.";
    case "excelente":
      return "Suas finanças estão saudáveis. Mantenha o acompanhamento para preservar esse equilíbrio.";
  }
}

/**
 * Cálculo principal. Retorna `null` quando não há dados suficientes
 * (sem renda E sem gastos no mês).
 */
export function calculateFinancialHealthScore(
  input: FinancialHealthInput,
): FinancialHealthScore | null {
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

  // Proteção: dados insuficientes
  if (gastosDoMes.length === 0 && receitasDoMes.length === 0) {
    return null;
  }

  const hoje = input.hoje ?? new Date();
  const renda = sumValor(receitasDoMes);
  const gastos = sumValor(gastosDoMes);

  let score = 100;
  const positives: string[] = [];
  const warnings: string[] = [];

  // A) Saldo do mês ---------------------------------------------------------
  if (renda > 0) {
    const saldo = renda - gastos;
    if (saldo >= 0) {
      positives.push("Você fechou o mês com saldo positivo.");
    } else {
      const deficit = -saldo;
      const ratio = deficit / renda;
      if (ratio > 0.5) {
        score -= 25;
        warnings.push("Seus gastos superaram bastante a renda neste mês.");
      } else if (ratio > 0.25) {
        score -= 15;
        warnings.push("Seus gastos passaram da renda neste mês.");
      } else if (ratio > 0.1) {
        score -= 10;
        warnings.push("Você fechou o mês com saldo negativo.");
      } else {
        score -= 5;
        warnings.push("Você fechou o mês com leve saldo negativo.");
      }
    }
  } else if (gastos > 0) {
    // Tem gastos, sem renda registrada — aviso leve, não penaliza forte
    score -= 5;
    warnings.push("Cadastre sua renda para o cálculo ficar mais preciso.");
  }

  // B) Contas vencidas ------------------------------------------------------
  const vencidas = contasAPagar.filter((c) => isVencida(c, hoje));
  if (vencidas.length > 0) {
    const totalVencido = sumValor(vencidas);
    const ratio = renda > 0 ? totalVencido / renda : 0;
    if (renda > 0) {
      if (ratio > 0.15) {
        score -= 25;
        warnings.push("Há contas vencidas que comprometem boa parte da renda.");
      } else if (ratio > 0.05) {
        score -= 15;
        warnings.push("Há contas vencidas que podem comprometer seu orçamento.");
      } else {
        score -= 8;
        warnings.push("Você tem contas vencidas para regularizar.");
      }
    } else {
      score -= 15;
      warnings.push("Você tem contas vencidas para regularizar.");
    }
  }

  // C) Uso do cartão --------------------------------------------------------
  let maiorPct = 0;
  for (const c of cartoes) {
    const pct = usoCartaoPct.get(c.id) ?? 0;
    if (pct > maiorPct) maiorPct = pct;
  }
  if (cartoes.length > 0) {
    if (maiorPct >= 90) {
      score -= 20;
      warnings.push("O uso do cartão está muito alto em relação ao limite.");
    } else if (maiorPct >= 70) {
      score -= 10;
      warnings.push("O uso do cartão está alto em relação ao limite.");
    } else if (maiorPct >= 50) {
      score -= 5;
    } else if (maiorPct > 0) {
      positives.push("Seu uso do cartão está controlado.");
    }
  }

  // D) Recorrências / renda -------------------------------------------------
  const recAtivas = recorrencias.filter((r) => r.status === "ativa" || r.status === "suspeita");
  const totalRecorrente = recAtivas.reduce((s, r) => s + recorrenciaMensalEstimada(r), 0);
  if (renda > 0 && totalRecorrente > 0) {
    const share = totalRecorrente / renda;
    if (share > 0.2) {
      score -= 15;
      warnings.push("Suas recorrências representam uma fatia alta da renda.");
    } else if (share > 0.1) {
      score -= 8;
      warnings.push("Suas recorrências consomem uma parte relevante da renda.");
    }
  }

  // E) Metas / guardado (bônus suave) ---------------------------------------
  const temGuardado = guardado.some((g) => (g.valor || 0) > 0);
  const temMetaAtiva = metas.some((m) => (m.valorAtual || 0) > 0);
  if (temGuardado || temMetaAtiva) {
    score += 5;
    positives.push("Você possui metas ou dinheiro reservado.");
  }

  // F) Orçamento ------------------------------------------------------------
  const linhasComLimite = linhasOrcamento.filter((l) => l.planejado > 0);
  if (linhasComLimite.length > 0) {
    const estouradas = linhasComLimite.filter((l) => l.status === "estouro");
    if (estouradas.length > 0) {
      const perda = Math.min(15, estouradas.length * 8);
      score -= perda;
      warnings.push(
        estouradas.length === 1
          ? "Uma categoria do seu orçamento estourou."
          : `${estouradas.length} categorias do seu orçamento estouraram.`,
      );
    } else if (linhasComLimite.every((l) => l.status === "ok")) {
      positives.push("Seu orçamento está dentro do planejado.");
    }
  }

  // Normaliza e fecha ------------------------------------------------------
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  score = Math.round(score);

  const level = levelFromScore(score);

  return {
    score,
    level,
    title: titleFor(level),
    description: descriptionFor(level),
    positives: positives.slice(MIN_POSITIVES, MAX_LISTED),
    warnings: warnings.slice(0, MAX_LISTED),
  };
}

// ---------------------------------------------------------------------------
// Cenário econômico — nota curta e leiga que complementa o score.
// Função pura: sem fetch, sem localStorage, sem React, sem Supabase.
// ---------------------------------------------------------------------------

export type EconomicHealthInput = {
  level: FinancialHealthLevel;
  /** Selic anual em % (ex.: 12.25). Opcional. */
  selic?: number | null;
  /** CDI anual em % (ex.: 12.15). Opcional. */
  cdi?: number | null;
  /** IPCA mensal em % (ex.: 0.45). Opcional. */
  ipca?: number | null;
};

/**
 * Retorna uma frase curta que reforça/suaviza a leitura da nota de
 * saúde financeira a partir do cenário macro (Selic/CDI/IPCA).
 * Retorna `null` quando não há dados suficientes para gerar a nota.
 */
export function buildEconomicHealthNote(input: EconomicHealthInput): string | null {
  const { level, selic, cdi, ipca } = input;

  const jurosRef = typeof selic === "number" ? selic : typeof cdi === "number" ? cdi : null;

  // Sem nenhum indicador → não exibe bloco
  if (jurosRef == null && (ipca == null || Number.isNaN(ipca))) {
    return null;
  }

  const positiva = level === "bom" || level === "excelente";

  // Deflação tem prioridade — mensagem neutra
  if (typeof ipca === "number" && ipca < 0) {
    return "Alguns preços podem aliviar no curto prazo, mas o ideal é manter o controle do orçamento.";
  }

  const jurosAltos = typeof jurosRef === "number" && jurosRef >= 12;
  const ipcaAlto = typeof ipca === "number" && ipca >= 0.6;

  if (jurosAltos) {
    return positiva
      ? "Com juros altos e sua saúde financeira positiva, manter uma reserva organizada pode ajudar bastante."
      : "Com juros altos, vale redobrar o cuidado com dívidas, parcelamentos e atrasos.";
  }

  if (ipcaAlto) {
    return positiva
      ? "Mesmo com a saúde financeira em dia, a inflação pode apertar gastos do dia a dia."
      : "Com inflação pressionada, gastos variáveis podem pesar mais no mês. Acompanhe de perto.";
  }

  // Cenário estável
  return positiva
    ? "O cenário está mais previsível, então manter o planejamento ajuda a preservar sua boa fase."
    : "Mesmo com cenário mais estável, vale ajustar o orçamento antes que pequenas despesas se acumulem.";
}
