import { describe, expect, it } from "bun:test";
import * as XLSX from "@e965/xlsx";
import {
  EXPORT_COLUMNS,
  buildExportRows,
  buildFileName,
  buildPageLabel,
  buildPdfData,
  buildXlsxArrayBuffer,
  computeCategoryBreakdown,
  computeSummary,
  sanitizeFileName,
  sumValores,
  toCSV,
  type ExportColumn,
} from "../src/lib/gastos-export";
import type { Gasto } from "../src/lib/types";
import { formatBRL } from "../src/lib/format";

const headers = EXPORT_COLUMNS.reduce(
  (acc, c) => {
    acc[c] = c;
    return acc;
  },
  {} as Record<ExportColumn, string>,
);

function gasto(p: Partial<Gasto>): Gasto {
  return {
    id: p.id ?? crypto.randomUUID(),
    descricao: "Mercado",
    valor: 100,
    data: "2026-05-10",
    estabelecimento: "Loja",
    categoriaId: "alimentacao",
    formaPagamento: "pix",
    mes: 5,
    ano: 2026,
    confirmado: true,
    tipoGasto: "unico",
    criadoEm: "2026-05-10",
    atualizadoEm: "2026-05-10",
    ...p,
  } as Gasto;
}

const ctx = {
  categoriaNome: (id: string) => (id === "saude" ? "Saúde" : "Alimentação"),
  cartaoNome: () => "Nubank (Nubank)",
  formaPagamentoLabel: (fp: string) => fp,
  tipoLabel: (t: string) => t,
  recorrenciaLabel: (r: { interval: number; unit: string }) => `A cada ${r.interval} ${r.unit}`,
  serieDatas: (id: string) =>
    id === "rec1" ? ["2026-01-10", "2026-05-10", "2026-09-10"] : ["2026-01-10"],
};

describe("gastos-export", () => {
  it("mapeia colunas reais do modelo", () => {
    const rows = buildExportRows([gasto({ observacao: "obs", cartaoId: "c1" })], ctx);
    expect(rows[0]).toMatchObject({
      data: "2026-05-10",
      categoria: "Alimentação",
      valor: 100,
      mesReferencia: "2026-05",
      cartao: "Nubank (Nubank)",
      observacao: "obs",
    });
    expect(JSON.stringify(rows[0])).not.toContain("user_id");
  });

  it("representa único, parcelado e recorrente", () => {
    const rows = buildExportRows(
      [
        gasto({ tipoGasto: "unico" }),
        gasto({ tipoGasto: "parcelado", parcelaAtual: 3, totalParcelas: 12 }),
        gasto({ tipoGasto: "recorrente", recorrenciaId: "rec1" }),
      ],
      ctx,
    );
    expect(rows[0].parcelaRecorrencia).toBe("");
    expect(rows[1].parcelaRecorrencia).toBe("3/12");
    expect(rows[2].parcelaRecorrencia).toBe("A cada 4 mes");
  });

  it("soma valores sem erro de ponto flutuante", () => {
    expect(sumValores([100, 250.5, 49.5])).toBe(400);
    expect(sumValores([0.1, 0.2])).toBe(0.3);
  });

  it("resumo com total, média, maior e categorias", () => {
    const rows = buildExportRows(
      [
        gasto({ valor: 100 }),
        gasto({ valor: 250.5 }),
        gasto({ valor: 49.5, categoriaId: "saude" }),
      ],
      ctx,
    );
    const s = computeSummary(rows);
    expect(s.count).toBe(3);
    expect(s.total).toBe(400);
    expect(s.media).toBe(133.33);
    expect(s.maior).toBe(250.5);
    expect(s.porCategoria[0]).toEqual({ nome: "Alimentação", total: 350.5 });
  });

  it("CSV pt-BR com BOM, ';' e acentos preservados", () => {
    const rows = buildExportRows([gasto({ descricao: 'Café "especial"; caro', valor: 12.3 })], ctx);
    const csv = toCSV(rows, [...EXPORT_COLUMNS], headers);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"Café ""especial""; caro"');
    expect(line).toContain("12,30");
    expect(line).toContain("10/05/2026");
  });

  it("XLSX tem duas abas, valores numéricos e datas reais", async () => {
    const rows = buildExportRows([gasto({ valor: 250.5 }), gasto({ valor: 149.5 })], ctx);
    const buf = await buildXlsxArrayBuffer(rows, [...EXPORT_COLUMNS], headers, {
      appName: "Gasto Inteligente",
      reportTitle: "Relatório de Gastos",
      periodLabel: "Maio de 2026",
      generatedAtLabel: "Gerado em: 12/08/2026",
      sheetGastos: "Gastos",
      sheetResumo: "Resumo",
      resumo: {
        periodo: "Período",
        quantidade: "Quantidade de gastos",
        total: "Total gasto",
        media: "Média por gasto",
        maior: "Maior gasto",
        porCategoria: "Gastos por categoria",
        categoria: "Categoria",
        valor: "Valor",
      },
    });
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
    expect(wb.SheetNames).toEqual(["Gastos", "Resumo"]);
    const ws = wb.Sheets["Gastos"];
    const valorCol = EXPORT_COLUMNS.indexOf("valor");
    const dataCol = EXPORT_COLUMNS.indexOf("data");
    const valorCell = ws[XLSX.utils.encode_cell({ r: 6, c: valorCol })];
    expect(valorCell.t).toBe("n");
    expect(valorCell.v).toBe(250.5);
    const dataCell = ws[XLSX.utils.encode_cell({ r: 6, c: dataCol })];
    expect(dataCell.t).toBe("d");
    const resumo = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Resumo"], { header: 1 });
    expect(resumo.flat()).toContain(400);
  });

  it("PDF usa versão resumida com 4 colunas", () => {
    const rows = buildExportRows(
      Array.from({ length: 120 }, (_, i) => gasto({ valor: 10, data: "2026-05-01", id: `g${i}` })),
      ctx,
    );
    const data = buildPdfData(rows, headers, "Relatório de Gastos", "Maio de 2026");
    expect(data.head).toHaveLength(4);
    expect(data.body).toHaveLength(120);
    expect(data.summary.total).toBe(1200);
    expect(data.topCategoria).toBe("Alimentação");
  });

  it("período sem gastos gera resumo vazio (UI bloqueia o download)", () => {
    const s = computeSummary([]);
    expect(s.count).toBe(0);
    expect(s.total).toBe(0);
    expect(s.porCategoria).toEqual([]);
  });

  it("nome de arquivo sanitizado", () => {
    expect(buildFileName("Maio de 2026", "xlsx")).toBe(
      "Gasto-Inteligente_Gastos_Maio-de-2026.xlsx",
    );
    expect(sanitizeFileName("01/08/2026 a 31/08/2026")).toBe("01-08-2026-a-31-08-2026");
  });
});

