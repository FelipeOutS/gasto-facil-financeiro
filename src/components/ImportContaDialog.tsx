import { apiFetch } from "@/lib/api-fetch";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePremiumApiGate } from "@/lib/premium-errors";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import {
  Upload,
  Loader2,
  AlertTriangle,
  FileText,
  ImageIcon,
  FileType2,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  addContaAPagar,
  findContaByCodigo,
  findContaDuplicado,
  getCategorias,
  useStore,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import { parseBRLInput, todayISO, formatBRL } from "@/lib/format";
import { confirmAsync } from "@/components/ConfirmDialog";

type ContaExtraida = {
  nome: string | null;
  beneficiario: string | null;
  valor: number | null;
  dataVencimento: string | null;
  formaPagamento: string | null;
  codigoBoleto: string | null;
  codigoPix: string | null;
  chavePix: string | null;
  bancoEmissor: string | null;
  categoriaSugerida: string | null;
  observacao: string | null;
  confianca: "alta" | "media" | "baixa";
};

type ItemRevisao = {
  uid: string;
  selecionado: boolean;
  duplicado: boolean;
  motivoDuplicado?: string;
  nome: string;
  beneficiario: string;
  valorStr: string;
  vencimento: string;
  forma: FormaPagamento | "";
  codigoBoleto: string;
  codigoPix: string;
  chavePix: string;
  bancoEmissor: string;
  categoriaId: string;
  observacao: string;
  confianca: "alta" | "media" | "baixa";
};

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function checarDuplicado(
  input: {
    valor: number | null;
    dataVencimento: string;
    nome: string;
    beneficiario?: string;
    codigoBoleto?: string;
    codigoPix?: string;
  },
  t: (k: string) => string,
): { dup: boolean; motivo?: string } {
  if (input.codigoBoleto && input.codigoBoleto.trim()) {
    const d = findContaByCodigo(input.codigoBoleto, "boleto");
    if (d) return { dup: true, motivo: t("dup.sameBoletoCode") };
  }
  if (input.codigoPix && input.codigoPix.trim()) {
    const d = findContaByCodigo(input.codigoPix, "pix");
    if (d) return { dup: true, motivo: t("dup.samePixCode") };
  }
  if (input.valor && input.valor > 0 && input.dataVencimento && input.nome) {
    const d = findContaDuplicado({
      valor: input.valor,
      dataVencimento: input.dataVencimento,
      nome: input.nome,
      beneficiario: input.beneficiario,
    });
    if (d) return { dup: true, motivo: t("dup.similarValueDate") };
  }
  return { dup: false };
}

export function ImportContaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation("import-conta");
  const categorias = useStore(() => getCategorias());
  const [aba, setAba] = useState<"imagem" | "texto" | "pdf">("imagem");
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [conta, setConta] = useState<ContaExtraida | null>(null);
  const [itensPdf, setItensPdf] = useState<ItemRevisao[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // Campos editáveis na revisão (item único - imagem/texto)
  const [nome, setNome] = useState("");
  const [beneficiario, setBeneficiario] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [forma, setForma] = useState<FormaPagamento | "">("");
  const [codigoBoleto, setCodigoBoleto] = useState("");
  const [codigoPix, setCodigoPix] = useState("");
  const [chavePix, setChavePix] = useState("");
  const [bancoEmissor, setBancoEmissor] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [observacao, setObservacao] = useState("");

  function reset() {
    setConta(null);
    setItensPdf(null);
    setTexto("");
    setNome("");
    setBeneficiario("");
    setValorStr("");
    setVencimento("");
    setForma("");
    setCodigoBoleto("");
    setCodigoPix("");
    setChavePix("");
    setBancoEmissor("");
    setCategoriaId("");
    setObservacao("");
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function aplicarConta(c: ContaExtraida) {
    setConta(c);
    setNome(c.nome ?? "");
    setBeneficiario(c.beneficiario ?? "");
    setValorStr(c.valor != null ? String(c.valor).replace(".", ",") : "");
    setVencimento(c.dataVencimento ?? "");
    setForma((c.formaPagamento as FormaPagamento) ?? "");
    setCodigoBoleto(c.codigoBoleto ?? "");
    setCodigoPix(c.codigoPix ?? "");
    setChavePix(c.chavePix ?? "");
    setBancoEmissor(c.bancoEmissor ?? "");
    setCategoriaId(c.categoriaSugerida ?? "");
    setObservacao(c.observacao ?? "");
  }

  async function processar(payload: { images?: string[]; text?: string }) {
    setLoading(true);
    try {
      const res = await apiFetch("/api/import-conta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? t("errors.readFail"));
        return;
      }
      if (!json.conta) {
        toast.warning(json.observacao ?? t("errors.nothingFound"));
        return;
      }
      aplicarConta(json.conta);
      toast.success(t("success.extracted"));
    } catch (err) {
      console.error(err);
      toast.error(t("errors.networkConta"));
    } finally {
      setLoading(false);
    }
  }

  async function processarPdf(pdfDataUrl: string) {
    setLoading(true);
    try {
      const res = await apiFetch("/api/import-conta-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf: pdfDataUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? t("errors.readPdfFail"));
        return;
      }
      const itens: ContaExtraida[] = Array.isArray(json.itens) ? json.itens : [];
      if (itens.length === 0) {
        toast.warning(json.observacao ?? t("errors.noneInPdf"));
        return;
      }
      const revisao: ItemRevisao[] = itens.map((c) => {
        const valor = c.valor;
        const venc = c.dataVencimento ?? "";
        const nm = c.nome ?? "";
        const dupCheck = checarDuplicado({
          valor,
          dataVencimento: venc,
          nome: nm,
          beneficiario: c.beneficiario ?? undefined,
          codigoBoleto: c.codigoBoleto ?? undefined,
          codigoPix: c.codigoPix ?? undefined,
        }, t);
        return {
          uid: crypto.randomUUID(),
          selecionado: !dupCheck.dup,
          duplicado: dupCheck.dup,
          motivoDuplicado: dupCheck.motivo,
          nome: nm,
          beneficiario: c.beneficiario ?? "",
          valorStr: valor != null ? String(valor).replace(".", ",") : "",
          vencimento: venc,
          forma: (c.formaPagamento as FormaPagamento) ?? "",
          codigoBoleto: c.codigoBoleto ?? "",
          codigoPix: c.codigoPix ?? "",
          chavePix: c.chavePix ?? "",
          bancoEmissor: c.bancoEmissor ?? "",
          categoriaId: c.categoriaSugerida ?? "",
          observacao: c.observacao ?? "",
          confianca: c.confianca,
        };
      });
      setItensPdf(revisao);
      toast.success(t("success.foundCount", { count: itens.length }));
    } catch (err) {
      console.error(err);
      toast.error(t("errors.networkPdf"));
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("errors.pickImage"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("errors.imageTooBig"));
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    await processar({ images: [dataUrl] });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handlePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error(t("errors.pickPdf"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("errors.pdfTooBig"));
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    await processarPdf(dataUrl);
    if (pdfRef.current) pdfRef.current.value = "";
  }

  async function handleTexto() {
    if (!texto.trim()) {
      toast.error(t("errors.pasteText"));
      return;
    }
    await processar({ text: texto });
  }

  async function handleSalvar() {
    const valor = parseBRLInput(valorStr);
    if (!nome.trim()) return toast.error(t("errors.needName"));
    if (!Number.isFinite(valor) || valor <= 0)
      return toast.error(t("errors.invalidValue"));
    if (!vencimento) return toast.error(t("errors.needDue"));

    if (codigoBoleto.trim()) {
      const dup = findContaByCodigo(codigoBoleto, "boleto");
      if (dup) {
        toast.error(t("errors.dupBoleto"));
        return;
      }
    }
    if (codigoPix.trim()) {
      const dup = findContaByCodigo(codigoPix, "pix");
      if (dup) {
        toast.error(t("errors.dupPix"));
        return;
      }
    }

    const possivel = findContaDuplicado({
      valor,
      dataVencimento: vencimento,
      nome,
      beneficiario: beneficiario || undefined,
    });
    if (possivel) {
      const ok = await confirmAsync({
        title: t("dup.confirm", { name: possivel.nome, date: possivel.dataVencimento }),
        confirmText: t("dup.confirmYes", { defaultValue: "Salvar mesmo assim" }),
      });
      if (!ok) return;
    }

    addContaAPagar({
      nome: nome.trim(),
      valor,
      dataVencimento: vencimento,
      categoriaId: categoriaId || undefined,
      observacao: observacao.trim() || undefined,
      beneficiario: beneficiario.trim() || undefined,
      formaPagamento: (forma || undefined) as FormaPagamento | undefined,
      codigoBoleto: codigoBoleto.trim() || undefined,
      codigoPix: codigoPix.trim() || undefined,
      chavePix: chavePix.trim() || undefined,
      bancoEmissor: bancoEmissor.trim() || undefined,
      importBatchId: crypto.randomUUID(),
    });
    toast.success(t("success.saved"));
    handleClose();
  }

  function patchItem(uid: string, patch: Partial<ItemRevisao>) {
    setItensPdf((prev) =>
      prev ? prev.map((it) => (it.uid === uid ? { ...it, ...patch } : it)) : prev,
    );
  }

  function removerItem(uid: string) {
    setItensPdf((prev) => (prev ? prev.filter((it) => it.uid !== uid) : prev));
  }

  function handleSalvarLote() {
    if (!itensPdf) return;
    const selecionados = itensPdf.filter((it) => it.selecionado);
    if (selecionados.length === 0) {
      toast.error(t("errors.needSelectImport"));
      return;
    }
    // Validações
    for (const it of selecionados) {
      const v = parseBRLInput(it.valorStr);
      if (!it.nome.trim())
        return toast.error(t("errors.needNameItem"));
      if (!Number.isFinite(v) || v <= 0)
        return toast.error(t("errors.invalidValueItem", { name: it.nome }));
      if (!it.vencimento) return toast.error(t("errors.needDueItem", { name: it.nome }));
    }

    const batchId = crypto.randomUUID();
    let salvas = 0;
    let ignoradas = 0;
    for (const it of itensPdf) {
      if (!it.selecionado) {
        if (it.duplicado) ignoradas++;
        continue;
      }
      const v = parseBRLInput(it.valorStr);
      addContaAPagar({
        nome: it.nome.trim(),
        valor: v,
        dataVencimento: it.vencimento,
        categoriaId: it.categoriaId || undefined,
        observacao: it.observacao.trim() || undefined,
        beneficiario: it.beneficiario.trim() || undefined,
        formaPagamento: (it.forma || undefined) as FormaPagamento | undefined,
        codigoBoleto: it.codigoBoleto.trim() || undefined,
        codigoPix: it.codigoPix.trim() || undefined,
        chavePix: it.chavePix.trim() || undefined,
        bancoEmissor: it.bancoEmissor.trim() || undefined,
        importBatchId: batchId,
      });
      salvas++;
    }
    toast.success(
      t("success.batchDone", {
        salvas,
        ignoradasMsg: ignoradas > 0 ? t("success.ignoredSuffix", { count: ignoradas }) : "",
      }),
    );
    handleClose();
  }

  const modoLote = itensPdf !== null;
  const modoItem = conta !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        {!modoItem && !modoLote && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={aba === "imagem" ? "default" : "outline"}
                onClick={() => setAba("imagem")}
                disabled={loading}
              >
                <ImageIcon className="mr-1 h-4 w-4" />
                {t("tabs.imagem")}
              </Button>
              <Button
                variant={aba === "texto" ? "default" : "outline"}
                onClick={() => setAba("texto")}
                disabled={loading}
              >
                <FileText className="mr-1 h-4 w-4" />
                {t("tabs.texto")}
              </Button>
              <Button
                variant={aba === "pdf" ? "default" : "outline"}
                onClick={() => setAba("pdf")}
                disabled={loading}
              >
                <FileType2 className="mr-1 h-4 w-4" />
                {t("tabs.pdf")}
              </Button>
            </div>

            {aba === "imagem" && (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("imagem.hint")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("imagem.format")}
                </p>
                <Button
                  className="mt-3"
                  onClick={() => fileRef.current?.click()}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("imagem.reading")}
                    </>
                  ) : (
                    t("imagem.pick")
                  )}
                </Button>
              </div>
            )}

            {aba === "texto" && (
              <div className="space-y-2">
                <Label htmlFor="conta-texto">{t("texto.label")}</Label>
                <Textarea
                  id="conta-texto"
                  rows={6}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={t("texto.placeholder")}
                />
                <Button onClick={handleTexto} disabled={loading} className="w-full">
                  {loading ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("imagem.reading")}
                    </>
                  ) : (
                    t("texto.extract")
                  )}
                </Button>
              </div>
            )}

            {aba === "pdf" && (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
                <input
                  ref={pdfRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={handlePdf}
                />
                <FileType2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("pdf.hint")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("pdf.info")}</p>
                <Button
                  className="mt-3"
                  onClick={() => pdfRef.current?.click()}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("pdf.reading")}
                    </>
                  ) : (
                    t("pdf.pick")
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {modoItem && conta && (
          <div className="space-y-3">
            {conta.confianca === "baixa" && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("lowConfidence")}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="imp-nome">{t("fields.nome")}</Label>
              <Input id="imp-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-benef">{t("fields.beneficiario")}</Label>
              <Input
                id="imp-benef"
                value={beneficiario}
                onChange={(e) => setBeneficiario(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-valor">{t("fields.valor")}</Label>
                <Input
                  id="imp-valor"
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-venc">{t("fields.vencimento")}</Label>
                <Input
                  id="imp-venc"
                  type="date"
                  value={vencimento || todayISO()}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("fields.forma")}</Label>
                <Select
                  value={forma || "_none"}
                  onValueChange={(v) =>
                    setForma((v === "_none" ? "" : v) as FormaPagamento | "")
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("fields.selecione")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{t("fields.none")}</SelectItem>
                    {FORMAS_PAGAMENTO.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.categoria")}</Label>
                <Select
                  value={categoriaId || "_none"}
                  onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("fields.selecione")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{t("fields.semCategoria")}</SelectItem>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-boleto">{t("fields.codigoBoleto")}</Label>
              <Input
                id="imp-boleto"
                value={codigoBoleto}
                onChange={(e) => setCodigoBoleto(e.target.value)}
                placeholder={t("fields.linhaDigitavel")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-pix">{t("fields.codigoPix")}</Label>
              <Textarea
                id="imp-pix"
                rows={2}
                value={codigoPix}
                onChange={(e) => setCodigoPix(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-chave">{t("fields.chavePix")}</Label>
                <Input
                  id="imp-chave"
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-banco">{t("fields.banco")}</Label>
                <Input
                  id="imp-banco"
                  value={bancoEmissor}
                  onChange={(e) => setBancoEmissor(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-obs">{t("fields.observacao")}</Label>
              <Textarea
                id="imp-obs"
                rows={2}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
          </div>
        )}

        {modoLote && itensPdf && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("lote.selectedOf", {
                  sel: itensPdf.filter((it) => it.selecionado).length,
                  total: itensPdf.length,
                })}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() =>
                    setItensPdf((prev) =>
                      prev ? prev.map((it) => ({ ...it, selecionado: true })) : prev,
                    )
                  }
                >
                  {t("lote.markAll")}
                </button>
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() =>
                    setItensPdf((prev) =>
                      prev ? prev.map((it) => ({ ...it, selecionado: false })) : prev,
                    )
                  }
                >
                  {t("lote.unmark")}
                </button>
              </div>
            </div>

            {itensPdf.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t("lote.empty")}
              </p>
            )}

            {itensPdf.map((it) => {
              const v = parseBRLInput(it.valorStr);
              return (
                <div
                  key={it.uid}
                  className={`space-y-3 rounded-2xl border p-3 ${
                    it.selecionado ? "border-border bg-card" : "border-border/40 bg-muted/30"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={it.selecionado}
                      onCheckedChange={(c) =>
                        patchItem(it.uid, { selecionado: c === true })
                      }
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {it.nome || t("lote.noName")}
                        </span>
                        {it.duplicado && (
                          <Badge
                            variant="outline"
                            className="border-warning/50 text-warning"
                          >
                            {t("lote.exists")}
                          </Badge>
                        )}
                        {it.confianca === "baixa" && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {t("lote.lowConfBadge")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {Number.isFinite(v) && v > 0 ? formatBRL(v) : "—"}
                        {it.vencimento ? t("lote.dueOn", { date: it.vencimento }) : ""}
                        {it.beneficiario ? ` · ${it.beneficiario}` : ""}
                        {it.motivoDuplicado ? ` · ${it.motivoDuplicado}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removerItem(it.uid)}
                      title={t("lote.removeFromList")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.nome")}</Label>
                      <Input
                        value={it.nome}
                        onChange={(e) => patchItem(it.uid, { nome: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.beneficiario")}</Label>
                      <Input
                        value={it.beneficiario}
                        onChange={(e) =>
                          patchItem(it.uid, { beneficiario: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.valor")}</Label>
                      <Input
                        inputMode="decimal"
                        value={it.valorStr}
                        onChange={(e) => patchItem(it.uid, { valorStr: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.vencimento")}</Label>
                      <Input
                        type="date"
                        value={it.vencimento}
                        onChange={(e) => patchItem(it.uid, { vencimento: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.forma")}</Label>
                      <Select
                        value={it.forma || "_none"}
                        onValueChange={(v) =>
                          patchItem(it.uid, {
                            forma: (v === "_none" ? "" : v) as FormaPagamento | "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("fields.selecione")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">{t("fields.none")}</SelectItem>
                          {FORMAS_PAGAMENTO.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.categoria")}</Label>
                      <Select
                        value={it.categoriaId || "_none"}
                        onValueChange={(v) =>
                          patchItem(it.uid, { categoriaId: v === "_none" ? "" : v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("fields.selecione")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">{t("fields.semCategoria")}</SelectItem>
                          {categorias.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(it.codigoBoleto || it.codigoPix || it.chavePix) && (
                    <div className="space-y-2">
                      {it.codigoBoleto && (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("fields.codigoBoleto")}</Label>
                          <Input
                            value={it.codigoBoleto}
                            onChange={(e) =>
                              patchItem(it.uid, { codigoBoleto: e.target.value })
                            }
                          />
                        </div>
                      )}
                      {it.codigoPix && (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("fields.codigoPix")}</Label>
                          <Textarea
                            rows={2}
                            value={it.codigoPix}
                            onChange={(e) =>
                              patchItem(it.uid, { codigoPix: e.target.value })
                            }
                          />
                        </div>
                      )}
                      {it.chavePix && (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("fields.chavePix")}</Label>
                          <Input
                            value={it.chavePix}
                            onChange={(e) =>
                              patchItem(it.uid, { chavePix: e.target.value })
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {it.observacao && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t("fields.observacao")}</Label>
                      <Textarea
                        rows={2}
                        value={it.observacao}
                        onChange={(e) =>
                          patchItem(it.uid, { observacao: e.target.value })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {modoItem ? (
            <>
              <Button variant="outline" onClick={() => setConta(null)}>
                {t("footer.back")}
              </Button>
              <Button onClick={handleSalvar}>{t("footer.save")}</Button>
            </>
          ) : modoLote ? (
            <>
              <Button variant="outline" onClick={() => setItensPdf(null)}>
                {t("footer.back")}
              </Button>
              <Button onClick={handleSalvarLote}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                {t("footer.importSelected")}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose}>
              {t("footer.cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
