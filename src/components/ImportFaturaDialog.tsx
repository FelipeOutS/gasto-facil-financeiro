import { apiFetch } from "@/lib/api-fetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { usePremiumApiGate } from "@/lib/premium-errors";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import {
  ImageIcon,
  FileSpreadsheet,
  FileText,
  Upload,
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  addGastosBulk,
  findDuplicateGastoAdvanced,
  normalizeDescricao,
  getCartoes,
  getCategorias,
  lotesImportacaoTodos,
  gastosDoLote,
  deleteGastosDoLote,
  useStore,
} from "@/lib/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateBR } from "@/lib/format";
import type { Cartao } from "@/lib/types";
import {
  parseCsvFile,
  rowsToItens,
  suggestCategoryFromDescription,
  type FaturaItemBruto,
  type CsvColumnRole,
} from "@/lib/csv-fatura";

type Step =
  | "source"
  | "image-upload"
  | "pdf-upload"
  | "csv-upload"
  | "csv-mapping"
  | "review";

type DupStatus = "novo" | "duplicado_lote" | "duplicado_existente";

type ReviewItem = FaturaItemBruto & {
  id: string;
  cartaoId: string;
  selecionado: boolean;
  /** Mantido por compatibilidade — true quando há qualquer suspeita. */
  duplicado: boolean;
  dupStatus: DupStatus;
};

const COL_LABEL_KEYS: Record<CsvColumnRole, string> = {
  data: "mapping.labels.data",
  descricao: "mapping.labels.descricao",
  estabelecimento: "mapping.labels.estabelecimento",
  valor: "mapping.labels.valor",
  categoria: "mapping.labels.categoria",
  parcela: "mapping.labels.parcela",
  totalParcelas: "mapping.labels.totalParcelas",
  observacao: "mapping.labels.observacao",
  ignorar: "mapping.labels.ignorar",
};

const COL_OPTIONS: CsvColumnRole[] = [
  "ignorar",
  "data",
  "descricao",
  "estabelecimento",
  "valor",
  "categoria",
  "parcela",
  "totalParcelas",
  "observacao",
];

