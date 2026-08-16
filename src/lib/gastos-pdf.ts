/**
 * Renderização do PDF de Gastos (layout puro, sem React).
 * Recebe as libs por parâmetro para permitir teste/QA fora do navegador.
 */
import { formatBRL } from "@/lib/format";
import {
  buildPageLabel,
  buildPdfData,
  computeCategoryBreakdown,
  formatDateBRSafe,
  type ExportColumn,
  type ExportRow,
} from "@/lib/gastos-export";

export interface PdfLabels {
  reportTitle: string;
  period: string;
  generatedAt: string;
  total: string;
  entries: string;
  topCategory: string;
  avg: string;
  byCategoryTitle: string;
  footerBy: string;
  page: string;
  pageOf: string;
}

export interface RenderPdfOptions {
  rows: ExportRow[];
  headers: Record<ExportColumn, string>;
  periodLabel: string;
  labels: PdfLabels;
  logoDataUrl?: string | null;
  generatedAtText: string;
  /** Construtor jsPDF (import dinâmico na UI). */
  JsPDF: new (opts: { unit: string; format: string }) => any;
  /** Plugin jspdf-autotable. */
  autoTable: (doc: any, opts: Record<string, unknown>) => void;
}

const BRAND: [number, number, number] = [32, 170, 108];
const BRAND_SOFT: [number, number, number] = [214, 236, 226];
const INK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 112, 128];
const M = 40;
const HEADER_H = 100;

export function renderGastosPdf(opts: RenderPdfOptions) {
  const { rows, headers, periodLabel, labels, logoDataUrl, generatedAtText, JsPDF, autoTable } = opts;
  const data = buildPdfData(rows, headers, labels.reportTitle, periodLabel);
  const breakdown = computeCategoryBreakdown(rows);

  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const drawHeader = () => {
    doc.setFillColor(...BRAND);
    doc.rect(0, 0, pageW, HEADER_H, "F");
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", M, 26, 40, 40);
      } catch {
        /* logo opcional */
      }
    }
    const tx = logoDataUrl ? M + 54 : M;
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("GASTO INTELIGENTE", tx, 38);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(labels.reportTitle, tx, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`${labels.period}: ${periodLabel}`, tx, 78, { maxWidth: pageW - M * 2 - 220 });
    doc.setFontSize(9);
    doc.text(`${labels.generatedAt}: ${generatedAtText}`, pageW - M, 78, { align: "right" });
  };

  const cards = [
    { label: labels.total, value: formatBRL(data.summary.total) },
    { label: labels.entries, value: String(data.summary.count) },
    { label: labels.topCategory, value: data.topCategoria },
    { label: labels.avg, value: formatBRL(data.summary.media) },
  ];
  const gap = 10;
  const cardW = (pageW - M * 2 - gap * (cards.length - 1)) / cards.length;
  const cardY = HEADER_H + 20;
  const cardH = 58;
  drawHeader();
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    doc.setFillColor(246, 250, 248);
    doc.setDrawColor(...BRAND_SOFT);
    doc.roundedRect(x, cardY, cardW, cardH, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(c.label.toUpperCase(), x + 10, cardY + 18, { maxWidth: cardW - 20 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(c.value, cardW - 20)[0] ?? "", x + 10, cardY + 41);
  });

  autoTable(doc, {
    head: [
      [
        headers.data,
        headers.descricao,
        headers.categoria,
        headers.estabelecimento,
        headers.formaPagamento,
        headers.valor,
      ],
    ],
    body: rows.map((r) => [
      formatDateBRSafe(r.data),
      r.descricao || "—",
      r.categoria || "—",
      r.estabelecimento || "—",
      r.formaPagamento || "—",
      formatBRL(r.valor),
    ]),
    startY: cardY + cardH + 24,
    margin: { top: HEADER_H + 20, bottom: 64, left: M, right: M },
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 6.5, bottom: 6.5, left: 5, right: 5 },
      textColor: INK,
      lineColor: [226, 232, 240],
      lineWidth: 0.4,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 78 },
      3: { cellWidth: 84 },
      4: { cellWidth: 66 },
      5: { cellWidth: 76, halign: "right", fontStyle: "bold" },
    },
    didDrawPage: (hook: { pageNumber?: number }) => {
      if ((hook.pageNumber ?? 1) > 1) drawHeader();
    },
  });

  // Seção "Gastos por categoria" — barras proporcionais em tons da marca
  if (breakdown.length > 0) {
    const lastY = doc.lastAutoTable?.finalY ?? cardY + cardH + 24;
    const rowH = 22;
    const needed = 40 + breakdown.length * rowH;
    let y = lastY + 30;
    if (y + needed > pageH - 70) {
      doc.addPage();
      drawHeader();
      y = HEADER_H + 34;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(labels.byCategoryTitle, M, y);
    doc.setDrawColor(...BRAND_SOFT);
    doc.line(M, y + 7, pageW - M, y + 7);
    y += 26;

    const maxTotal = breakdown[0]?.total || 1;
    const nameW = 130;
    const valueW = 84;
    const pctW = 44;
    const barX = M + nameW + 10;
    const barW = pageW - M - valueW - pctW - barX - 10;
    breakdown.forEach((c, i) => {
      const cy = y + i * rowH;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(c.nome, nameW)[0] ?? "", M, cy + 3);
      doc.setFillColor(238, 244, 241);
      doc.roundedRect(barX, cy - 6, barW, 10, 3, 3, "F");
      const w = Math.max(2, (c.total / maxTotal) * barW);
      const shade = Math.min(0.35, i * 0.06);
      doc.setFillColor(
        Math.round(BRAND[0] + (255 - BRAND[0]) * shade),
        Math.round(BRAND[1] + (255 - BRAND[1]) * shade),
        Math.round(BRAND[2] + (255 - BRAND[2]) * shade),
      );
      doc.roundedRect(barX, cy - 6, w, 10, 3, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(formatBRL(c.total), pageW - M - pctW - 10, cy + 3, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(
        `${c.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
        pageW - M,
        cy + 3,
        { align: "right" },
      );
    });
  }

  // Rodapé em todas as páginas — "Página X de Y"
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(M, pageH - 48, pageW - M, pageH - 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      `${labels.footerBy}  •  ${generatedAtText}  •  ${buildPageLabel(p, totalPages, labels.page, labels.pageOf)}`,
      pageW / 2,
      pageH - 30,
      { align: "center" },
    );
  }

  return doc;
}
