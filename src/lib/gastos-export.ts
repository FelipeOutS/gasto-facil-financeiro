/**
 * Exportação de Gastos — funções puras (sem React, sem I/O).
 *
 * Reutiliza o modelo real de `Gasto` e o motor de recorrência existente
 * (`inferRuleFromISODates`). Somente leitura: nada aqui altera dados.
 */
import type { Gasto, TipoGasto } from "@/lib/types";
import { inferRuleFromISODates, type RecurrenceRule } from "@/lib/recurrence-date";
import { parseDateLocal } from "@/lib/format";

export const EXPORT_COLUMNS = [
  "data",
  "descricao",
  "categoria",
  "estabelecimento",
  "valor",
  "formaPagamento",
  "cartao",
  "mesReferencia",
  "tipo",
  "parcelaRecorrencia",
  "observacao",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export interface ExportRow {
  data: string; // ISO YYYY-MM-DD
  descricao: string;
  categoria: string;
  estabelecimento: string;
  valor: number; // número real, em reais
  formaPagamento: string;
  cartao: string;
  mesReferencia: string; // YYYY-MM
  tipo: string;
  parcelaRecorrencia: string;
  observacao: string;
}

export interface ExportContext {
  categoriaNome: (id: string) => string;
  cartaoNome: (id?: string | null) => string;
  formaPagamentoLabel: (fp: string) => string;
  tipoLabel: (tipo: TipoGasto) => string;
  /** Ex.: "A cada 4 meses" */
  recorrenciaLabel: (rule: RecurrenceRule) => string;
  /** Datas ISO de todas as ocorrências da série (para deduzir a regra). */
  serieDatas?: (recorrenciaId: string) => string[];
}

/** Arredonda para centavos evitando erro de ponto flutuante. */
export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumValores(values: number[]): number {
  return roundCents(values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100);
}

function mesReferenciaOf(g: Gasto): string {
  if (g.invoiceMonth && /^\d{4}-\d{2}$/.test(g.invoiceMonth)) return g.invoiceMonth;
  if (g.ano && g.mes) return `${g.ano}-${String(g.mes).padStart(2, "0")}`;
  const d = parseDateLocal(g.data);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "";
}

function parcelaRecorrenciaOf(g: Gasto, ctx: ExportContext): string {
  if (g.tipoGasto === "parcelado" && g.parcelaAtual && g.totalParcelas) {
    return `${g.parcelaAtual}/${g.totalParcelas}`;
  }
  if (g.tipoGasto === "recorrente" && g.recorrenciaId && ctx.serieDatas) {
    const datas = ctx.serieDatas(g.recorrenciaId);
    if (datas && datas.length >= 2) {
      const rule = inferRuleFromISODates(datas);
      if (rule) return ctx.recorrenciaLabel(rule);
    }
  }
  return "";
}

export function buildExportRows(gastos: Gasto[], ctx: ExportContext): ExportRow[] {
  return gastos.map((g) => ({
    data: g.data,
    descricao: g.descricao ?? "",
    categoria: ctx.categoriaNome(g.categoriaId),
    estabelecimento: g.estabelecimento ?? "",
    valor: roundCents(g.valor ?? 0),
    formaPagamento: ctx.formaPagamentoLabel(g.formaPagamento),
    cartao: g.cartaoId ? ctx.cartaoNome(g.cartaoId) : "",
    mesReferencia: mesReferenciaOf(g),
    tipo: ctx.tipoLabel(g.tipoGasto ?? "unico"),
    parcelaRecorrencia: parcelaRecorrenciaOf(g, ctx),
    observacao: g.observacao ?? "",
  }));
}

export interface ExportSummary {
  count: number;
  total: number;
  media: number;
  maior: number;
  porCategoria: Array<{ nome: string; total: number }>;
}

export function computeSummary(rows: ExportRow[]): ExportSummary {
  const total = sumValores(rows.map((r) => r.valor));
  const acc = new Map<string, number>();
  for (const r of rows) {
    const key = r.categoria || "—";
    acc.set(key, (acc.get(key) ?? 0) + Math.round(r.valor * 100));
  }
  const porCategoria = Array.from(acc.entries())
    .map(([nome, cents]) => ({ nome, total: roundCents(cents / 100) }))
    .sort((a, b) => b.total - a.total);
  return {
    count: rows.length,
    total,
    media: rows.length ? roundCents(total / rows.length) : 0,
    maior: rows.length ? roundCents(Math.max(...rows.map((r) => r.valor))) : 0,
    porCategoria,
  };
}

// ------------------------------------------------------------------
// Nome de arquivo
// ------------------------------------------------------------------

export function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildFileName(periodLabel: string, ext: "xlsx" | "csv" | "pdf"): string {
  const base = `Gasto-Inteligente_Gastos_${periodLabel || "todos"}`;
  return `${sanitizeFileName(base)}.${ext}`;
}

// ------------------------------------------------------------------
// CSV (pt-BR: separador ";", decimal ",", BOM UTF-8)
// ------------------------------------------------------------------

function csvCell(value: string): string {
  const needsQuote = /[";\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function formatDateBRSafe(iso: string): string {
  const d = parseDateLocal(iso);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function toCSV(
  rows: ExportRow[],
  columns: ExportColumn[],
  headers: Record<ExportColumn, string>,
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(headers[c])).join(";"));
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          if (c === "valor") return csvCell(r.valor.toFixed(2).replace(".", ","));
          if (c === "data") return csvCell(formatDateBRSafe(r.data));
          return csvCell(String(r[c] ?? ""));
        })
        .join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ------------------------------------------------------------------