export function ImportFaturaDialog({
  open,
  onOpenChange,
  cartaoIdInicial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cartaoIdInicial?: string;
}) {
  const { t } = useTranslation("import-fatura");
  const { t: tc } = useTranslation("common");
  const premiumGate = usePremiumApiGate();
  const cartoes = useStore(() => getCartoes());
  const categorias = useStore(() => getCategorias());

  const [step, setStep] = useState<Step>("source");
  const [cartaoId, setCartaoId] = useState<string | undefined>(
    cartaoIdInicial ?? cartoes[0]?.id,
  );

  // Imagem
  const [images, setImages] = useState<string[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgStage, setImgStage] = useState(0);
  const imgStageRef = useRef<number | null>(null);

  // PDF
  const [pdfFile, setPdfFile] = useState<{ name: string; dataUri: string; size: number } | null>(
    null,
  );
  const [pdfLoading, setPdfLoading] = useState(false);

  // CSV
  const [csvText, setCsvText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvMap, setCsvMap] = useState<CsvColumnRole[]>([]);

  // Revisão
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [origem, setOrigem] = useState<"fatura_imagem" | "fatura_pdf" | "fatura_csv" | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Mês da fatura (YYYY-MM) — fonte da verdade para "em qual fatura entram esses gastos"
  const [invoiceMonth, setInvoiceMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Reset ao reabrir
  useEffect(() => {
    if (!open) return;
    setStep("source");
    setImages([]);
    setImgLoading(false);
    setImgStage(0);
    setPdfFile(null);
    setPdfLoading(false);
    setCsvText("");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMap([]);
    setItems([]);
    setOrigem(null);
    setSaving(false);
    setErrorMessage(null);
    setCartaoId(cartaoIdInicial ?? cartoes[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartaoIdInicial]);

  // Animação de etapas durante o OCR
  useEffect(() => {
    if (!imgLoading) {
      if (imgStageRef.current !== null) {
        window.clearInterval(imgStageRef.current);
        imgStageRef.current = null;
      }
      return;
    }
    imgStageRef.current = window.setInterval(() => {
      setImgStage((s) => (s + 1) % 4);
    }, 1100);
    return () => {
      if (imgStageRef.current !== null) {
        window.clearInterval(imgStageRef.current);
        imgStageRef.current = null;
      }
    };
  }, [imgLoading]);

  /* ---------- Helpers ---------- */

  const buildReviewFromItens = useCallback(
    (brutos: FaturaItemBruto[], cartao: string | undefined) => {
      const cId = cartao ?? "";
      const seenKeys = new Map<string, number>(); // key -> primeiro índice
      const out: ReviewItem[] = [];
      brutos.forEach((it, i) => {
        const desc = it.descricao || it.estabelecimento || "";
        const sugerida =
          it.categoriaSugerida ||
          (desc ? suggestCategoryFromDescription(desc) : "outros");

        // Chave de deduplicação intra-lote (normalizada)
        const key = [
          cId,
          it.data ?? "",
          (it.valor ?? 0).toFixed(2),
          normalizeDescricao(desc),
          it.horario ?? "",
        ].join("|");

        let dupStatus: DupStatus = "novo";
        if (it.valor !== null && it.data) {
          if (seenKeys.has(key)) {
            dupStatus = "duplicado_lote";
          } else {
            seenKeys.set(key, i);
            const existente = findDuplicateGastoAdvanced({
              valor: it.valor,
              data: it.data,
              descricao: desc,
              estabelecimento: it.estabelecimento ?? undefined,
              cartaoId: cId || undefined,
              horario: it.horario ?? undefined,
            });
            if (existente) dupStatus = "duplicado_existente";
          }
        }

        out.push({
          ...it,
          descricao: desc,
          categoriaSugerida: sugerida,
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          cartaoId: cId,
          // Itens duplicados começam DESMARCADOS para o usuário decidir
          selecionado: dupStatus === "novo",
          duplicado: dupStatus !== "novo",
          dupStatus,
        });
      });
      return out;
    },
    [],
  );

  /* ---------- Imagem ---------- */

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).slice(0, 10);
    const dataUrls = await Promise.all(
      arr.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          }),
      ),
    );
    setImages(dataUrls);
  }

  async function processarImagem() {
    if (images.length === 0) return;
    setErrorMessage(null);
    setImgLoading(true);
    setImgStage(0);
    try {
      const resp = await apiFetch("/api/import-fatura-imagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (
          premiumGate.handleResponse(resp, data, {
            title: tc("premium.premiumApi.importFatura.title"),
            description: tc("premium.premiumApi.importFatura.description"),
            fallbackFeature: "importar_fatura",
          })
        ) {
          setImgLoading(false);
          return;
        }
        const msg =
          data?.error ||
          t("errorReadingImage");
        setErrorMessage(msg);
        toast.error(msg);
        setImgLoading(false);
        return;
      }
      const itens = Array.isArray(data?.itens)
        ? (data.itens as FaturaItemBruto[])
        : [];
      if (itens.length === 0) {
        const msg =
          t("errorReadingImage");
        setErrorMessage(msg);
        toast.error(msg);
        setImgLoading(false);
        return;
      }
      setItems(buildReviewFromItens(itens, cartaoId));
      setOrigem("fatura_imagem");
      setImgLoading(false);
      setStep("review");
    } catch (err) {
      console.error(err);
      const msg =
        t("errorReadingImage");
      setErrorMessage(msg);
      toast.error(msg);
      setImgLoading(false);
    }
  }

  /* ---------- PDF ---------- */

  async function handlePdfFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setErrorMessage(null);
    if (!/\.pdf$|application\/pdf/i.test(file.type || file.name)) {
      const msg = t("errorNeedPdf");
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      const msg = t("errorPdfTooBig");
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setPdfFile({ name: file.name, dataUri, size: file.size });
  }

  async function processarPdf() {
    if (!pdfFile) return;
    setErrorMessage(null);
    setPdfLoading(true);
    try {
      const resp = await apiFetch("/api/import-fatura-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf: pdfFile.dataUri }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (
          premiumGate.handleResponse(resp, data, {
            title: tc("premium.premiumApi.importFatura.title"),
            description: tc("premium.premiumApi.importFatura.description"),
            fallbackFeature: "importar_fatura",
          })
        ) {
          setPdfLoading(false);
          return;
        }
        const msg = data?.error || t("errorReadingPdf");
        setErrorMessage(msg);
        toast.error(msg);
        setPdfLoading(false);
        return;
      }
      const itens = Array.isArray(data?.itens) ? (data.itens as FaturaItemBruto[]) : [];
      if (itens.length === 0) {
        const msg =
          t("errorNoMovements");
        setErrorMessage(msg);
        toast.error(msg);
        setPdfLoading(false);
        return;
      }
      setItems(buildReviewFromItens(itens, cartaoId));
      setOrigem("fatura_pdf");
      setPdfLoading(false);
      setStep("review");
    } catch (err) {
      console.error(err);
      const msg = t("errorReadingPdfRetry");
      setErrorMessage(msg);
      toast.error(msg);
      setPdfLoading(false);
    }
  }


  async function handleCsvFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setErrorMessage(null);
    const text = await file.text();
    setCsvText(text);
    const parsed = parseCsvFile(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      const msg =
        t("errorCsvUnknown");
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setCsvMap(parsed.autoMap);
    // Se já reconheceu valor + data, pula direto pra revisão
    const hasValor = parsed.autoMap.includes("valor");
    const hasData = parsed.autoMap.includes("data");
    if (hasValor && hasData) {
      const itens = rowsToItens(parsed.rows, parsed.autoMap);
      setItems(buildReviewFromItens(itens, cartaoId));
      setOrigem("fatura_csv");
      setStep("review");
    } else {
      setStep("csv-mapping");
    }
  }

  function aplicarMapping() {
    if (!csvMap.includes("valor") || !csvMap.includes("data")) {
      const msg =
        t("errorCsvUnknown");
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    const itens = rowsToItens(csvRows, csvMap);
    setItems(buildReviewFromItens(itens, cartaoId));
    setOrigem("fatura_csv");
    setStep("review");
  }

  /* ---------- Revisão ---------- */

  const totalSelecionados = useMemo(
    () => items.filter((i) => i.selecionado).length,
    [items],
  );
  const totalValor = useMemo(
    () =>
      items
        .filter((i) => i.selecionado && i.valor)
        .reduce((s, i) => s + (i.valor ?? 0), 0),
    [items],
  );
  const prontos = useMemo(
    () =>
      items.filter(
        (i) =>
          i.selecionado &&
          i.valor !== null &&
          i.valor > 0 &&
          !!i.data &&
          !!(i.descricao && i.descricao.trim()) &&
          !!i.cartaoId,
      ).length,
    [items],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<ReviewItem>) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    [],
  );

  function toggleAll(v: boolean) {
    setItems((prev) => prev.map((it) => ({ ...it, selecionado: v })));
  }

  function adicionarLinha() {
    const novo: ReviewItem = {
      id: `${Date.now()}-new-${Math.random().toString(36).slice(2, 6)}`,
      descricao: "",
      estabelecimento: null,
      valor: null,
      data: new Date().toISOString().slice(0, 10),
      horario: null,
      parcelaAtual: null,
      totalParcelas: null,
      categoriaSugerida: "outros",
      confianca: "media",
      observacao: null,
      cartaoId: cartaoId ?? "",
      selecionado: true,
      duplicado: false,
      dupStatus: "novo",
    };
    setItems((prev) => [novo, ...prev]);
  }

  function removerLinha(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function aplicarCartaoEmTodos() {
    if (!cartaoId) return;
    setItems((prev) => prev.map((it) => ({ ...it, cartaoId })));
  }

  async function confirmarImportacao() {
    if (!cartaoId) {
      toast.error(t("errorPickCard"));
      return;
    }
    if (!invoiceMonth || !/^\d{4}-\d{2}$/.test(invoiceMonth)) {
      toast.error(t("errorPickMonth"));
      return;
    }
    const validos = items.filter(
      (i) =>
        i.selecionado &&
        i.valor !== null &&
        i.valor > 0 &&
        !!i.data &&
        !!(i.descricao && i.descricao.trim()),
    );
    if (validos.length === 0) {
      toast.error(t("errorNoneReady"));
      return;
    }
    setSaving(true);
    try {
      // import_batch_id único para essa fatura — permite excluir depois pelo lote.
      const batchId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const inputs = validos.map((it) => {
        const isParcelado =
          !!it.totalParcelas && it.totalParcelas > 1 && !!it.parcelaAtual;
        return {
          descricao: it.descricao ?? "",
          valor: it.valor ?? 0,
          data: it.data!,
          estabelecimento: it.estabelecimento ?? "",
          categoriaId: it.categoriaSugerida || "outros",
          formaPagamento: "credito" as const,
          observacao: it.observacao ?? undefined,
          tipoGasto: isParcelado ? ("parcelado" as const) : ("unico" as const),
          parcelaAtual: isParcelado ? (it.parcelaAtual ?? undefined) : undefined,
          totalParcelas: isParcelado ? (it.totalParcelas ?? undefined) : undefined,
          cartaoId: it.cartaoId || cartaoId,
          horario: it.horario ?? undefined,
          origem: origem ?? "fatura_imagem",
          invoiceMonth,
          importBatchId: batchId,
        };
      });
      const salvos = addGastosBulk(inputs);
      // Resumo da importação
      const totalItens = items.length;
      const naoConfirmados = items.filter((i) => !i.selecionado).length;
      const duplicadosIgnorados = items.filter(
        (i) => !i.selecionado && i.dupStatus !== "novo",
      ).length;
      const novos = salvos.length;
      if (novos === 0) {
        toast.warning(t("toast.noneAdded"));
      } else if (duplicadosIgnorados > 0 || naoConfirmados > 0) {
        toast.success(
          t("toast.doneMixed", {
            novos,
            dup: duplicadosIgnorados,
            nao: naoConfirmados - duplicadosIgnorados,
          }),
        );
      } else {
        toast.success(t("toast.donePure", { count: novos }));
      }
      // Suprimir warning de var não usada
      void totalItens;
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("errorSave"));
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Render ---------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0",
          "sm:max-w-[640px] md:max-w-[820px] lg:max-w-[980px]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-4 pt-5 text-left sm:px-6">
          <DialogTitle className="text-xl font-bold tracking-tight">
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {step === "source" && (
            <SourceStep
              cartoes={cartoes}
              cartaoId={cartaoId}
              setCartaoId={setCartaoId}
              onPick={(s) => setStep(s)}
              onClose={() => onOpenChange(false)}
            />
          )}

          {step === "source" && <ImportHistorySection cartoes={cartoes} />}

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          {step === "image-upload" && (
            <ImageStep
              images={images}
              onPick={(fl) => void handleImageFiles(fl)}
              onRemove={(i) =>
                setImages((prev) => prev.filter((_, idx) => idx !== i))
              }
              loading={imgLoading}
              stage={imgStage}
              onProcess={() => void processarImagem()}
              onBack={() => setStep("source")}
            />
          )}

          {step === "pdf-upload" && (
            <PdfStep
              file={pdfFile}
              onPick={(fl) => void handlePdfFile(fl)}
              onClear={() => setPdfFile(null)}
              loading={pdfLoading}
              onProcess={() => void processarPdf()}
              onBack={() => setStep("source")}
            />
          )}

          {step === "csv-upload" && (
            <CsvStep
              onPick={(fl) => void handleCsvFile(fl)}
              onBack={() => setStep("source")}
            />
          )}

          {step === "csv-mapping" && (
            <CsvMapping
              headers={csvHeaders}
              rows={csvRows.slice(0, 3)}
              mapping={csvMap}
              setMapping={setCsvMap}
              onBack={() => setStep("csv-upload")}
              onApply={aplicarMapping}
            />
          )}

          {step === "review" && (
            <ReviewStep
              items={items}
              cartoes={cartoes}
              categorias={categorias}
              cartaoId={cartaoId}
              setCartaoId={setCartaoId}
              aplicarCartaoEmTodos={aplicarCartaoEmTodos}
              onUpdate={updateItem}
              onToggleAll={toggleAll}
              onAdd={adicionarLinha}
              onRemove={removerLinha}
              total={totalValor}
              selecionados={totalSelecionados}
              prontos={prontos}
              saving={saving}
              invoiceMonth={invoiceMonth}
              setInvoiceMonth={setInvoiceMonth}
              onConfirm={() => void confirmarImportacao()}
              onBack={() => setStep("source")}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* =================== Sub-componentes =================== */

function SourceStep({
  cartoes,
  cartaoId,
  setCartaoId,
  onPick,
  onClose,
}: {
  cartoes: Cartao[];
  cartaoId: string | undefined;
  setCartaoId: (s: string) => void;
  onPick: (s: Step) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  return (
    <div className="space-y-4">
      {/* Seleção de cartão */}
      <div className="rounded-2xl border border-border bg-card-elevated p-4">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("source.cardLabel")}
        </Label>
        {cartoes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("source.noCards")}
          </p>
        ) : (
          <Select value={cartaoId ?? ""} onValueChange={(v) => setCartaoId(v)}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder={t("source.pickCard")} />
            </SelectTrigger>
            <SelectContent>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} {c.banco ? `· ${c.banco}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SourceCard
          icon={<ImageIcon className="h-5 w-5" />}
          title={t("source.imagens")}
          desc={t("source.imagensDesc")}
          onClick={() => onPick("image-upload")}
          disabled={cartoes.length === 0}
        />
        <SourceCard
          icon={<FileText className="h-5 w-5" />}
          title={t("source.pdf")}
          desc={t("source.pdfDesc")}
          onClick={() => onPick("pdf-upload")}
          disabled={cartoes.length === 0}
        />
        <SourceCard
          icon={<FileSpreadsheet className="h-5 w-5" />}
          title={t("source.csv")}
          desc={t("source.csvDesc")}
          onClick={() => onPick("csv-upload")}
          disabled={cartoes.length === 0}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="block w-full rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground transition-colors hover:bg-card-elevated"
      >
        {t("source.manual")}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t("source.privacy")}
      </p>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  desc,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all",
        "hover:border-brand hover:shadow-elevated",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-on-soft transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}

function ImageStep({
  images,
  onPick,
  onRemove,
  loading,
  stage,
  onProcess,
  onBack,
}: {
  images: string[];
  onPick: (fl: FileList | null) => void;
  onRemove: (i: number) => void;
  loading: boolean;
  stage: number;
  onProcess: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  const STAGES = t("image.stages", { returnObjects: true }) as string[];
  if (loading) {
    return (
      <div className="grid place-items-center py-12">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft motion-safe:animate-pulse-soft">
            <Sparkles className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold">{t("image.loadingTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("image.loadingSub")}
          </p>
          <ul className="mt-5 space-y-1.5 text-left text-sm">
            {STAGES.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-2 transition-opacity",
                  i <= stage ? "opacity-100" : "opacity-40",
                )}
              >
                {i < stage ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : i === stage ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border" />
                )}
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <label
        htmlFor="fatura-img"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card-elevated px-4 py-10 text-center transition-colors hover:border-brand"
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-semibold">
          {t("image.uploadTitle")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("image.uploadHint")}
        </p>
        <input
          id="fatura-img"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </label>

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((src, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-xl border border-border"
            >
              <img
                src={src}
                alt={t("image.alt", { n: i + 1 })}
                className="h-28 w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"
                aria-label={t("image.remove")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("image.back")}
        </Button>
        <Button
          onClick={onProcess}
          disabled={images.length === 0}
          className="bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t("image.analyze")}
        </Button>
      </div>
    </div>
  );
}

function CsvStep({
  onPick,
  onBack,
}: {
  onPick: (fl: FileList | null) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  return (
    <div className="space-y-4">
      <label
        htmlFor="fatura-csv"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card-elevated px-4 py-10 text-center transition-colors hover:border-brand"
      >
        <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-semibold">
          {t("csv.uploadTitle")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("csv.uploadHint")}
        </p>
        <input
          id="fatura-csv"
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </label>

      <div className="rounded-xl bg-card-elevated p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">{t("csv.tipTitle")}</p>
        <p className="mt-1">
          {t("csv.tipBody")}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("csv.back")}
        </Button>
      </div>
    </div>
  );
}

function CsvMapping({
  headers,
  rows,
  mapping,
  setMapping,
  onBack,
  onApply,
}: {
  headers: string[];
  rows: string[][];
  mapping: CsvColumnRole[];
  setMapping: (m: CsvColumnRole[]) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-card-elevated p-3 text-xs text-muted-foreground">
        {t("mapping.intro")}
      </div>

      <div className="space-y-2">
        {headers.map((h, i) => (
          <div
            key={`${h}-${i}`}
            className="grid items-center gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_220px]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{h || t("mapping.column", { n: i + 1 })}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t("mapping.example", { value: rows.map((r) => r[i] ?? "").filter(Boolean).slice(0, 2).join(" · ") || "—" })}
              </p>
            </div>
            <Select
              value={mapping[i] ?? "ignorar"}
              onValueChange={(v) => {
                const m = [...mapping];
                m[i] = v as CsvColumnRole;
                setMapping(m);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COL_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {t(COL_LABEL_KEYS[opt])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("mapping.back")}
        </Button>
        <Button
          onClick={onApply}
          className="bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          {t("mapping.continue")}
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  items,
  cartoes,
  categorias,
  cartaoId,
  setCartaoId,
  aplicarCartaoEmTodos,
  onUpdate,
  onToggleAll,
  onAdd,
  onRemove,
  total,
  selecionados,
  prontos,
  saving,
  invoiceMonth,
  setInvoiceMonth,
  onConfirm,
  onBack,
}: {
  items: ReviewItem[];
  cartoes: Cartao[];
  categorias: Array<{ id: string; nome: string }>;
  cartaoId: string | undefined;
  setCartaoId: (s: string) => void;
  aplicarCartaoEmTodos: () => void;
  onUpdate: (id: string, patch: Partial<ReviewItem>) => void;
  onToggleAll: (v: boolean) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  total: number;
  selecionados: number;
  prontos: number;
  saving: boolean;
  invoiceMonth: string;
  setInvoiceMonth: (v: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation("import-fatura");
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }),
    [i18n.language],
  );
  function shiftMonth(ym: string, delta: number): string {
    const [y, m] = ym.split("-").map(Number);
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }
  const [invY, invM] = invoiceMonth.split("-").map(Number);
  const invoiceLabel = monthFormatter.format(new Date(invY ?? 1970, (invM ?? 1) - 1, 1));
  // Opções dos próximos/anteriores 12 meses para o select
  const monthOptions: string[] = (() => {
    const base = new Date();
    const out: string[] = [];
    for (let i = -12; i <= 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  })();
  return (
    <div className="space-y-4">
      {/* Banner: mês da fatura (fonte da verdade) */}
      <div className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("review.invoiceForLabel")}
            </p>
            <p className="mt-0.5 text-lg font-bold tracking-tight">
              {t("review.invoiceOf", { label: invoiceLabel })}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("review.invoiceNote")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInvoiceMonth(shiftMonth(invoiceMonth, -1))}
            >
              {t("review.prevMonth")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const d = new Date();
                setInvoiceMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
              }}
            >
              {t("review.thisMonth")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInvoiceMonth(shiftMonth(invoiceMonth, 1))}
            >
              {t("review.nextMonth")}
            </Button>
            <Select value={invoiceMonth} onValueChange={setInvoiceMonth}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder={t("review.otherMonth")} />
              </SelectTrigger>
              <SelectContent className="max-h-[260px]">
                {monthOptions.map((ym) => {
                  const [y, m] = ym.split("-").map(Number);
                  return (
                    <SelectItem key={ym} value={ym}>
                      {monthFormatter.format(new Date(y, m - 1, 1))}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card-elevated p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold tracking-tight">
              {t("review.confirmTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("review.confirmDesc")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground/80">
              {t("review.nothingSavedYet")}
            </p>
          </div>
          <div className="text-right">
            <p className="num text-base font-bold">{formatBRL(total)}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("review.summary", { sel: selecionados, ready: prontos })}
            </p>
          </div>
        </div>

        <div className="mt-3 grid items-center gap-2 sm:grid-cols-[1fr_auto]">
          <Select value={cartaoId ?? ""} onValueChange={(v) => setCartaoId(v)}>
            <SelectTrigger>
              <SelectValue placeholder={t("review.defaultCard")} />
            </SelectTrigger>
            <SelectContent>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} {c.banco ? `· ${c.banco}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={aplicarCartaoEmTodos}>
            {t("review.applyAll")}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onToggleAll(true)}>
            {t("review.selectAll")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onToggleAll(false)}>
            {t("review.clearSel")}
          </Button>
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("review.addRow")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((it) => (
          <ReviewRow
            key={it.id}
            item={it}
            cartoes={cartoes}
            categorias={categorias}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onRemove={() => onRemove(it.id)}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card-elevated p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t("review.empty")}
            </p>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-border bg-background px-5 pb-2 pt-3 sm:-mx-6 sm:flex-row sm:justify-between sm:px-6">
        <Button variant="outline" onClick={onBack} disabled={saving}>
          {t("review.back")}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={saving || prontos === 0}
          className="bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("review.saving")}
            </>
          ) : (
            <>{t("review.importN", { count: prontos })}</>
          )}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({
  item,
  cartoes,
  categorias,
  onUpdate,
  onRemove,
}: {
  item: ReviewItem;
  cartoes: Cartao[];
  categorias: Array<{ id: string; nome: string }>;
  onUpdate: (patch: Partial<ReviewItem>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  const [expanded, setExpanded] = useState(false);

  const valorOk = item.valor !== null && item.valor > 0;
  const dataOk = !!item.data;
  const descOk = !!(item.descricao && item.descricao.trim());
  const cartaoOk = !!item.cartaoId;
  const completo = valorOk && dataOk && descOk && cartaoOk;

  let badge: { label: string; tone: string } | null = null;
  if (item.dupStatus === "duplicado_existente")
    badge = { label: t("row.badge.exists"), tone: "bg-warning/20 text-warning" };
  else if (item.dupStatus === "duplicado_lote")
    badge = { label: t("row.badge.repeated"), tone: "bg-warning/20 text-warning" };
  else if (!completo) badge = { label: t("row.badge.incomplete"), tone: "bg-destructive/15 text-destructive" };
  else if (item.confianca === "baixa")
    badge = { label: t("row.badge.review"), tone: "bg-warning/20 text-warning" };
  else badge = { label: t("row.badge.new"), tone: "bg-success/15 text-success" };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3 transition-colors",
        item.selecionado ? "border-border" : "border-dashed border-border opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.selecionado}
          onChange={(e) => onUpdate({ selecionado: e.target.checked })}
          className="mt-1.5 h-4 w-4 cursor-pointer accent-brand"
          aria-label={t("row.select")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">
              {item.descricao || item.estabelecimento || t("row.noDesc")}
            </p>
            <p className="num text-sm font-bold">
              {item.valor !== null ? formatBRL(item.valor) : "—"}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="num">
              {item.data || t("row.noDate")}
              {item.horario ? t("row.at", { time: item.horario }) : ""}
            </span>
            {item.totalParcelas && item.totalParcelas > 1 && (
              <span className="num">
                · {item.parcelaAtual ?? 1}/{item.totalParcelas}
              </span>
            )}
            {badge && (
              <Badge
                variant="secondary"
                className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px]", badge.tone)}
              >
                {badge.tone.includes("destructive") || badge.tone.includes("warning") ? (
                  <AlertTriangle className="mr-1 h-3 w-3" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                )}
                {badge.label}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-label={t("row.edit")}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRemove}
            aria-label={t("row.remove")}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <Field label={t("row.fields.descricao")}>
            <Input
              value={item.descricao ?? ""}
              onChange={(e) => onUpdate({ descricao: e.target.value })}
            />
          </Field>
          <Field label={t("row.fields.estabelecimento")}>
            <Input
              value={item.estabelecimento ?? ""}
              onChange={(e) => onUpdate({ estabelecimento: e.target.value || null })}
            />
          </Field>
          <Field label={t("row.fields.valor")}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={item.valor ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate({ valor: v === "" ? null : Number(v) });
              }}
            />
          </Field>
          <Field label={t("row.fields.data")}>
            <Input
              type="date"
              value={item.data ?? ""}
              onChange={(e) => onUpdate({ data: e.target.value || null })}
            />
          </Field>
          <Field label={t("row.fields.horario")}>
            <Input
              type="time"
              value={item.horario ?? ""}
              onChange={(e) => onUpdate({ horario: e.target.value || null })}
            />
          </Field>
          <Field label={t("row.fields.categoria")}>
            <Select
              value={item.categoriaSugerida ?? "outros"}
              onValueChange={(v) => onUpdate({ categoriaSugerida: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[260px]">
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("row.fields.cartao")}>
            <Select
              value={item.cartaoId || ""}
              onValueChange={(v) => onUpdate({ cartaoId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("row.fields.pickCard")} />
              </SelectTrigger>
              <SelectContent>
                {cartoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("row.fields.parcela")}>
            <Input
              type="number"
              min="0"
              value={item.parcelaAtual ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate({ parcelaAtual: v === "" ? null : Number(v) });
              }}
            />
          </Field>
          <Field label={t("row.fields.totalParcelas")}>
            <Input
              type="number"
              min="0"
              value={item.totalParcelas ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate({ totalParcelas: v === "" ? null : Number(v) });
              }}
            />
          </Field>
          <Field label={t("row.fields.observacao")} className="sm:col-span-2">
            <Input
              value={item.observacao ?? ""}
              onChange={(e) => onUpdate({ observacao: e.target.value || null })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function PdfStep({
  file,
  onPick,
  onClear,
  loading,
  onProcess,
  onBack,
}: {
  file: { name: string; dataUri: string; size: number } | null;
  onPick: (fl: FileList | null) => void;
  onClear: () => void;
  loading: boolean;
  onProcess: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation("import-fatura");
  if (loading) {
    return (
      <div className="grid place-items-center py-12">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft motion-safe:animate-pulse-soft">
            <FileText className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold">{t("pdf.loadingTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pdf.loadingSub")}
          </p>
          <Loader2 className="mt-4 h-5 w-5 animate-spin text-brand" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <label
        htmlFor="fatura-pdf"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card-elevated px-4 py-10 text-center transition-colors hover:border-brand"
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-semibold">{t("pdf.uploadTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("pdf.uploadHint")}
        </p>
        <input
          id="fatura-pdf"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </label>

      {file && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-on-soft">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClear}
            aria-label={t("pdf.removePdf")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t("pdf.privacy")}
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("pdf.back")}
        </Button>
        <Button
          onClick={onProcess}
          disabled={!file}
          className="bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t("pdf.analyze")}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/* =================== Histórico de importações =================== */

function fmtInvoiceMonth(ym?: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return "—";
  const [a, m] = ym.split("-");
  return `${m}/${a}`;
}

function originLabel(o: string | undefined, t: (k: string) => string): string {
  if (!o) return t("history.origins.default");
  if (o.includes("imagem")) return t("history.origins.imagem");
  if (o.includes("pdf")) return t("history.origins.pdf");
  if (o.includes("csv")) return t("history.origins.csv");
  return o;
}

function ImportHistorySection({ cartoes }: { cartoes: Cartao[] }) {
  const { t } = useTranslation("import-fatura");
  // Reativo: useStore garante refresh ao deletar lote
  const lotes = useStore(() => lotesImportacaoTodos());
  const [verLote, setVerLote] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<{
    batchId: string;
    qtd: number;
    total: number;
    invoiceMonth?: string;
  } | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  if (lotes.length === 0) return null;

  const cartoesById = new Map(cartoes.map((c) => [c.id, c] as const));
  const itensVer = verLote ? gastosDoLote(verLote) : [];

  async function confirmarDelete() {
    if (!confirmDel) return;
    setExcluindo(true);
    try {
      const n = await deleteGastosDoLote(confirmDel.batchId);
      if (n > 0) {
        toast.success(t("toast.removed", { count: n }));
      } else {
        toast.error(t("errorDelete"));
      }
      setConfirmDel(null);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t("history.title")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("history.subtitle")}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {lotes.map((l) => {
          const cartao = l.cartaoId ? cartoesById.get(l.cartaoId) : undefined;
          const dataImp = l.primeira ? formatDateBR(l.primeira.slice(0, 10)) : "—";
          return (
            <li
              key={l.batchId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card-elevated px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {cartao?.nome ?? t("history.removedCard")}
                  {cartao?.banco ? ` · ${cartao.banco}` : ""}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t("history.invoiceLine", { month: fmtInvoiceMonth(l.invoiceMonth), origin: originLabel(l.origem, t), date: dataImp })}
                </p>
                <p className="num text-[11px] text-muted-foreground">
                  {t("history.countLine", { count: l.qtd, total: formatBRL(l.total) })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => setVerLote(l.batchId)}
                >
                  {t("history.view")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    setConfirmDel({
                      batchId: l.batchId,
                      qtd: l.qtd,
                      total: l.total,
                      invoiceMonth: l.invoiceMonth,
                    })
                  }
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t("history.delete")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Ver lançamentos do lote */}
      <Dialog open={!!verLote} onOpenChange={(o) => !o && setVerLote(null)}>
        <DialogContent className="max-h-[80vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("history.lancamentosTitle")}</DialogTitle>
            <DialogDescription>
              {t("history.lancamentosDesc", { count: itensVer.length })}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {itensVer.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card-elevated px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {g.estabelecimento || g.descricao}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t("history.purchaseDate", { date: formatDateBR(g.data) })}
                    {g.invoiceMonth ? t("history.invoiceMonth", { month: fmtInvoiceMonth(g.invoiceMonth) }) : ""}
                  </p>
                </div>
                <p className="num shrink-0 text-sm font-semibold">{formatBRL(g.valor)}</p>
              </li>
            ))}
            {itensVer.length === 0 && (
              <li className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                {t("history.noItems")}
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                i18nKey="history.deleteDesc"
                t={t}
                values={{
                  month: fmtInvoiceMonth(confirmDel?.invoiceMonth),
                  count: confirmDel?.qtd ?? 0,
                  total: formatBRL(confirmDel?.total ?? 0),
                }}
                components={[<strong key="m" />, <strong key="c" />, <strong key="t" />]}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>{t("history.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmarDelete();
              }}
              disabled={excluindo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindo ? t("history.deleting") : t("history.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
