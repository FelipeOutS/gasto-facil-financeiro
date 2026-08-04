// Engine de Relatórios e Fechamento do Mês.
// Centraliza cálculos comparativos, classificação ("humor financeiro"),
// insights automáticos e geração de mensagens variadas.
//
// Reaproveita os dados existentes do store. Não persiste nada.
//
// Regras de inclusão (alinhadas ao restante do app):
//  - Despesas = gastos confirmados do mês (gasto.confirmado !== false).
//    Conta paga já vira `Gasto` via store.marcarContaComoPago, então
//    "Total pago em contas" é derivado de `gastos.origem === "contas_a_pagar"`.
//    Não somamos novamente as contas da tabela ContaAPagar para evitar
//    duplicação.
//  - Receitas = lançamentos da tabela receitas.
//  - Transferências internas e movimentações de Guardado NÃO entram em
//    despesas — elas vivem em tabelas próprias.
//  - "Total gasto no cartão" = gastos com cartaoId definido OU
//    formaPagamento === "credito".
//  - "Total guardado/cofrinho" = movimentações para metas no mês +
//    aporte líquido em guardado (delta vs mês anterior). Para evitar
//    complexidade, somamos apenas movimentações de meta no mês
//    (positivas) — é o sinal mais confiável de "guardar".

import i18n from "@/i18n";
import type { Categoria, ContaAPagar, Gasto, Receita, MovimentacaoMeta, Guardado } from "./types";
import { parseDateLocal } from "./format";

export type EstadoMes = "excelente" | "bom" | "mediano" | "atencao" | "critico";

export interface ResumoMensal {
  mes: number;
  ano: number;
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
  totalPagoContas: number; // contas marcadas como pagas e viraram gasto
  totalCartao: number;
  totalGuardado: number;
  qtdContasAtrasadas: number;
  qtdContasPendentes: number;
  qtdContasPagas: number;
  qtdLancamentos: number;
  porCategoria: Array<{ catId: string; nome: string; valor: number; pct: number }>;
  topGastos: Gasto[]; // top 5 do mês
  maiorGasto: Gasto | null;
  maiorCategoria: { catId: string; nome: string; valor: number } | null;
}

export interface DiffCategoria {
  catId: string;
  nome: string;
  atual: number;
  anterior: number;
  delta: number; // atual - anterior
  pct: number; // (atual-anterior)/anterior * 100, 0 se anterior=0
}

export interface ComparativoMensal {
  receitas: { atual: number; anterior: number; delta: number; pct: number };
  despesas: { atual: number; anterior: number; delta: number; pct: number };
  saldo: { atual: number; anterior: number; delta: number };
  maiorAlta: DiffCategoria | null;
  maiorReducao: DiffCategoria | null;
}

export interface ClassificacaoMes {
  estado: EstadoMes;
  pontuacao: number; // 0..100
  motivo: string[];
}

export interface RelatorioMes {
  resumo: ResumoMensal;
  comparativo: ComparativoMensal;
  classificacao: ClassificacaoMes;
  qtdEstouroOrcamento: number;
  qtdDentroOrcamento: number;
  categoriaCriticaOrcamento: string | null;
  melhorCategoriaOrcamento: string | null;
}

// ======================================================================
// HELPERS
// ======================================================================

function isGastoNoMes(g: Gasto, mes: number, ano: number): boolean {
  if (g.confirmado === false) return false;
  // Fonte da verdade: invoice_month (mês de referência) — vale para crédito,
  // contas pagas e qualquer gasto que tenha o campo preenchido.
  if (g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) {
    const [ay, am] = g.invoiceMonth.split("-").map(Number);
    return am === mes && ay === ano;
  }
  if (g.mes === mes && g.ano === ano) return true;
  // fallback pelo campo data
  const d = parseDateLocal(g.data);
  return !!d && d.getMonth() + 1 === mes && d.getFullYear() === ano;
}

function isGastoCartao(g: Gasto): boolean {
  return !!g.cartaoId || g.formaPagamento === "credito";
}

function isPagamentoConta(g: Gasto): boolean {
  return String(g.origem ?? "").toLowerCase() === "contas_a_pagar";
}

function nomeCategoria(catId: string, categorias: Categoria[]): string {
  return categorias.find((c) => c.id === catId)?.nome ?? i18n.t("relatorios:chart.emptyCategorias");
}

