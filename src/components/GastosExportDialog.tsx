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
  toCSV,
  type ExportColumn,
  type ExportRow,
} from "@/lib/gastos-export";

type Formato = "xlsx" | "csv" | "pdf";
type Escopo = "filtrados" | "periodo";

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
        const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
          import("jspdf"),
          import("jspdf-autotable"),
        ]);
        const doc = new JsPDF({ unit: "pt", format: "a4" });
        doc.setFontSize(16);
        doc.text("GASTO INTELIGENTE", 40, 48);
        doc.setFontSize(12);
        doc.text(`${data.title} — ${data.periodLabel}`, 40, 68);
        doc.setFontSize(10);
        doc.text(
          [
            `${t("export.summary.total")}: ${formatBRL(data.summary.total)}`,
            `${t("export.summary.count")}: ${data.summary.count}`,
            `${t("export.summary.byCategory")}: ${data.topCategoria}`,
          ].join("    "),
          40,
          88,
        );
        autoTable(doc, {
          head: [data.head],
          body: data.body,
          startY: 106,
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [30, 41, 59] },
          columnStyles: { 3: { halign: "right" } },
          margin: { left: 40, right: 40 },
        });
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
