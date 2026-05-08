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
  // Crédito com invoice_month: o mês "real" é o da fatura, não da compra.
  if (g.formaPagamento === "credito" && g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) {
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
  return categorias.find((c) => c.id === catId)?.nome ?? "Outros";
}

function pctChange(atual: number, anterior: number): number {
  if (anterior <= 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / anterior) * 100;
}

function mesAnterior(mes: number, ano: number): { mes: number; ano: number } {
  if (mes === 1) return { mes: 12, ano: ano - 1 };
  return { mes: mes - 1, ano };
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
    const mref = c.mesReferencia && /^\d{4}-\d{2}$/.test(c.mesReferencia)
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
        "Outros",
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
      motivo.push("Sobrou mais de 20% da renda");
    } else {
      motivo.push("Saldo positivo");
    }
  } else if (resumo.saldo < 0) {
    p -= 25;
    motivo.push("Saldo negativo");
  }

  if (resumo.totalGuardado > 0) {
    p += 15;
    motivo.push("Guardou dinheiro");
  }

  if (qtdEstouroOrcamento === 0) {
    p += 10;
    motivo.push("Nenhum orçamento estourado");
  } else {
    p -= Math.min(25, qtdEstouroOrcamento * 10);
    motivo.push(`${qtdEstouroOrcamento} orçamento(s) estourado(s)`);
  }

  if (resumo.qtdContasAtrasadas === 0) {
    p += 10;
  } else {
    p -= 15;
    motivo.push(`${resumo.qtdContasAtrasadas} conta(s) atrasada(s)`);
  }

  if (comparativo.saldo.delta > 0) {
    p += 10;
    motivo.push("Saldo melhor que o mês anterior");
  } else if (comparativo.saldo.delta < 0) {
    p -= 10;
    motivo.push("Saldo pior que o mês anterior");
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

const FRASES_ESTADO: Record<EstadoMes, string[]> = {
  excelente: [
    "Você fechou o mês muito bem! 🎉 Sobrou dinheiro, deu pra controlar os gastos e ainda guardar uma parte. Bora manter esse ritmo!",
    "Mês excelente! 🔥 Você mandou bem em quase tudo. Continua assim que o próximo vai ser ainda melhor.",
    "Boa demais! ✨ Esse mês foi de respiro pro bolso e ainda sobrou pra guardar.",
  ],
  bom: [
    "Boa! Seu mês foi positivo 😄 Você conseguiu manter um bom controle e ficou dentro do esperado na maior parte das categorias.",
    "Mês positivo! 👏 Deu pra equilibrar entradas e saídas e ainda fechar no azul.",
    "Mandou bem! 💪 Mês tranquilo, nada de exagero, e o saldo ficou positivo.",
  ],
  mediano: [
    "Foi um mês ok 🙂 Não saiu totalmente do controle, mas dá pra ajustar alguns pontos pra sobrar mais no próximo.",
    "Esse mês ficou no equilíbrio, nem tão ruim, nem tão incrível 😅",
    "Mês mediano 🤔 Deu pra fechar, mas dá pra apertar uns gastos pra sobrar mais.",
  ],
  atencao: [
    "Ops! Esse mês pediu mais cuidado ⚠️ Seus gastos passaram do ideal em algumas áreas.",
    "Opa, esse mês saiu um pouco do controle 👀 Vale dar uma olhada nas categorias que mais cresceram.",
    "Atenção! 🚧 Algumas categorias estouraram e o saldo apertou. Bora reorganizar pro próximo.",
  ],
  critico: [
    "Alerta ligado 🚨 Esse mês pesou mais no bolso. Vale revisar categorias e contas pro próximo fechar melhor.",
    "Esse mês foi puxado 😬 Saída maior que entrada e várias áreas estourando — hora de respirar e replanejar.",
    "Mês crítico 🚨 Importante revisar onde dá pra cortar antes do próximo virar.",
  ],
};

export function fraseDoEstado(estado: EstadoMes, seed = 0): string {
  const arr = FRASES_ESTADO[estado];
  return arr[Math.abs(seed) % arr.length];
}

export function emojiDoEstado(estado: EstadoMes): string {
  return { excelente: "🎉", bom: "😄", mediano: "🙂", atencao: "⚠️", critico: "🚨" }[estado];
}

export function tituloDoEstado(estado: EstadoMes): string {
  return {
    excelente: "Excelente",
    bom: "Bom",
    mediano: "Mediano",
    atencao: "Atenção",
    critico: "Crítico",
  }[estado];
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

const FRASES_MAIOR_GASTO = [
  (cat: string) => `Seu maior gasto foi com ${cat}`,
  (cat: string) => `${cat} liderou os gastos esse mês`,
  (cat: string) => `${cat} foi quem mais pesou no bolso`,
];
const FRASES_GUARDOU = [
  (v: string) => `Você guardou ${v} esse mês 🎯`,
  (v: string) => `Boa! ${v} foram pra reserva 💰`,
  (v: string) => `${v} foram parar no cofrinho ✨`,
];
const FRASES_CARTAO_ALTO = [
  (pct: number) => `O cartão representou ${pct}% das despesas 💳`,
  (pct: number) => `Olho no cartão: ${pct}% de tudo que você gastou foi nele 👀`,
];
const FRASES_SALDO_NEG = [
  "Você teve mais saídas do que entradas neste mês 📉",
  "Esse mês saiu mais do que entrou — vale revisar 📉",
  "O saldo fechou no vermelho ⛔",
];
const FRASES_DENTRO_ORC = [
  (n: number) => `Boa! Você ficou dentro do orçamento em ${n} categoria(s) ✅`,
  (n: number) => `${n} categoria(s) no controle 👏`,
];
const FRASES_ATRASADAS = [
  (n: number) => `Você teve ${n} conta(s) atrasada(s) neste mês 👀`,
  (n: number) => `${n} conta(s) passaram do prazo — fica de olho ⏰`,
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
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
    insights.push({
      id: "maior-cat",
      emoji: "🛒",
      texto: pick(FRASES_MAIOR_GASTO, seed)(resumo.maiorCategoria.nome),
      tom: "neutro",
    });
  }

  if (qtdEstouroOrcamento > 0 && estouroNomes.length > 0) {
    insights.push({
      id: "estouro",
      emoji: "⚠️",
      texto: `Você ultrapassou o orçamento em ${estouroNomes.slice(0, 2).join(" e ")}${
        estouroNomes.length > 2 ? " e mais" : ""
      }`,
      tom: "alerta",
    });
  }

  if (qtdDentroOrcamento > 0) {
    insights.push({
      id: "dentro-orc",
      emoji: "✅",
      texto: pick(FRASES_DENTRO_ORC, seed)(qtdDentroOrcamento),
      tom: "positivo",
    });
  }

  if (resumo.qtdContasAtrasadas > 0) {
    insights.push({
      id: "atrasadas",
      emoji: "⏰",
      texto: pick(FRASES_ATRASADAS, seed)(resumo.qtdContasAtrasadas),
      tom: "alerta",
    });
  }

  if (resumo.totalGuardado > 0) {
    insights.push({
      id: "guardou",
      emoji: "🎯",
      texto: pick(FRASES_GUARDOU, seed)(
        resumo.totalGuardado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      ),
      tom: "positivo",
    });
  }

  if (resumo.totalDespesas > 0 && resumo.totalCartao / resumo.totalDespesas > 0.4) {
    const pct = Math.round((resumo.totalCartao / resumo.totalDespesas) * 100);
    insights.push({
      id: "cartao-alto",
      emoji: "💳",
      texto: pick(FRASES_CARTAO_ALTO, seed)(pct),
      tom: "neutro",
    });
  }

  if (resumo.saldo < 0) {
    insights.push({
      id: "saldo-neg",
      emoji: "📉",
      texto: pick(FRASES_SALDO_NEG, seed),
      tom: "negativo",
    });
  }

  if (comparativo.maiorAlta && comparativo.maiorAlta.delta > 0 && comparativo.maiorAlta.anterior > 0) {
    const v = comparativo.maiorAlta.delta.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    insights.push({
      id: "alta-cat",
      emoji: "📈",
      texto: `Sua maior alta foi em ${comparativo.maiorAlta.nome} (+${v})`,
      tom: "alerta",
    });
  }

  if (comparativo.maiorReducao && comparativo.maiorReducao.delta < 0) {
    const v = Math.abs(comparativo.maiorReducao.delta).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    insights.push({
      id: "reducao-cat",
      emoji: "🪙",
      texto: `Você economizou ${v} em ${comparativo.maiorReducao.nome}`,
      tom: "positivo",
    });
  }

  if (comparativo.despesas.delta > 0 && comparativo.despesas.anterior > 0) {
    const v = comparativo.despesas.delta.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    insights.push({
      id: "gastou-mais",
      emoji: "💸",
      texto: `Você gastou ${v} a mais que no mês anterior`,
      tom: "alerta",
    });
  } else if (comparativo.despesas.delta < 0) {
    const v = Math.abs(comparativo.despesas.delta).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    insights.push({
      id: "gastou-menos",
      emoji: "💪",
      texto: `Você gastou ${v} a menos que no mês anterior`,
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

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function gerarResumoTexto(params: {
  resumo: ResumoMensal;
  classificacao: ClassificacaoMes;
}): string {
  const { resumo, classificacao } = params;
  const mesNome = NOMES_MES_PT[resumo.mes - 1];
  const partes: string[] = [];

  partes.push(
    `Em ${mesNome}, você recebeu ${brl(resumo.totalReceitas)} e gastou ${brl(
      resumo.totalDespesas,
    )}.`,
  );

  if (resumo.saldo >= 0) {
    partes.push(`Sobrou ${brl(resumo.saldo)} no mês 💰`);
  } else {
    partes.push(`O saldo ficou negativo em ${brl(-resumo.saldo)} 📉`);
  }

  if (resumo.maiorCategoria) {
    partes.push(`Seu maior gasto foi em ${resumo.maiorCategoria.nome} 🛒`);
  }
  if (resumo.totalGuardado > 0) {
    partes.push(`e você ainda conseguiu guardar ${brl(resumo.totalGuardado)} 🎯`);
  }
  if (resumo.qtdContasAtrasadas > 0) {
    partes.push(`Atenção: ${resumo.qtdContasAtrasadas} conta(s) ficaram atrasadas ⏰`);
  }

  partes.push(fraseDoEstado(classificacao.estado, resumo.mes + resumo.ano));

  return partes.join(" ");
}

// ======================================================================
// HELPERS DE EXPORT
// ======================================================================

export { mesAnterior };