function pctChange(atual: number, anterior: number): number {
  if (anterior <= 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / anterior) * 100;
}

function mesAnterior(mes: number, ano: number): { mes: number; ano: number } {
  if (mes === 1) return { mes: 12, ano: ano - 1 };
  return { mes: mes - 1, ano };
}

function localeBRL(v: number): string {
  const lng = i18n.language === "en" ? "en-US" : "pt-BR";
  return v.toLocaleString(lng, { style: "currency", currency: "BRL" });
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

// ======================================================================
// RESUMO MENSAL
// ======================================================================

export function buildResumoMensal(params: {
  mes: number;
  ano: number;
  gastos: Gasto[];
  receitas: Receita[];
  contas: ContaAPagar[];
  movMetas: MovimentacaoMeta[];
  categorias: Categoria[];
  guardado?: Guardado[];
}): ResumoMensal {
  const { mes, ano, gastos, receitas, contas, categorias, guardado } = params;
  const gastosMes = gastos.filter((g) => isGastoNoMes(g, mes, ano));

  const totalReceitas = receitas
    .filter((r) => r.mes === mes && r.ano === ano)
    .reduce((s, r) => s + r.valor, 0);
  const totalDespesas = gastosMes.reduce((s, g) => s + g.valor, 0);
  const totalCartao = gastosMes.filter(isGastoCartao).reduce((s, g) => s + g.valor, 0);
  const totalPagoContas = gastosMes.filter(isPagamentoConta).reduce((s, g) => s + g.valor, 0);

  // Total guardado = saldo total das reservas (mesma lógica da aba Guardado).
  // Não somamos movimentações de meta separadamente para evitar duplicidade,
  // pois movimentações já compõem o saldo da própria reserva/banco.
  const totalGuardado = (guardado ?? []).reduce((s, g) => s + g.valor, 0);

  // Contas do mês (status)
  const hojeISO = new Date().toISOString().slice(0, 10);
  let pendentes = 0,
    pagas = 0,
    atrasadas = 0;
  for (const c of contas) {
    const mref =
      c.mesReferencia && /^\d{4}-\d{2}$/.test(c.mesReferencia)
        ? { ano: Number(c.mesReferencia.slice(0, 4)), mes: Number(c.mesReferencia.slice(5, 7)) }
        : { mes: c.mes, ano: c.ano };
    if (mref.mes !== mes || mref.ano !== ano) continue;
    if (c.status === "pago") pagas++;
    else if (c.dataVencimento < hojeISO) atrasadas++;
    else pendentes++;
  }

  // Por categoria
  const mapCat = new Map<string, number>();
  for (const g of gastosMes) {
    mapCat.set(g.categoriaId, (mapCat.get(g.categoriaId) ?? 0) + g.valor);
  }
  const porCategoria = [...mapCat.entries()]
    .map(([catId, valor]) => ({
      catId,
      nome: nomeCategoria(catId, categorias),
      valor,
      pct: totalDespesas > 0 ? (valor / totalDespesas) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  const topGastos = [...gastosMes].sort((a, b) => b.valor - a.valor).slice(0, 5);
  const maiorGasto = topGastos[0] ?? null;
  const maiorCategoria = porCategoria[0] ?? null;

  return {
    mes,
    ano,
    totalReceitas,
    totalDespesas,
    saldo: totalReceitas - totalDespesas,
    totalPagoContas,
    totalCartao,
    totalGuardado,
    qtdContasAtrasadas: atrasadas,
    qtdContasPendentes: pendentes,
    qtdContasPagas: pagas,
    qtdLancamentos: gastosMes.length,
    porCategoria,
    topGastos,
    maiorGasto,
    maiorCategoria,
  };
}

// ======================================================================
// COMPARATIVO
// ======================================================================

export function buildComparativo(atual: ResumoMensal, anterior: ResumoMensal): ComparativoMensal {
  const mapAnt = new Map(anterior.porCategoria.map((c) => [c.catId, c.valor]));
  const mapAtu = new Map(atual.porCategoria.map((c) => [c.catId, c.valor]));
  const ids = new Set<string>([...mapAnt.keys(), ...mapAtu.keys()]);

  const diffs: DiffCategoria[] = [];
  for (const id of ids) {
    const a = mapAtu.get(id) ?? 0;
    const b = mapAnt.get(id) ?? 0;
    diffs.push({
      catId: id,
      nome:
        atual.porCategoria.find((c) => c.catId === id)?.nome ??
        anterior.porCategoria.find((c) => c.catId === id)?.nome ??
        i18n.t("relatorios:chart.emptyCategorias"),
      atual: a,
      anterior: b,
      delta: a - b,
      pct: pctChange(a, b),
    });
  }

  const altas = diffs.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);
  const reducoes = diffs.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta);

  return {
    receitas: {
      atual: atual.totalReceitas,
      anterior: anterior.totalReceitas,
      delta: atual.totalReceitas - anterior.totalReceitas,
      pct: pctChange(atual.totalReceitas, anterior.totalReceitas),
    },
    despesas: {
      atual: atual.totalDespesas,
      anterior: anterior.totalDespesas,
      delta: atual.totalDespesas - anterior.totalDespesas,
      pct: pctChange(atual.totalDespesas, anterior.totalDespesas),
    },
    saldo: {
      atual: atual.saldo,
      anterior: anterior.saldo,
      delta: atual.saldo - anterior.saldo,
    },
    maiorAlta: altas[0] ?? null,
    maiorReducao: reducoes[0] ?? null,
  };
}

// ======================================================================
// CLASSIFICAÇÃO ("Humor financeiro")
// ======================================================================
// Heurística baseada em:
//  +20 saldo positivo, +10 se saldo > 20% receitas
//  +15 guardou dinheiro
//  +10 nenhum estouro de orçamento
//  +10 nenhuma conta atrasada
//  +10 saldo melhor que mês anterior
//  -25 saldo negativo
//  -15 ≥ 1 conta atrasada
//  -10 por estouro de orçamento (max -25)
//  -10 saldo piorou vs mês anterior

export function classificarMes(params: {
  resumo: ResumoMensal;
  comparativo: ComparativoMensal;
  qtdEstouroOrcamento: number;
}): ClassificacaoMes {
  const { resumo, comparativo, qtdEstouroOrcamento } = params;
  let p = 50;
  const motivo: string[] = [];

  if (resumo.saldo > 0) {
    p += 20;
    if (resumo.totalReceitas > 0 && resumo.saldo / resumo.totalReceitas > 0.2) {
      p += 10;
      motivo.push(i18n.t("relatorios:classificacao.sobrouMais20"));
    } else {
      motivo.push(i18n.t("relatorios:classificacao.saldoPositivo"));
    }
  } else if (resumo.saldo < 0) {
    p -= 25;
    motivo.push(i18n.t("relatorios:classificacao.saldoNegativo"));
  }

  if (resumo.totalGuardado > 0) {
    p += 15;
    motivo.push(i18n.t("relatorios:classificacao.guardouDinheiro"));
  }

  if (qtdEstouroOrcamento === 0) {
    p += 10;
    motivo.push(i18n.t("relatorios:classificacao.nenhumEstouro"));
  } else {
    p -= Math.min(25, qtdEstouroOrcamento * 10);
    motivo.push(i18n.t("relatorios:classificacao.estouroCount", { count: qtdEstouroOrcamento }));
  }

  if (resumo.qtdContasAtrasadas === 0) {
    p += 10;
  } else {
    p -= 15;
    motivo.push(
      i18n.t("relatorios:classificacao.atrasadaCount", { count: resumo.qtdContasAtrasadas }),
    );
  }

  if (comparativo.saldo.delta > 0) {
    p += 10;
    motivo.push(i18n.t("relatorios:classificacao.saldoMelhor"));
  } else if (comparativo.saldo.delta < 0) {
    p -= 10;
    motivo.push(i18n.t("relatorios:classificacao.saldoPior"));
  }

  p = Math.max(0, Math.min(100, p));

  let estado: EstadoMes;
  if (p >= 85) estado = "excelente";
  else if (p >= 70) estado = "bom";
  else if (p >= 50) estado = "mediano";
  else if (p >= 30) estado = "atencao";
  else estado = "critico";

  return { estado, pontuacao: p, motivo };
}

// ======================================================================
// MENSAGENS VARIADAS (templates)
// ======================================================================

export function fraseDoEstado(estado: EstadoMes, seed = 0): string {
  const arr = i18n.t(`relatorios:estado.${estado}.frases`, { returnObjects: true }) as string[];
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr[Math.abs(seed) % arr.length];
}

export function emojiDoEstado(estado: EstadoMes): string {
  return { excelente: "🎉", bom: "😄", mediano: "🙂", atencao: "⚠️", critico: "🚨" }[estado];
}

export function tituloDoEstado(estado: EstadoMes): string {
  return i18n.t(`relatorios:estado.${estado}.titulo`);
}

export function corDoEstado(estado: EstadoMes): {
  bg: string;
  text: string;
  ring: string;
  glow: string;
} {
  switch (estado) {
    case "excelente":
      return {
        bg: "bg-success/15",
        text: "text-success",
        ring: "ring-success/30",
        glow: "shadow-[0_0_40px_-10px_var(--success)]",
      };
    case "bom":
      return { bg: "bg-success/10", text: "text-success", ring: "ring-success/20", glow: "" };
    case "mediano":
      return {
        bg: "bg-muted",
        text: "text-foreground",
        ring: "ring-border",
        glow: "",
      };
    case "atencao":
      return {
        bg: "bg-warning/15",
        text: "text-warning",
        ring: "ring-warning/30",
        glow: "shadow-[0_0_40px_-10px_var(--warning)]",
      };
    case "critico":
      return {
        bg: "bg-destructive/15",
        text: "text-destructive",
        ring: "ring-destructive/40",
        glow: "shadow-[0_0_40px_-10px_var(--destructive)]",
      };
  }
}

// ======================================================================
// INSIGHTS AUTOMÁTICOS
// ======================================================================

export interface Insight {
  id: string;
  emoji: string;
  texto: string;
  tom: "positivo" | "neutro" | "alerta" | "negativo";
}

export function gerarInsights(params: {
  resumo: ResumoMensal;
  comparativo: ComparativoMensal;
  qtdEstouroOrcamento: number;
  qtdDentroOrcamento: number;
  estouroNomes: string[];
}): Insight[] {
  const { resumo, comparativo, qtdEstouroOrcamento, qtdDentroOrcamento, estouroNomes } = params;
  const seed = resumo.mes + resumo.ano;
  const insights: Insight[] = [];

  if (resumo.maiorCategoria) {
    const frases = i18n.t("relatorios:insightTexts.maiorGasto", {
      returnObjects: true,
    }) as string[];
    insights.push({
      id: "maior-cat",
      emoji: "🛒",
      texto: pick(frases, seed).replace("{{categoria}}", resumo.maiorCategoria.nome),
      tom: "neutro",
    });
  }

  if (qtdEstouroOrcamento > 0 && estouroNomes.length > 0) {
    const cats = estouroNomes.slice(0, 2).join(i18n.language === "en" ? " and " : " e ");
    const mais = estouroNomes.length > 2 ? (i18n.language === "en" ? " and more" : " e mais") : "";
    insights.push({
      id: "estouro",
      emoji: "⚠️",
      texto: i18n.t("relatorios:insightTexts.estouroOrcamento", { categorias: cats + mais }),
      tom: "alerta",
    });
  }

  if (qtdDentroOrcamento > 0) {
    const frases = i18n.t("relatorios:insightTexts.dentroOrcamento", {
      returnObjects: true,
    }) as string[];
    insights.push({
      id: "dentro-orc",
      emoji: "✅",
      texto: pick(frases, seed).replace("{{n}}", String(qtdDentroOrcamento)),
      tom: "positivo",
    });
  }

  if (resumo.qtdContasAtrasadas > 0) {
    const frases = i18n.t("relatorios:insightTexts.atrasadas", { returnObjects: true }) as string[];
    insights.push({
      id: "atrasadas",
      emoji: "⏰",
      texto: pick(frases, seed).replace("{{n}}", String(resumo.qtdContasAtrasadas)),
      tom: "alerta",
    });
  }

  if (resumo.totalGuardado > 0) {
    const frases = i18n.t("relatorios:insightTexts.guardou", { returnObjects: true }) as string[];
    const v = localeBRL(resumo.totalGuardado);
    insights.push({
      id: "guardou",
      emoji: "🎯",
      texto: pick(frases, seed).replace("{{valor}}", v),
      tom: "positivo",
    });
  }

  if (resumo.totalDespesas > 0 && resumo.totalCartao / resumo.totalDespesas > 0.4) {
    const pct = Math.round((resumo.totalCartao / resumo.totalDespesas) * 100);
    const frases = i18n.t("relatorios:insightTexts.cartaoAlto", {
      returnObjects: true,
    }) as string[];
    insights.push({
      id: "cartao-alto",
      emoji: "💳",
      texto: pick(frases, seed).replace("{{pct}}", String(pct)),
      tom: "neutro",
    });
  }

  if (resumo.saldo < 0) {
    const frases = i18n.t("relatorios:insightTexts.saldoNegativo", {
      returnObjects: true,
    }) as string[];
    insights.push({
      id: "saldo-neg",
      emoji: "📉",
      texto: pick(frases, seed),
      tom: "negativo",
    });
  }

  if (
    comparativo.maiorAlta &&
    comparativo.maiorAlta.delta > 0 &&
    comparativo.maiorAlta.anterior > 0
  ) {
    const v = localeBRL(comparativo.maiorAlta.delta);
    insights.push({
      id: "alta-cat",
      emoji: "📈",
      texto: i18n.t("relatorios:insightTexts.altaCategoria", {
        categoria: comparativo.maiorAlta.nome,
        valor: `+${v}`,
      }),
      tom: "alerta",
    });
  }

  if (comparativo.maiorReducao && comparativo.maiorReducao.delta < 0) {
    const v = localeBRL(Math.abs(comparativo.maiorReducao.delta));
    insights.push({
      id: "reducao-cat",
      emoji: "🪙",
      texto: i18n.t("relatorios:insightTexts.reducaoCategoria", {
        valor: v,
        categoria: comparativo.maiorReducao.nome,
      }),
      tom: "positivo",
    });
  }

  if (comparativo.despesas.delta > 0 && comparativo.despesas.anterior > 0) {
    const v = localeBRL(comparativo.despesas.delta);
    insights.push({
      id: "gastou-mais",
      emoji: "💸",
      texto: i18n.t("relatorios:insightTexts.gastouMais", { valor: v }),
      tom: "alerta",
    });
  } else if (comparativo.despesas.delta < 0) {
    const v = localeBRL(Math.abs(comparativo.despesas.delta));
    insights.push({
      id: "gastou-menos",
      emoji: "💪",
      texto: i18n.t("relatorios:insightTexts.gastouMenos", { valor: v }),
      tom: "positivo",
    });
  }

  return insights;
}

// ======================================================================
// RESUMO TEXTUAL (Gerar resumo do mês)
// ======================================================================

const NOMES_MES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const NOMES_MES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function nomeMes(mes: number): string {
  const arr = i18n.language === "en" ? NOMES_MES_EN : NOMES_MES_PT;
  return arr[mes - 1] ?? "";
}

export function gerarResumoTexto(params: {
  resumo: ResumoMensal;
  classificacao: ClassificacaoMes;
}): string {
  const { resumo, classificacao } = params;
  const mesNome = nomeMes(resumo.mes);
  const partes: string[] = [];

  partes.push(
    i18n.t("relatorios:resumoTexto.intro", {
      mes: mesNome,
      receitas: localeBRL(resumo.totalReceitas),
      despesas: localeBRL(resumo.totalDespesas),
    }),
  );

  if (resumo.saldo >= 0) {
    partes.push(i18n.t("relatorios:resumoTexto.sobrou", { valor: localeBRL(resumo.saldo) }));
  } else {
    partes.push(i18n.t("relatorios:resumoTexto.negativo", { valor: localeBRL(-resumo.saldo) }));
  }

  if (resumo.maiorCategoria) {
    partes.push(
      i18n.t("relatorios:resumoTexto.maiorGasto", { categoria: resumo.maiorCategoria.nome }),
    );
  }
  if (resumo.totalGuardado > 0) {
    partes.push(
      i18n.t("relatorios:resumoTexto.guardou", { valor: localeBRL(resumo.totalGuardado) }),
    );
  }
  if (resumo.qtdContasAtrasadas > 0) {
    partes.push(i18n.t("relatorios:resumoTexto.atrasadas", { count: resumo.qtdContasAtrasadas }));
  }

  partes.push(fraseDoEstado(classificacao.estado, resumo.mes + resumo.ano));

  return partes.join(" ");
}

// ======================================================================
// HELPERS DE EXPORT
// ======================================================================

export { mesAnterior };
