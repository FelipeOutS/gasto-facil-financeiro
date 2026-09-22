import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  EXPORT_COLUMNS,
  buildXlsxArrayBuffer,
  toCSV,
  type ExportColumn,
  type ExportRow,
} from "../src/lib/gastos-export";
import { renderGastosPdf, type RenderPdfOptions } from "../src/lib/gastos-pdf";

if (!process.argv[2]) throw new Error("Informe a pasta de fixtures Android como argumento.");
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const rows: ExportRow[] = Array.from({ length: 120 }, (_, index) => ({
  data: "2026-09-13",
  descricao: `Teste sintético ${index + 1}: pão e café`,
  categoria: "Alimentação",
  estabelecimento: "Loja de teste",
  valor: 12.34,
  formaPagamento: "Pix",
  cartao: "",
  mesReferencia: "2026-09",
  tipo: "Único",
  parcelaRecorrencia: "",
  observacao: "Sem dados de clientes; teste de exportação.",
}));
const headers = Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, column])) as Record<
  ExportColumn,
  string
>;
await writeFile(join(output, "relatorio.csv"), toCSV(rows, EXPORT_COLUMNS, headers));
const xlsx = await buildXlsxArrayBuffer(rows, EXPORT_COLUMNS, headers, {
  appName: "Gasto Inteligente",
  reportTitle: "Relatório de teste",
  periodLabel: "Setembro 2026",
  generatedAtLabel: "13/09/2026",
  sheetGastos: "Gastos",
  sheetResumo: "Resumo",
  resumo: {
    periodo: "Período",
    quantidade: "Quantidade",
    total: "Total",
    media: "Média",
    maior: "Maior",
    porCategoria: "Por categoria",
    categoria: "Categoria",
    valor: "Valor",
  },
});
await writeFile(join(output, "relatorio.xlsx"), Buffer.from(xlsx));
const pdf = renderGastosPdf({
  rows,
  headers,
  periodLabel: "Setembro 2026",
  generatedAtText: "13/09/2026",
  JsPDF: jsPDF as unknown as RenderPdfOptions["JsPDF"],
  autoTable: autoTable as unknown as RenderPdfOptions["autoTable"],
  labels: {
    reportTitle: "Relatório de teste",
    period: "Período",
    generatedAt: "Gerado em",
    total: "Total",
    entries: "Lançamentos",
    topCategory: "Categoria principal",
    avg: "Média",
    byCategoryTitle: "Por categoria",
    footerBy: "Gasto Inteligente — dados sintéticos",
    page: "Página",
    pageOf: "de",
  },
});
await writeFile(join(output, "relatorio.pdf"), Buffer.from(pdf.output("arraybuffer")));
console.log("Fixtures CSV, XLSX e PDF geradas com os exportadores atuais do site.");
