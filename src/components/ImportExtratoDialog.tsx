import { useCallback, useMemo, useRef, useState } from "react";
import {
  ImageIcon,
  FileText,
  FileSpreadsheet,
  Upload,
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  ShieldCheck,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
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
  addReceitasBulk,
  addTransferenciasInternasBulk,
  findDuplicateGastoAdvanced,
  findDuplicateReceitaAdvanced,
  findDuplicateTransferenciaAdvanced,
  normalizeDescricao,
  getCategorias,
  getGastos,
  getReceitas,
  getTransferenciasInternas,
  useStore,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento, type TipoReceita } from "@/lib/types";
import {
  parseCsvFile,
  parseValorBR,
  parseDataBR,
  suggestCategoryFromDescription,
} from "@/lib/csv-fatura";

type Step = "source" | "image-upload" | "pdf-upload" | "csv-upload" | "review";

type TipoMov = "despesa" | "receita" | "transferencia_interna";
type DupStatus = "novo" | "duplicado_lote" | "duplicado_existente";
type ReviewStatus = "novo" | "pagamento_fatura_cartao" | "reserva" | "resgate_reserva" | "investimentos" | "revisar";

type ItemBruto = {
  descricao: string | null;
  valor: number | null;
  data: string | null;
  idOperacao?: string | null;
  saldo?: number | null;
  origemImportacao?: string | null;
  bancoOrigem?: string | null;
  statusRevisao?: ReviewStatus | string | null;
  horario: string | null;
  tipoMovimentacao: TipoMov;
  formaPagamento: string | null;
  categoriaSugerida: string | null;
  contraparte: string | null;
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
};

type ReviewItem = {
  id: string;
  descricao: string;
  valor: number | null;
  data: string | null;
  horario: string | null;
  tipoMovimentacao: TipoMov;
  formaPagamento: FormaPagamento;
  categoriaId: string;
  idOperacao?: string;
  saldo?: number | null;
  bancoOrigem?: string;
  statusRevisao: ReviewStatus;
  origem?: string;
  destino?: string;
  observacao?: string;
  selecionado: boolean;
  dupStatus: DupStatus;
};

const FORMA_OPCOES = FORMAS_PAGAMENTO;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(file);
  });
}

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalizeReviewStatus(value: string | null | undefined): ReviewStatus {
  return value === "pagamento_fatura_cartao" ||
    value === "reserva" ||
    value === "resgate_reserva" ||
    value === "investimentos" ||
    value === "revisar"
    ? value
    : "novo";
}

function textHasOperationId(text: string | undefined, id: string) {
  return !!text && normalizeDescricao(text).includes(normalizeDescricao(id));
}

function operationIdExists(id: string) {
  return (
    getGastos().some((g) => textHasOperationId(g.observacao, id) || textHasOperationId(g.origem, id)) ||
    getReceitas().some((r) => textHasOperationId(r.origem, id)) ||
    getTransferenciasInternas().some((t) => textHasOperationId(t.observacao, id) || textHasOperationId(t.origemImportacao, id))
  );
}