describe("gastos-export — PDF refinado", () => {
  it("categoria principal é a de maior gasto", () => {
    const rows = buildExportRows(
      [gasto({ valor: 100 }), gasto({ valor: 400, categoriaId: "saude" })],
      ctx,
    );
    const data = buildPdfData(rows, headers, "Relatório de Gastos", "Agosto de 2026");
    expect(data.topCategoria).toBe("Saúde");
  });

  it("resumo por categoria: ordenação, total e percentual", () => {
    const rows = buildExportRows(
      [gasto({ valor: 100 }), gasto({ valor: 300, categoriaId: "saude" })],
      ctx,
    );
    const b = computeCategoryBreakdown(rows);
    expect(b.map((c) => c.nome)).toEqual(["Saúde", "Alimentação"]);
    expect(b[0]).toEqual({ nome: "Saúde", total: 300, pct: 75 });
    expect(b[1].pct).toBe(25);
    expect(b.reduce((a, c) => a + c.pct, 0)).toBe(100);
  });

  it("uma única categoria fica com 100%", () => {
    const b = computeCategoryBreakdown(buildExportRows([gasto({ valor: 25 })], ctx));
    expect(b).toEqual([{ nome: "Alimentação", total: 25, pct: 100 }]);
  });

  it("sem gastos não há categorias", () => {
    expect(computeCategoryBreakdown([])).toEqual([]);
  });

  it("Página X de Y", () => {
    expect(buildPageLabel(1, 1)).toBe("Página 1 de 1");
    expect(buildPageLabel(2, 3)).toBe("Página 2 de 3");
    expect(buildPageLabel(1, 0)).toBe("Página 1 de 1");
    expect(buildPageLabel(1, 2, "Page", "of")).toBe("Page 1 of 2");
  });

  it("dados opcionais ausentes não vazam textos técnicos", () => {
    const rows = buildExportRows(
      [gasto({ estabelecimento: undefined, observacao: undefined, cartaoId: undefined })],
      ctx,
    );
    const s = JSON.stringify(rows[0]);
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
    expect(s).not.toContain("NaN");
    expect(rows[0].estabelecimento).toBe("");
  });

  it("valores grandes preservam formatação brasileira", () => {
    const rows = buildExportRows([gasto({ valor: 120000 }), gasto({ valor: 10500.9 })], ctx);
    expect(formatBRL(rows[0].valor)).toContain("120.000,00");
    expect(formatBRL(rows[1].valor)).toContain("10.500,90");
  });
});
