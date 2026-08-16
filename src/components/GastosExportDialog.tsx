import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Gasto, TipoGasto } from "@/lib/types";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { getCartoes, getCategoriaById, getGastos } from "@/lib/store";
import { formatBRL } from "@/lib/format";
import type { RecurrenceRule } from "@/lib/recurrence-date";
import {
  EXPORT_COLUMNS,
  buildExportRows,
  buildFileName,
  buildPdfData,
  buildXlsxArrayBuffer,
  computeSummary,
  formatDateBRSafe,
  toCSV,
  type ExportColumn,
  type ExportRow,
} from "@/lib/gastos-export";

type Formato = "xlsx" | "csv" | "pdf";
type Escopo = "filtrados" | "periodo";

const LOGO_URL = "/logos/brand/gasto-inteligente-symbol-white.png";

/** Carrega o logo oficial como data URL para embutir no PDF (falha silenciosa). */
async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


export interface GastosExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gastos exatamente como estão filtrados/ordenados na tela. */
  filtrados: Gasto[];
  /** Gastos do período selecionado, sem os filtros secundários. */
  doPeriodo: Gasto[];
  /** Rótulo legível do período (ex.: "Maio de 2026"). */
  periodLabel: string;
}

export function GastosExportDialog({
  open,
  onOpenChange,
  filtrados,
  doPeriodo,
  periodLabel,
}: GastosExportDialogProps) {
  const { t } = useTranslation("gastos");
  const { t: tCommon } = useTranslation("common");
  const [formato, setFormato] = useState<Formato>("xlsx");
  const [escopo, setEscopo] = useState<Escopo>("filtrados");
  const [gerando, setGerando] = useState(false);

  const selecionados = escopo === "filtrados" ? filtrados : doPeriodo;

  const headers = useMemo(
    () =>
      EXPORT_COLUMNS.reduce(
        (acc, c) => {
          acc[c] = t(`export.columns.${c}`);
          return acc;
        },
        {} as Record<ExportColumn, string>,
      ),
    [t],
  );

  const rows = useMemo<ExportRow[]>(() => {
    const cartoes = getCartoes();
    return buildExportRows(selecionados, {
      categoriaNome: (id) => getCategoriaById(id)?.nome ?? t("item.otherCategory"),
      cartaoNome: (id) => {
        const c = cartoes.find((x) => x.id === id);
        if (!c) return "";
        return c.banco && c.banco !== c.nome ? `${c.nome} (${c.banco})` : c.nome;
      },
      formaPagamentoLabel: (fp) =>
        t(`pagamento.${fp}`, {
          defaultValue: FORMAS_PAGAMENTO.find((f) => f.id === fp)?.label ?? fp,
        }),
      tipoLabel: (tipo: TipoGasto) =>
        tipo === "parcelado"
          ? t("form.tipoParcelado")
          : tipo === "recorrente"
            ? t("form.tipoRecorrente")
            : t("form.tipoUnico"),
      recorrenciaLabel: (rule: RecurrenceRule) =>
        `${tCommon("recurrence.every")} ${rule.interval} ${tCommon(`recurrence.unit.${rule.unit}`, { count: rule.interval })}`,
      serieDatas: (recorrenciaId) =>
        getGastos()
          .filter((g) => g.recorrenciaId === recorrenciaId)
          .map((g) => g.data),
    });
  }, [selecionados, t, tCommon]);

  const summary = useMemo(() => computeSummary(rows), [rows]);

  async function handleExport() {
    if (gerando) return;
    if (rows.length === 0) {
      toast.error(t("export.empty"));
      return;
    }
    setGerando(true);
    const toastId = toast.loading(t("export.generating"));
    try {
      const columns = [...EXPORT_COLUMNS];
      if (formato === "csv") {
        const csv = toCSV(rows, columns, headers);
        downloadBlob(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          buildFileName(periodLabel, "csv"),
        );
      } else if (formato === "xlsx") {
        const buf = await buildXlsxArrayBuffer(rows, columns, headers, {
          appName: "Gasto Inteligente",
          reportTitle: t("export.reportTitle"),
          periodLabel,
          generatedAtLabel: `${t("export.generatedAt")}: ${new Date().toLocaleDateString("pt-BR")}`,
          sheetGastos: t("export.sheetGastos"),
          sheetResumo: t("export.sheetResumo"),
          resumo: {
            periodo: t("export.summary.period"),
            quantidade: t("export.summary.count"),
            total: t("export.summary.total"),
            media: t("export.summary.avg"),
            maior: t("export.summary.max"),
            porCategoria: t("export.summary.byCategory"),
            categoria: t("export.columns.categoria"),
            valor: t("export.columns.valor"),
          },
        });
        downloadBlob(
          new Blob([buf], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          buildFileName(periodLabel, "xlsx"),
        );
      } else {
        const data = buildPdfData(rows, headers, t("export.reportTitle"), periodLabel);
        const breakdown = computeCategoryBreakdown(rows);
        const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
          import("jspdf"),
          import("jspdf-autotable"),
        ]);
        const doc = new JsPDF({ unit: "pt", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 40;
        const BRAND: [number, number, number] = [32, 170, 108];
        const BRAND_SOFT: [number, number, number] = [214, 236, 226];
        const INK: [number, number, number] = [30, 41, 59];
        const MUTED: [number, number, number] = [100, 112, 128];

        const logo = await loadLogoDataUrl();
        const now = new Date();
        const geradoEm = `${now.toLocaleDateString("pt-BR")} ${t("export.at", { defaultValue: "às" })} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
        const HEADER_H = 100;

        const drawHeader = () => {
          doc.setFillColor(...BRAND);
          doc.rect(0, 0, pageW, HEADER_H, "F");
          if (logo) {
            try {
              doc.addImage(logo, "PNG", M, 26, 40, 40);
            } catch {
              /* logo opcional */
            }
          }
          const tx = logo ? M + 54 : M;
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.text("GASTO INTELIGENTE", tx, 38);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(17);
          doc.text(data.title, tx, 60);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.text(`${t("export.summary.period")}: ${periodLabel}`, tx, 78);
          doc.setFontSize(9);
          doc.text(`${t("export.generatedAt")}: ${geradoEm}`, pageW - M, 78, { align: "right" });
        };

        // Cards de resumo
        const cards: Array<{ label: string; value: string }> = [
          { label: t("export.summary.total"), value: formatBRL(data.summary.total) },
          {
            label: t("export.summary.entries", { defaultValue: "Lançamentos" }),
            value: String(data.summary.count),
          },
          {
            label: t("export.summary.topCategory", { defaultValue: "Categoria principal" }),
            value: data.topCategoria,
          },
          { label: t("export.summary.avg"), value: formatBRL(data.summary.media) },
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
          const value = doc.splitTextToSize(c.value, cardW - 20)[0] ?? "";
          doc.text(value, x + 10, cardY + 41);
        });

        const head = [
          [
            headers.data,
            headers.descricao,
            headers.categoria,
            headers.estabelecimento,
            headers.formaPagamento,
            headers.valor,
          ],
        ];
        const body = rows.map((r) => [
          formatDateBRSafe(r.data),
          r.descricao || "—",
          r.categoria || "—",
          r.estabelecimento || "—",
          r.formaPagamento || "—",
          formatBRL(r.valor),
        ]);

        autoTable(doc, {
          head,
          body,
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
            3: { cellWidth: 88 },
            4: { cellWidth: 66 },
            5: { cellWidth: 76, halign: "right", fontStyle: "bold" },
          },
          didDrawPage: (hook) => {
            if ((hook.pageNumber ?? 1) > 1) drawHeader();
          },
        });

        // Seção: Gastos por categoria (com barras proporcionais)
        if (breakdown.length > 0) {
          const lastY =
            (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
            cardY + cardH + 24;
          const rowH = 22;
          const needed = 34 + breakdown.length * rowH;
          let y = lastY + 28;
          if (y + needed > pageH - 70) {
            doc.addPage();
            drawHeader();
            y = HEADER_H + 32;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(...INK);
          doc.text(
            t("export.summary.byCategoryTitle", { defaultValue: t("export.summary.byCategory") }),
            M,
            y,
          );
          doc.setDrawColor(...BRAND_SOFT);
          doc.line(M, y + 6, pageW - M, y + 6);
          y += 22;

          const maxTotal = breakdown[0]?.total || 1;
          const nameW = 130;
          const valueW = 90;
          const pctW = 48;
          const barX = M + nameW + 8;
          const barW = pageW - M - valueW - pctW - barX - 8;
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
            doc.text(formatBRL(c.total), pageW - M - pctW - 8, cy + 3, { align: "right" });
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

        // Rodapé em todas as páginas com "Página X de Y"
        const totalPages = doc.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          doc.setDrawColor(226, 232, 240);
          doc.line(M, pageH - 48, pageW - M, pageH - 48);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(...MUTED);
          doc.text(
            `${t("export.footerBy", { defaultValue: "Gerado por Gasto Inteligente" })}  •  ${geradoEm}  •  ${buildPageLabel(
              p,
              totalPages,
              t("export.page", { defaultValue: "Página" }),
              t("export.pageOf", { defaultValue: "de" }),
            )}`,
            pageW / 2,
            pageH - 30,
            { align: "center" },
          );
        }
        doc.save(buildFileName(periodLabel, "pdf"));
      }

      toast.success(t("export.ready"), { id: toastId });
      onOpenChange(false);
    } catch (err) {
      console.error("[gastos-export]", err);
      toast.error(t("export.error"), { id: toastId });
    } finally {
      setGerando(false);
    }
  }

  const formatos: Array<{ id: Formato; label: string; icon: typeof FileSpreadsheet }> = [
    { id: "xlsx", label: t("export.format.xlsx"), icon: FileSpreadsheet },
    { id: "csv", label: t("export.format.csv"), icon: FileType2 },
    { id: "pdf", label: t("export.format.pdf"), icon: FileText },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("export.title")}</DialogTitle>
          <DialogDescription>{t("export.description", { period: periodLabel })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label className="text-xs text-muted-foreground">{t("export.formatLabel")}</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {formatos.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormato(id)}
                  className={cn(
                    "flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition-colors",
                    formato === id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-accent",
                  )}
                  aria-pressed={formato === id}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t("export.scopeLabel")}</Label>
            <RadioGroup
              value={escopo}
              onValueChange={(v) => setEscopo(v as Escopo)}
              className="mt-2 space-y-2"
            >
              <label className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
                <RadioGroupItem value="filtrados" />
                <span>{t("export.scope.filtered", { count: filtrados.length })}</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
                <RadioGroupItem value="periodo" />
                <span>{t("export.scope.period", { count: doPeriodo.length })}</span>
              </label>
            </RadioGroup>
          </div>

          <div className="rounded-2xl border border-border bg-card-elevated/60 p-3 text-sm">
            <p className="text-muted-foreground text-xs">{t("export.previewLabel")}</p>
            <p className="mt-1 font-semibold">
              {t("export.previewValue", {
                count: summary.count,
                total: formatBRL(summary.total),
              })}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-full">
            {t("bulk.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={gerando} className="rounded-full font-semibold">
            {gerando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("export.cta")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