export function ImportExtratoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  useStore(() => 0);
  const categorias = getCategorias();

  const [step, setStep] = useState<Step>("source");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [observacaoIA, setObservacaoIA] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("source");
    setLoading(false);
    setItems([]);
    setObservacaoIA(null);
  }, []);

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) reset();
      onOpenChange(v);
    },
    [onOpenChange, reset],
  );

  // ---------- DEDUP ----------
  const computeDupStatus = useCallback(
    (rs: ReviewItem[]): ReviewItem[] => {
      const seen = new Map<string, number>();
      return rs.map((r, idx) => {
        if (r.valor === null || !r.data) {
          return { ...r, dupStatus: "novo" as DupStatus };
        }
        const operationKey = r.idOperacao ? `op|${normalizeDescricao(r.idOperacao)}` : null;
        const key = operationKey || `${r.tipoMovimentacao}|${r.valor.toFixed(2)}|${r.data}|${normalizeDescricao(r.descricao)}`;
        const prev = seen.get(key);
        if (prev !== undefined && prev !== idx) {
          return { ...r, dupStatus: "duplicado_lote" as DupStatus };
        }
        seen.set(key, idx);
        if (r.idOperacao && operationIdExists(r.idOperacao)) {
          return { ...r, dupStatus: "duplicado_existente" as DupStatus };
        }

        let existe;
        if (r.tipoMovimentacao === "despesa") {
          existe = findDuplicateGastoAdvanced({
            valor: r.valor,
            data: r.data,
            descricao: r.descricao,
            horario: r.horario ?? undefined,
          });
        } else if (r.tipoMovimentacao === "receita") {
          existe = findDuplicateReceitaAdvanced({
            valor: r.valor,
            data: r.data,
            descricao: r.descricao,
            horario: r.horario ?? undefined,
          });
        } else {
          existe = findDuplicateTransferenciaAdvanced({
            valor: r.valor,
            data: r.data,
            descricao: r.descricao,
            horario: r.horario ?? undefined,
          });
        }
        return {
          ...r,
          dupStatus: existe ? "duplicado_existente" : "novo",
        };
      });
    },
    [],
  );

  const itensFromBruto = useCallback(
    (brutos: ItemBruto[], origemImport: string): ReviewItem[] => {
      const reviewItems = brutos.map<ReviewItem>((b) => {
        const desc = b.descricao || b.contraparte || "Lançamento";
        const cat = (b.categoriaSugerida && categorias.find((c) => c.id === b.categoriaSugerida)?.id) ||
          suggestCategoryFromDescription(desc);
        const formaPg = (b.formaPagamento as FormaPagamento) || "outro";
        const statusRevisao = normalizeReviewStatus(b.statusRevisao ?? null);
        const idOperacao = b.idOperacao?.trim() || undefined;
        const bancoOrigem = b.bancoOrigem?.trim() || undefined;
        const origem = b.origemImportacao || origemImport;
        const observacao = [
          b.observacao,
          bancoOrigem ? `Banco: ${bancoOrigem}` : null,
          idOperacao ? `ID operação: ${idOperacao}` : null,
          `Origem: ${origem}`,
        ].filter(Boolean).join(" • ");
        const deveComecarDesmarcado =
          b.tipoMovimentacao === "transferencia_interna" ||
          statusRevisao === "pagamento_fatura_cartao" ||
          statusRevisao === "reserva" ||
          statusRevisao === "resgate_reserva" ||
          statusRevisao === "revisar";
        const dup: DupStatus = "novo";
        return {
          id: newId(),
          descricao: desc,
          valor: b.valor,
          data: b.data,
          idOperacao,
          saldo: b.saldo ?? null,
          bancoOrigem,
          statusRevisao,
          horario: b.horario,
          tipoMovimentacao: b.tipoMovimentacao,
          formaPagamento: formaPg,
          categoriaId: cat,
          observacao,
          selecionado: !deveComecarDesmarcado,
          dupStatus: dup,
        };
      });
      const withDup = computeDupStatus(reviewItems);
      // Duplicados já existentes começam DESMARCADOS
      return withDup.map((r) =>
        r.dupStatus === "duplicado_existente" || r.dupStatus === "duplicado_lote"
          ? { ...r, selecionado: false }
          : r,
      );
    },
    [categorias, computeDupStatus],
  );

  // ---------- IMPORT: imagens ----------
  const handleImagens = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (files.length > 10) {
        toast.error("Envie no máximo 10 imagens por vez.");
        return;
      }
      setLoading(true);
      setObservacaoIA(null);
      try {
        const dataUrls = await Promise.all(files.map(fileToDataUrl));
        const resp = await fetch("/api/import-extrato", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagens: dataUrls }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          toast.error(json?.error || "Não consegui ler o extrato.");
          setLoading(false);
          return;
        }
        const brutos = (json.itens || []) as ItemBruto[];
        if (brutos.length === 0) {
          toast.warning("Nenhuma movimentação encontrada nas imagens.");
          setObservacaoIA(json.observacao ?? null);
          setLoading(false);
          return;
        }
        setItems(itensFromBruto(brutos, "extrato_imagem"));
        setObservacaoIA(json.observacao ?? null);
        setStep("review");
      } catch (e) {
        console.error(e);
        toast.error("Erro ao enviar imagens.");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto],
  );

  // ---------- IMPORT: PDF ----------
  const handlePdf = useCallback(
    async (file: File) => {
      if (!file) return;
      if (file.size === 0) {
        toast.error("Arquivo PDF vazio.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error("PDF muito grande. Tente um arquivo menor que 15 MB.");
        return;
      }
      setLoading(true);
      setObservacaoIA(null);
      try {
        // Envia como multipart/form-data — sem header manual (browser gera o boundary).
        const fd = new FormData();
        fd.append("pdf", file, file.name || "extrato.pdf");
        const resp = await fetch("/api/import-extrato", {
          method: "POST",
          body: fd,
        });

        // Parse defensivo: a resposta pode vir como texto puro em erros de proxy/edge.
        const raw = await resp.text();
        let json: { itens?: ItemBruto[]; observacao?: string | null; error?: string } = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          console.error("[import-extrato] resposta não-JSON:", resp.status, raw.slice(0, 200));
          if (resp.status === 413) {
            toast.error("PDF muito grande. Tente um arquivo menor.");
          } else if (resp.status >= 500 || resp.status === 0) {
            toast.error("Não foi possível ler este PDF. Tente outro arquivo ou exporte uma versão sem senha.");
          } else {
            toast.error("Erro ao processar o extrato. Tente novamente.");
          }
          setLoading(false);
          return;
        }

        if (!resp.ok) {
          toast.error(json?.error || "Não foi possível ler este PDF. Tente outro arquivo ou exporte uma versão sem senha.");
          setLoading(false);
          return;
        }
        const brutos = (json.itens || []) as ItemBruto[];
        if (brutos.length === 0) {
          toast.warning("Não encontramos movimentações nesse PDF.");
          setObservacaoIA(json.observacao ?? null);
          setLoading(false);
          return;
        }
        setItems(itensFromBruto(brutos, "extrato_pdf"));
        setObservacaoIA(json.observacao ?? null);
        setStep("review");
      } catch (e) {
        console.error("[import-extrato] erro envio PDF", e);
        toast.error("Erro ao processar o extrato. Tente novamente.");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto],
  );

  // ---------- IMPORT: CSV ----------
  const handleCsv = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const text = await file.text();
        const { headers, rows } = parseCsvFile(text);
        if (rows.length === 0) {
          toast.error("CSV vazio ou inválido.");
          setLoading(false);
          return;
        }
        // mapeamento simples: tenta achar "data", "descricao/historico", "valor"
        const norm = (s: string) =>
          s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const idxData = headers.findIndex((h) =>
          ["data", "date", "dt"].some((k) => norm(h).includes(k)),
        );
        const idxDesc = headers.findIndex((h) =>
          ["descricao", "historico", "memo", "detalhe", "description"].some((k) =>
            norm(h).includes(k),
          ),
        );
        const idxValor = headers.findIndex((h) =>
          ["valor", "amount", "vlr"].some((k) => norm(h).includes(k)),
        );
        if (idxData < 0 || idxDesc < 0 || idxValor < 0) {
          toast.error(
            "CSV sem colunas reconhecíveis. Esperado: Data, Descrição/Histórico, Valor.",
          );
          setLoading(false);
          return;
        }
        const brutos: ItemBruto[] = [];
        for (const r of rows) {
          const valor = parseValorBR(r[idxValor] ?? "");
          const data = parseDataBR(r[idxData] ?? "");
          const desc = (r[idxDesc] ?? "").trim();
          if (valor === null || !data || !desc) continue;
          const tipoMov: TipoMov = valor < 0 ? "despesa" : "receita";
          const lower = desc.toLowerCase();
          let forma: string = "outro";
          if (/pix/.test(lower)) forma = "pix";
          else if (/ted|doc|transf/.test(lower)) forma = "transferencia";
          else if (/d[eé]bito|deb /.test(lower)) forma = "debito";
          else if (/boleto/.test(lower)) forma = "boleto";
          brutos.push({
            descricao: desc,
            valor: Math.abs(valor),
            data,
            horario: null,
            tipoMovimentacao: tipoMov,
            formaPagamento: forma,
            categoriaSugerida: suggestCategoryFromDescription(desc),
            contraparte: null,
            confianca: "media",
            observacao: null,
          });
        }
        if (brutos.length === 0) {
          toast.warning("Nenhuma linha válida no CSV.");
          setLoading(false);
          return;
        }
        setItems(itensFromBruto(brutos, "extrato_csv"));
        setStep("review");
      } catch (e) {
        console.error(e);
        toast.error("Erro ao ler CSV.");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto],
  );

  // ---------- REVIEW edits ----------
  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
      // Se valor/data/desc/tipo mudou, recomputa dedup
      if (
        patch.valor !== undefined ||
        patch.data !== undefined ||
        patch.descricao !== undefined ||
        patch.tipoMovimentacao !== undefined ||
        patch.horario !== undefined
      ) {
        return computeDupStatus(next);
      }
      return next;
    });
  };
  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const addEmptyItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: newId(),
        descricao: "",
        valor: null,
        data: new Date().toISOString().slice(0, 10),
        horario: null,
        tipoMovimentacao: "despesa",
        formaPagamento: "outro",
        categoriaId: "outros",
        statusRevisao: "novo",
        selecionado: true,
        dupStatus: "novo",
      },
    ]);
  };

  // ---------- CONFIRM ----------
  const handleConfirm = () => {
    const validos = items.filter(
      (i) => i.selecionado && i.valor !== null && i.valor > 0 && i.data && i.descricao.trim(),
    );
    if (validos.length === 0) {
      toast.error("Nenhum item válido selecionado.");
      return;
    }

    const despesas = validos.filter((i) => i.tipoMovimentacao === "despesa");
    const receitas = validos.filter((i) => i.tipoMovimentacao === "receita");
    const transferencias = validos.filter((i) => i.tipoMovimentacao === "transferencia_interna");

    let novosCount = 0;
    let duplicadosIgnorados = items.filter(
      (i) => !i.selecionado && (i.dupStatus === "duplicado_existente" || i.dupStatus === "duplicado_lote"),
    ).length;
    const naoConfirmados = items.filter(
      (i) => !i.selecionado && i.dupStatus === "novo",
    ).length;

    if (despesas.length > 0) {
      const created = addGastosBulk(
        despesas.map((d) => ({
          descricao: d.descricao,
          valor: d.valor!,
          data: d.data!,
          estabelecimento: d.descricao,
          categoriaId: d.categoriaId,
          formaPagamento: d.formaPagamento,
          observacao: d.observacao,
          tipoGasto: "unico" as const,
          confirmado: true,
          horario: d.horario ?? undefined,
          origem: "extrato",
        })),
      );
      novosCount += created.length;
    }
    if (receitas.length > 0) {
      const created = addReceitasBulk(
        receitas.map((r) => {
          const tipoReceita: TipoReceita =
            /sal[áa]rio/i.test(r.descricao)
              ? "salario"
              : /pix/i.test(r.descricao)
                ? "pix"
                : /reembolso|estorno/i.test(r.descricao)
                  ? "reembolso"
                  : "outros";
          return {
            descricao: r.descricao,
            valor: r.valor!,
            data: r.data!,
            tipo: tipoReceita,
            horario: r.horario ?? undefined,
            origem: "extrato",
          };
        }),
      );
      novosCount += created.length;
    }
    if (transferencias.length > 0) {
      const created = addTransferenciasInternasBulk(
        transferencias.map((t) => ({
          descricao: t.descricao,
          valor: t.valor!,
          data: t.data!,
          horario: t.horario ?? undefined,
          observacao: t.observacao,
          origemImportacao: "extrato",
        })),
      );
      novosCount += created.length;
    }

    if (novosCount === 0 && duplicadosIgnorados > 0) {
      toast("Nenhum novo lançamento foi adicionado. Os itens encontrados parecem já estar no app.");
    } else {
      toast.success(
        `Importação concluída: ${novosCount} novo(s), ${duplicadosIgnorados} duplicado(s) ignorado(s) e ${naoConfirmados} item(ns) não confirmado(s).`,
      );
    }
    handleClose(false);
  };

  // ---------- RENDER ----------
  const totalSelecionados = useMemo(
    () => items.filter((i) => i.selecionado).length,
    [items],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5" />
            Importar extrato bancário
          </DialogTitle>
          <DialogDescription className="text-sm">
            Pix, transferências, débito, tarifas, entradas e saídas da conta.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "source" && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SourceCard
                icon={<ImageIcon className="h-6 w-6" />}
                title="Imagens / prints"
                desc="Até 10 prints do extrato"
                onClick={() => setStep("image-upload")}
              />
              <SourceCard
                icon={<FileText className="h-6 w-6" />}
                title="PDF"
                desc="Extrato em PDF (texto ou escaneado)"
                onClick={() => setStep("pdf-upload")}
              />
              <SourceCard
                icon={<FileSpreadsheet className="h-6 w-6" />}
                title="CSV"
                desc="Exportado do internet banking"
                onClick={() => setStep("csv-upload")}
              />
            </div>
          )}

          {step === "image-upload" && (
            <UploadStep
              accept="image/*"
              multiple
              loading={loading}
              hint="Selecione até 10 imagens do extrato. Aceita JPG e PNG."
              onPick={(files) => handleImagens(files)}
              onBack={() => setStep("source")}
            />
          )}
          {step === "pdf-upload" && (
            <UploadStep
              accept="application/pdf"
              loading={loading}
              hint="Selecione um PDF do extrato. Se for protegido por senha, exporte uma versão sem senha."
              onPick={(files) => files[0] && handlePdf(files[0])}
              onBack={() => setStep("source")}
            />
          )}
          {step === "csv-upload" && (
            <UploadStep
              accept=".csv,text/csv"
              loading={loading}
              hint="Espera colunas: Data, Descrição/Histórico, Valor."
              onPick={(files) => files[0] && handleCsv(files[0])}
              onBack={() => setStep("source")}
            />
          )}

          {step === "review" && (
            <ReviewStep
              items={items}
              onUpdate={updateItem}
              onRemove={removeItem}
              onAdd={addEmptyItem}
              categorias={categorias}
              observacaoIA={observacaoIA}
            />
          )}
        </div>

        {step === "review" && (
          <div className="border-t px-6 py-3 bg-card flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {totalSelecionados} de {items.length} selecionado(s)
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={totalSelecionados === 0}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Confirmar importação
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-5 text-center hover:bg-card-elevated hover:border-foreground/30 transition-all"
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

function UploadStep({
  accept,
  multiple,
  loading,
  hint,
  onPick,
  onBack,
}: {
  accept: string;
  multiple?: boolean;
  loading: boolean;
  hint: string;
  onPick: (files: File[]) => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Voltar
      </button>
      <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Lendo o extrato com IA, aguarde...
            </p>
          </div>
        ) : (
          <>
            <Sparkles className="mx-auto h-8 w-8 text-primary mb-3" />
            <p className="text-sm font-medium mb-1">{hint}</p>
            <p className="text-xs text-muted-foreground mb-4">
              Os arquivos não são salvos. A IA extrai apenas as movimentações para você revisar.
            </p>
            <input
              ref={ref}
              type="file"
              accept={accept}
              multiple={multiple}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) onPick(files);
                e.target.value = "";
              }}
            />
            <Button onClick={() => ref.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Selecionar arquivo{multiple ? "s" : ""}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  items,
  onUpdate,
  onRemove,
  onAdd,
  categorias,
  observacaoIA,
}: {
  items: ReviewItem[];
  onUpdate: (id: string, patch: Partial<ReviewItem>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  categorias: ReturnType<typeof getCategorias>;
  observacaoIA: string | null;
}) {
  return (
    <div className="space-y-3">
      {observacaoIA && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span>{observacaoIA}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {items.length} movimentação(ões) encontrada(s)
        </p>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar linha
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            categorias={categorias}
            onUpdate={(patch) => onUpdate(item.id, patch)}
            onRemove={() => onRemove(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  categorias,
  onUpdate,
  onRemove,
}: {
  item: ReviewItem;
  categorias: ReturnType<typeof getCategorias>;
  onUpdate: (patch: Partial<ReviewItem>) => void;
  onRemove: () => void;
}) {
  const dupBadge =
    item.dupStatus === "duplicado_existente"
      ? { label: "Já existe no app", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" }
      : item.dupStatus === "duplicado_lote"
        ? { label: "Repetido no envio", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" }
        : item.valor === null || !item.data || !item.descricao
          ? { label: "Incompleto", color: "bg-red-500/15 text-red-600 border-red-500/30" }
          : { label: "Novo", color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" };

  const tipoIcon =
    item.tipoMovimentacao === "despesa" ? (
      <ArrowUpRight className="h-3.5 w-3.5 text-rose-500" />
    ) : item.tipoMovimentacao === "receita" ? (
      <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
    ) : (
      <ArrowLeftRight className="h-3.5 w-3.5 text-blue-500" />
    );

  return (
    <div
      className={cn(
        "rounded-2xl border p-3 space-y-3 transition-all",
        item.selecionado ? "border-border bg-card" : "border-border/50 bg-card/40 opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.selecionado}
          onChange={(e) => onUpdate({ selecionado: e.target.checked })}
          className="mt-1 h-4 w-4 rounded"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px] gap-1", dupBadge.color)}>
              {dupBadge.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              {tipoIcon}
              {item.tipoMovimentacao === "despesa"
                ? "Despesa"
                : item.tipoMovimentacao === "receita"
                  ? "Receita"
                  : "Transf. interna"}
            </Badge>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Remover"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Descrição</Label>
          <Input
            value={item.descricao}
            onChange={(e) => onUpdate({ descricao: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Valor</Label>
          <Input
            type="number"
            step="0.01"
            value={item.valor ?? ""}
            onChange={(e) =>
              onUpdate({ valor: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={item.data ?? ""}
            onChange={(e) => onUpdate({ data: e.target.value || null })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Horário (opcional)</Label>
          <Input
            type="time"
            value={item.horario ?? ""}
            onChange={(e) => onUpdate({ horario: e.target.value || null })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select
            value={item.tipoMovimentacao}
            onValueChange={(v) => onUpdate({ tipoMovimentacao: v as TipoMov })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="despesa">Despesa</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
              <SelectItem value="transferencia_interna">Transferência interna</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {item.tipoMovimentacao !== "transferencia_interna" && (
          <div>
            <Label className="text-xs">Forma de pagamento</Label>
            <Select
              value={item.formaPagamento}
              onValueChange={(v) => onUpdate({ formaPagamento: v as FormaPagamento })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMA_OPCOES.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {item.tipoMovimentacao === "despesa" && (
          <div className="sm:col-span-2">
            <Label className="text-xs">Categoria</Label>
            <Select
              value={item.categoriaId}
              onValueChange={(v) => onUpdate({ categoriaId: v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {item.valor !== null && (
        <div className="text-xs text-muted-foreground pt-1">
          Total: <span className="font-semibold text-foreground">{formatBRL(item.valor)}</span>
        </div>
      )}
    </div>
  );
}