// XLSX — valores numéricos e datas reais
// ------------------------------------------------------------------

export interface XlsxMeta {
  appName: string;
  reportTitle: string;
  periodLabel: string;
  generatedAtLabel: string;
  sheetGastos: string;
  sheetResumo: string;
  resumo: {
    periodo: string;
    quantidade: string;
    total: string;
    media: string;
    maior: string;
    porCategoria: string;
    categoria: string;
    valor: string;
  };
}

const MONEY_FMT = 'R$ #,##0.00;[Red]-R$ #,##0.00;"-"';
const DATE_FMT = "dd/mm/yyyy";

export async function buildXlsxArrayBuffer(
  rows: ExportRow[],
  columns: ExportColumn[],
  headers: Record<ExportColumn, string>,
  meta: XlsxMeta,
): Promise<ArrayBuffer> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();

  // Aba 1 — Gastos (cabeçalho de apresentação + tabela)
  const aoa: unknown[][] = [
    [meta.appName],
    [meta.reportTitle],
    [`${meta.resumo.periodo}: ${meta.periodLabel}`],
    [meta.generatedAtLabel],
    [],
    columns.map((c) => headers[c]),
  ];
  const headerRowIndex = aoa.length - 1;
  for (const r of rows) {
    aoa.push(
      columns.map((c) => {
        if (c === "valor") return r.valor;
        if (c === "data") return parseDateLocal(r.data) ?? "";
        return r[c] ?? "";
      }),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws["!cols"] = columns.map((c) => ({ wch: c === "descricao" || c === "observacao" ? 28 : 16 }));

  const valorIdx = columns.indexOf("valor");
  const dataIdx = columns.indexOf("data");
  for (let i = 0; i < rows.length; i++) {
    const row = headerRowIndex + 1 + i;
    if (valorIdx >= 0) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: valorIdx })];
      if (cell) {
        cell.t = "n";
        cell.z = MONEY_FMT;
      }
    }
    if (dataIdx >= 0) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: dataIdx })];
      if (cell && cell.v instanceof Date) {
        cell.t = "d";
        cell.z = DATE_FMT;
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, meta.sheetGastos);

  // Aba 2 — Resumo
  const s = computeSummary(rows);
  const resumoAoa: unknown[][] = [
    [meta.appName],
    [meta.reportTitle],
    [],
    [meta.resumo.periodo, meta.periodLabel],
    [meta.resumo.quantidade, s.count],
    [meta.resumo.total, s.total],
    [meta.resumo.media, s.media],
    [meta.resumo.maior, s.maior],
    [],
    [meta.resumo.porCategoria],
    [meta.resumo.categoria, meta.resumo.valor],
  ];
  const firstCatRow = resumoAoa.length;
  for (const c of s.porCategoria) resumoAoa.push([c.nome, c.total]);
  const ws2 = XLSX.utils.aoa_to_sheet(resumoAoa);
  ws2["!cols"] = [{ wch: 28 }, { wch: 18 }];
  for (const row of [5, 6, 7]) {
    const cell = ws2[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (cell) {
      cell.t = "n";
      cell.z = MONEY_FMT;
    }
  }
  for (let i = 0; i < s.porCategoria.length; i++) {
    const cell = ws2[XLSX.utils.encode_cell({ r: firstCatRow + i, c: 1 })];
    if (cell) {
      cell.t = "n";
      cell.z = MONEY_FMT;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, meta.sheetResumo);

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// ------------------------------------------------------------------
// PDF — dados preparados (renderização fica na camada de UI)
// ------------------------------------------------------------------

export interface PdfData {
  title: string;
  periodLabel: string;
  summary: ExportSummary;
  topCategoria: string;
  head: string[];
  body: string[][];
}

export function buildPdfData(
  rows: ExportRow[],
  headers: Record<ExportColumn, string>,
  title: string,
  periodLabel: string,
): PdfData {
  const summary = computeSummary(rows);
  return {
    title,
    periodLabel,
    summary,
    topCategoria: summary.porCategoria[0]?.nome ?? "—",
    head: [headers.data, headers.descricao, headers.categoria, headers.valor],
    body: rows.map((r) => [
      formatDateBRSafe(r.data),
      r.descricao || r.estabelecimento || "—",
      r.categoria,
      r.valor.toFixed(2).replace(".", ","),
    ]),
  };
}

// ------------------------------------------------------------------
// Resumo por categoria (PDF) — total, percentual e ordenação
// ------------------------------------------------------------------

export interface CategoryBreakdownItem {
  nome: string;
  total: number;
  /** Percentual do total do período (1 casa decimal). */
  pct: number;
}

/** Categorias ordenadas do maior para o menor, com percentual do total. */
export function computeCategoryBreakdown(rows: ExportRow[]): CategoryBreakdownItem[] {
  const { porCategoria, total } = computeSummary(rows);
  return porCategoria.map((c) => ({
    nome: c.nome,
    total: c.total,
    pct: total > 0 ? Math.round((c.total / total) * 1000) / 10 : 0,
  }));
}

/** Rótulo "Página X de Y". */
export function buildPageLabel(page: number, totalPages: number, pageWord = "Página", ofWord = "de"): string {
  return `${pageWord} ${page} ${ofWord} ${Math.max(totalPages, 1)}`;
}
