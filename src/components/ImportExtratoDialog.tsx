import { apiFetch } from "@/lib/api-fetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePremiumApiGate } from "@/lib/premium-errors";
import { PremiumLockModal } from "@/components/PremiumLockModal";
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
  createExtratoImportado,
  findDuplicateGastoAdvanced,
  findDuplicateReceitaAdvanced,
  findDuplicateTransferenciaAdvanced,
  normalizeDescricao,
  getCartoes,
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
import { resolverTipoMovimentacao } from "@/lib/transferencia-detect";
import { sugerirCartaoDaFatura } from "@/lib/fatura-cartao-match";

type Step = "upload" | "kind" | "analyzing" | "cartao" | "review" | "done";
type ReviewFilter =
  | "todos"
  | "selecionados"
  | "duplicados"
  | "gastos"
  | "receitas"
  | "transferencias"
  | "outros";
type ImportKind = "extrato" | "fatura";


type TipoMov = "despesa" | "receita" | "transferencia_interna";
type DupStatus = "novo" | "duplicado_lote" | "duplicado_existente";
type ReviewStatus =
  | "novo"
  | "pagamento_fatura_cartao"
  | "reserva"
  | "resgate_reserva"
  | "investimentos"
  | "revisar";

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
  /** Cartão vinculado (faturas de cartão de crédito). */
  cartaoId?: string;
};


type ExtratoResumo = {
  banco: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  saldoInicial: number | null;
  totalEntradas: number | null;
  totalSaidas: number | null;
  saldoFinal: number | null;
};

const FORMA_OPCOES = FORMAS_PAGAMENTO;

function fileToDataUrl(file: File, errMsg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(errMsg));
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
  const norm = normalizeDescricao(id);
  // 1) Match direto pela coluna dedicada `id_operacao_banco` (caminho preferido,
  //    populado em todos os imports recentes). É o sinal mais forte de duplicata.
  const matchDireto =
    getGastos().some((g) => g.idOperacaoBanco && normalizeDescricao(g.idOperacaoBanco) === norm) ||
    getReceitas().some(
      (r) => r.idOperacaoBanco && normalizeDescricao(r.idOperacaoBanco) === norm,
    ) ||
    getTransferenciasInternas().some(
      (t) => t.idOperacaoBanco && normalizeDescricao(t.idOperacaoBanco) === norm,
    );
  if (matchDireto) return true;
  // 2) Fallback retroativo: imports antigos podem ter o id apenas embutido em
  //    `origem`/`observacao` (formato `extrato_*|banco|op:XXX`). Mantém a
  //    detecção para não regredir em bases legadas.
  return (
    getGastos().some(
      (g) => textHasOperationId(g.observacao, id) || textHasOperationId(g.origem, id),
    ) ||
    getReceitas().some((r) => textHasOperationId(r.origem, id)) ||
    getTransferenciasInternas().some(
      (t) => textHasOperationId(t.observacao, id) || textHasOperationId(t.origemImportacao, id),
    )
  );
}

function importOrigin(item: ReviewItem, fallback: string) {
  const parts = [fallback];
  if (item.bancoOrigem) parts.push(item.bancoOrigem);
  if (item.idOperacao) parts.push(`op:${item.idOperacao}`);
  return parts.join("|");
}

const ANALYZING_MESSAGES = [
  "Lendo documento…",
  "Identificando movimentações…",
  "Organizando lançamentos…",
];

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileKind = "pdf" | "csv" | "imagem";

export function detectFileKind(file: File): FileKind | null {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "imagem";
  if (type.includes("csv") || name.endsWith(".csv")) return "csv";
  if (type === "text/plain" && name.endsWith(".txt")) return "csv";
  return null;
}

/** Heurística leve: o nome do arquivo sugere fatura de cartão? */
export function filenameSuggestsFatura(name: string) {
  return /fatura|invoice|cart[aã]o/i.test(name || "");
}

export function ImportExtratoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation("import-extrato");
  useStore(() => 0);
  const { t: tc } = useTranslation("common");
  const premiumGate = usePremiumApiGate();
  const categorias = getCategorias();
  const cartoes = getCartoes();

  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("todos");
  const [observacaoIA, setObservacaoIA] = useState<string | null>(null);
  const [resumoExtrato, setResumoExtrato] = useState<ExtratoResumo | null>(null);
  const [analyzingIdx, setAnalyzingIdx] = useState(0);
  const [cartaoSelecionado, setCartaoSelecionado] = useState<string | null>(null);
  const [sugestaoCartao, setSugestaoCartao] = useState<{
    cartaoId: string;
    motivo: string;
  } | null>(null);
  const [result, setResult] = useState<{
    adicionados: number;
    duplicados: number;
    naoImportados: number;
    total: number;
  } | null>(null);
  const [importMeta, setImportMeta] = useState<{
    nomeArquivo?: string;
    tipoOrigem: "pdf" | "csv" | "imagem";
  } | null>(null);

  const reset = useCallback(() => {
    setStep("upload");
    setLoading(false);
    setFiles([]);
    setItems([]);
    setFilter("todos");
    setObservacaoIA(null);
    setResumoExtrato(null);
    setResult(null);
    setImportMeta(null);
    setCartaoSelecionado(null);
    setSugestaoCartao(null);
  }, []);


  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) reset();
      onOpenChange(v);
    },
    [onOpenChange, reset],
  );

  // Mensagens rotativas durante a análise (evita tela congelada)
  useEffect(() => {
    if (step !== "analyzing") return;
    setAnalyzingIdx(0);
    const id = setInterval(() => {
      setAnalyzingIdx((i) => Math.min(i + 1, ANALYZING_MESSAGES.length - 1));
    }, 3500);
    return () => clearInterval(id);
  }, [step]);

  // ---------- DEDUP ----------
  const computeDupStatus = useCallback((rs: ReviewItem[]): ReviewItem[] => {
    const seen = new Map<string, number>();
    return rs.map((r, idx) => {
      if (r.valor === null || !r.data) {
        return { ...r, dupStatus: "novo" as DupStatus };
      }
      const operationKey = r.idOperacao ? `op|${normalizeDescricao(r.idOperacao)}` : null;
      const key =
        operationKey ||
        `${r.tipoMovimentacao}|${r.valor.toFixed(2)}|${r.data}|${normalizeDescricao(r.descricao)}`;
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
          cartaoId: r.cartaoId,
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
  }, []);

  const itensFromBruto = useCallback(
    (brutos: ItemBruto[], origemImport: string): ReviewItem[] => {
      const reviewItems = brutos.map<ReviewItem>((b) => {
        const desc = b.descricao || b.contraparte || "Lançamento";
        const cat =
          (b.categoriaSugerida && categorias.find((c) => c.id === b.categoriaSugerida)?.id) ||
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
        ]
          .filter(Boolean)
          .join(" • ");
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
          origem,
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
        toast.error(t("errors.tooManyImages"));
        return;
      }
      setLoading(true);
      setStep("analyzing");
      setObservacaoIA(null);
      try {
        const dataUrls = await Promise.all(
          files.map((f) => fileToDataUrl(f, t("errors.fileRead"))),
        );
        const resp = await apiFetch("/api/import-extrato", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagens: dataUrls }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          if (
            premiumGate.handleResponse(resp, json, {
              title: tc("premium.premiumApi.importExtrato.title"),
              description: tc("premium.premiumApi.importExtrato.description"),
              fallbackFeature: "importar_extrato",
            })
          ) {
            setLoading(false);
            setStep("upload");
            return;
          }
          toast.error(json?.error || t("errors.readFail"));
          setLoading(false);
          setStep("upload");
          return;
        }
        const brutos = (json.itens || []) as ItemBruto[];
        if (brutos.length === 0) {
          toast.warning(t("errors.noneFoundImg"));
          setObservacaoIA(json.observacao ?? null);
          setLoading(false);
          setStep("upload");
          return;
        }
        setItems(itensFromBruto(brutos, "extrato_imagem"));
        setObservacaoIA(json.observacao ?? null);
        setImportMeta({
          nomeArquivo: files[0]?.name ?? `imagens-${files.length}`,
          tipoOrigem: "imagem",
        });
        setStep("review");
      } catch (e) {
        console.error(e);
        toast.error(t("errors.sendImg"));
        setStep("upload");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto, premiumGate, t, tc],
  );

  // ---------- IMPORT: PDF de fatura de cartão ----------
  const handleFaturaPdf = useCallback(
    async (file: File) => {
      setLoading(true);
      setStep("analyzing");
      setObservacaoIA(null);
      try {
        const dataUrl = await fileToDataUrl(file, t("errors.fileRead"));
        const resp = await apiFetch("/api/import-fatura-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: dataUrl }),
        });
        const raw = await resp.text();
        let json: {
          itens?: Array<{
            descricao?: string | null;
            estabelecimento?: string | null;
            valor?: number | null;
            data?: string | null;
            horario?: string | null;
            parcelaAtual?: number | null;
            totalParcelas?: number | null;
            categoriaSugerida?: string | null;
            observacao?: string | null;
          }>;
          observacao?: string | null;
          error?: string;
        } = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          toast.error(t("errors.processFail"));
          setLoading(false);
          setStep("upload");
          return;
        }
        if (!resp.ok) {
          if (
            premiumGate.handleResponse(resp, json, {
              title: tc("premium.premiumApi.importExtrato.title"),
              description: tc("premium.premiumApi.importExtrato.description"),
              fallbackFeature: "importar_extrato",
            })
          ) {
            setLoading(false);
            setStep("upload");
            return;
          }
          toast.error(json?.error || t("errors.readPdfNo"));
          setLoading(false);
          setStep("upload");
          return;
        }
        const raws = json.itens ?? [];
        const brutos: ItemBruto[] = raws.map((it) => {
          const parcela =
            it.parcelaAtual && it.totalParcelas
              ? `Parcela ${it.parcelaAtual}/${it.totalParcelas}`
              : null;
          return {
            descricao: it.descricao || it.estabelecimento || "Compra",
            valor: typeof it.valor === "number" ? it.valor : null,
            data: it.data ?? null,
            horario: it.horario ?? null,
            tipoMovimentacao: "despesa",
            formaPagamento: "credito",
            categoriaSugerida: it.categoriaSugerida ?? null,
            contraparte: it.estabelecimento ?? null,
            confianca: "media",
            observacao: [it.observacao, parcela].filter(Boolean).join(" • ") || null,
          };
        });
        if (brutos.length === 0) {
          toast.warning("Não encontramos lançamentos nesse arquivo.");
          setObservacaoIA(json.observacao ?? null);
          setLoading(false);
          setStep("upload");
          return;
        }
        setItems(itensFromBruto(brutos, "fatura_pdf"));
        setObservacaoIA(json.observacao ?? null);
        setImportMeta({ nomeArquivo: file.name, tipoOrigem: "pdf" });
        // Fatura de cartão: pergunta a qual cartão os lançamentos pertencem.
        if (cartoes.length > 0) {
          const sugestao = sugerirCartaoDaFatura(cartoes, [file.name, json.observacao]);
          setSugestaoCartao(sugestao);
          setCartaoSelecionado(sugestao?.cartaoId ?? null);
          setStep("cartao");
        } else {
          setStep("review");
        }

      } catch (e) {
        console.error("[import-gastos] erro fatura PDF", e);
        toast.error(t("errors.processFail"));
        setStep("upload");
      } finally {
        setLoading(false);
      }
    },
    [cartoes, itensFromBruto, premiumGate, t, tc],

  );

  // ---------- IMPORT: PDF ----------
  const handlePdf = useCallback(
    async (file: File) => {
      if (!file) return;
      if (file.size === 0) {
        toast.error(t("errors.pdfEmpty"));
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error(t("errors.pdfTooBig"));
        return;
      }
      setLoading(true);
      setStep("analyzing");
      setObservacaoIA(null);
      try {
        // Envia como multipart/form-data — sem header manual (browser gera o boundary).
        const fd = new FormData();
        fd.append("pdf", file, file.name || "extrato.pdf");
        const resp = await apiFetch("/api/import-extrato", {
          method: "POST",
          body: fd,
        });

        // Parse defensivo: a resposta pode vir como texto puro em erros de proxy/edge.
        const raw = await resp.text();
        let json: {
          itens?: ItemBruto[];
          resumo?: ExtratoResumo | null;
          observacao?: string | null;
          error?: string;
        } = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          console.error("[import-extrato] resposta não-JSON:", resp.status, raw.slice(0, 200));
          if (resp.status === 413) {
            toast.error(t("errors.pdfTooBigShort"));
          } else if (resp.status >= 500 || resp.status === 0) {
            toast.error(t("errors.readPdfNo"));
          } else {
            toast.error(t("errors.processFail"));
          }
          setLoading(false);
          setStep("upload");
          return;
        }

        if (!resp.ok) {
          if (
            premiumGate.handleResponse(resp, json, {
              title: tc("premium.premiumApi.importExtrato.title"),
              description: tc("premium.premiumApi.importExtrato.description"),
              fallbackFeature: "importar_extrato",
            })
          ) {
            setLoading(false);
            setStep("upload");
            return;
          }
          toast.error(json?.error || t("errors.readPdfNo"));
          setLoading(false);
          setStep("upload");
          return;
        }
        const brutos = (json.itens || []) as ItemBruto[];
        if (brutos.length === 0) {
          toast.warning(t("errors.noneInPdf"));
          setObservacaoIA(json.observacao ?? null);
          setLoading(false);
          setStep("upload");
          return;
        }
        setResumoExtrato(json.resumo ?? null);
        setItems(itensFromBruto(brutos, "extrato_pdf"));
        setObservacaoIA(json.observacao ?? null);
        setImportMeta({ nomeArquivo: file.name, tipoOrigem: "pdf" });
        setStep("review");
      } catch (e) {
        console.error("[import-extrato] erro envio PDF", e);
        toast.error(t("errors.processFail"));
        setStep("upload");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto, premiumGate, t, tc],
  );

  // ---------- IMPORT: CSV ----------
  const handleCsv = useCallback(
    async (file: File) => {
      setLoading(true);
      setStep("analyzing");
      try {
        const text = await file.text();
        const { headers, rows } = parseCsvFile(text);
        if (rows.length === 0) {
          toast.error(t("errors.csvEmpty"));
          setLoading(false);
          setStep("upload");
          return;
        }
        // mapeamento simples: tenta achar "data", "descricao/historico", "valor"
        const norm = (s: string) =>
          s
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
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
          toast.error(t("errors.csvCols"));
          setLoading(false);
          setStep("upload");
          return;
        }
        const brutos: ItemBruto[] = [];
        for (const r of rows) {
          const valor = parseValorBR(r[idxValor] ?? "");
          const data = parseDataBR(r[idxData] ?? "");
          const desc = (r[idxDesc] ?? "").trim();
          if (valor === null || !data || !desc) continue;
          const { tipo, precisaRevisao, deteccao } = resolverTipoMovimentacao(desc, valor);
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
            tipoMovimentacao: tipo,
            statusRevisao: precisaRevisao ? "revisar" : null,
            formaPagamento: forma,
            categoriaSugerida: suggestCategoryFromDescription(desc),
            contraparte: null,
            confianca: deteccao.certeza,
            observacao: precisaRevisao ? `Verifique: ${deteccao.motivo}` : null,
          });

        }
        if (brutos.length === 0) {
          toast.warning(t("errors.csvNoValid"));
          setLoading(false);
          setStep("upload");
          return;
        }
        setItems(itensFromBruto(brutos, "extrato_csv"));
        setImportMeta({ nomeArquivo: file.name, tipoOrigem: "csv" });
        setStep("review");
      } catch (e) {
        console.error(e);
        toast.error(t("errors.csvRead"));
        setStep("upload");
      } finally {
        setLoading(false);
      }
    },
    [itensFromBruto, t],
  );

  // ---------- SELEÇÃO DE ARQUIVOS ----------
  const addFiles = useCallback((picked: File[]) => {
    const aceitos = picked.filter((f) => detectFileKind(f) !== null);
    if (aceitos.length === 0) {
      toast.error("Formato não suportado. Envie um PDF, CSV ou imagem.");
      return;
    }
    if (aceitos.length < picked.length) {
      toast.warning("Alguns arquivos foram ignorados por não serem PDF, CSV ou imagem.");
    }
    const primeiro = detectFileKind(aceitos[0]!);
    // Só imagens podem ser enviadas em lote; PDF/CSV é 1 arquivo por vez.
    const finais =
      primeiro === "imagem" ? aceitos.filter((f) => detectFileKind(f) === "imagem") : [aceitos[0]!];
    if (primeiro === "imagem" && finais.length > 10) {
      toast.error(t("errors.tooManyImages"));
      return;
    }
    setFiles(primeiro === "imagem" ? (prev) => [...prev, ...finais].slice(0, 10) : finais);
  }, [t]);

  const startAnalysis = useCallback(
    (kind?: ImportKind) => {
      const first = files[0];
      if (!first) return;
      const fk = detectFileKind(first);
      if (fk === "csv") return void handleCsv(first);
      if (fk === "imagem") return void handleImagens(files);
      if (fk !== "pdf") {
        toast.error("Formato não suportado. Envie um PDF, CSV ou imagem.");
        return;
      }
      if (!kind && filenameSuggestsFatura(first.name)) {
        setStep("kind");
        return;
      }
      if (kind === "fatura") return void handleFaturaPdf(first);
      return void handlePdf(first);
    },
    [files, handleCsv, handleImagens, handleFaturaPdf, handlePdf],
  );

  // ---------- FATURA: vincula os lançamentos ao cartão escolhido ----------
  const confirmarCartaoFatura = useCallback(
    (cartaoId: string | null) => {
      setItems((prev) =>
        computeDupStatus(
          prev.map((it) =>
            it.tipoMovimentacao === "despesa"
              ? { ...it, cartaoId: cartaoId ?? undefined, formaPagamento: "credito" as FormaPagamento }
              : it,
          ),
        ),
      );
      setCartaoSelecionado(cartaoId);
      setStep("review");
    },
    [computeDupStatus],
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
  const setAllSelected = (v: boolean) =>
    setItems((prev) => prev.map((i) => ({ ...i, selecionado: v })));

  // ---------- CONFIRM ----------
  const handleConfirm = async () => {
    const validos = items.filter(
      (i) => i.selecionado && i.valor !== null && i.valor > 0 && i.data && i.descricao.trim(),
    );
    if (validos.length === 0) {
      toast.error(t("errors.noneSelected"));
      return;
    }

    const despesas = validos.filter((i) => i.tipoMovimentacao === "despesa");
    const receitas = validos.filter((i) => i.tipoMovimentacao === "receita");
    const transferencias = validos.filter((i) => i.tipoMovimentacao === "transferencia_interna");

    let novosCount = 0;
    const duplicadosIgnorados = items.filter(
      (i) =>
        !i.selecionado &&
        (i.dupStatus === "duplicado_existente" || i.dupStatus === "duplicado_lote"),
    ).length;
    const naoConfirmados = items.filter((i) => !i.selecionado && i.dupStatus === "novo").length;

    // Gera o batchId que será compartilhado por todos os itens dessa importação.
    const batchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let totalDespesas = 0;
    let totalReceitas = 0;
    let totalTransferencias = 0;

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
          origem: importOrigin(d, d.origem || "extrato_pdf"),
          importBatchId: batchId,
          idOperacaoBanco: d.idOperacao,
          cartaoId: d.formaPagamento === "credito" ? d.cartaoId : undefined,

        })),
      );
      novosCount += created.length;
      totalDespesas = created.reduce((s, x) => s + x.valor, 0);
    }
    if (receitas.length > 0) {
      const created = addReceitasBulk(
        receitas.map((r) => {
          const tipoReceita: TipoReceita = /sal[áa]rio/i.test(r.descricao)
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
            origem: importOrigin(r, r.origem || "extrato_pdf"),
            importBatchId: batchId,
            idOperacaoBanco: r.idOperacao,
          };
        }),
      );
      novosCount += created.length;
      totalReceitas = created.reduce((s, x) => s + x.valor, 0);
    }
    if (transferencias.length > 0) {
      const created = addTransferenciasInternasBulk(
        transferencias.map((t) => ({
          descricao: t.descricao,
          valor: t.valor!,
          data: t.data!,
          horario: t.horario ?? undefined,
          observacao: t.observacao,
          origemImportacao: importOrigin(t, t.origem || "extrato_pdf"),
          importBatchId: batchId,
          idOperacaoBanco: t.idOperacao,
        })),
      );
      novosCount += created.length;
      totalTransferencias = created.reduce((s, x) => s + x.valor, 0);
    }

    // Cria registro no histórico de extratos importados (apenas se gerou itens novos)
    if (novosCount > 0) {
      // Determina período pelas datas dos itens
      const datas = validos.map((v) => v.data!).sort();
      const periodoInicio = datas[0];
      const periodoFim = datas[datas.length - 1];
      try {
        await createExtratoImportado({
          id: batchId,
          nomeArquivo: importMeta?.nomeArquivo,
          tipoOrigem: importMeta?.tipoOrigem ?? "pdf",
          periodoInicio,
          periodoFim,
          qtdMovimentacoes: novosCount,
          qtdDuplicadasIgnoradas: duplicadosIgnorados,
          totalReceitas,
          totalDespesas,
          totalGuardado: 0,
          totalTransferencias,
          observacao: observacaoIA ?? undefined,
        });
      } catch (e) {
        console.error("[ImportExtratoDialog] createExtratoImportado falhou", e);
      }
    }

    setResult({
      adicionados: novosCount,
      duplicados: duplicadosIgnorados,
      naoImportados: naoConfirmados,
      total: totalDespesas + totalReceitas + totalTransferencias,
    });
    setStep("done");
  };

  // ---------- RENDER ----------
  const totalSelecionados = useMemo(() => items.filter((i) => i.selecionado).length, [items]);
  const duplicadosCount = useMemo(
    () => items.filter((i) => i.dupStatus !== "novo").length,
    [items],
  );
  const totalSelecionadoValor = useMemo(
    () => items.filter((i) => i.selecionado).reduce((s, i) => s + (i.valor ?? 0), 0),
    [items],
  );
  const itensFiltrados = useMemo(() => {
    switch (filter) {
      case "selecionados":
        return items.filter((i) => i.selecionado);
      case "duplicados":
        return items.filter((i) => i.dupStatus !== "novo");
      case "gastos":
        return items.filter((i) => i.tipoMovimentacao === "despesa");
      case "receitas":
        return items.filter((i) => i.tipoMovimentacao === "receita");
      case "transferencias":
        return items.filter((i) => i.tipoMovimentacao === "transferencia_interna");
      case "outros":
        return items.filter((i) => i.statusRevisao !== "novo");

      default:
        return items;
    }
  }, [items, filter]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5" />
            Importar gastos
          </DialogTitle>
          <DialogDescription className="text-sm">
            Envie um arquivo com suas movimentações e o Gasto Inteligente identifica os lançamentos
            para você revisar antes de adicioná-los.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "upload" && (
            <UploadStep
              files={files}
              onAddFiles={addFiles}
              onRemoveFile={(idx) => setFiles((prev) => prev.filter((_, i) => i !== idx))}
              onAnalyze={() => startAnalysis()}
            />
          )}

          {step === "kind" && (
            <div className="space-y-4">
              <p className="text-sm font-medium">O que você está importando?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SourceCard
                  icon={<FileText className="h-6 w-6" />}
                  title="Extrato bancário"
                  desc="Pix, débito, transferências e tarifas"
                  onClick={() => startAnalysis("extrato")}
                />
                <SourceCard
                  icon={<FileSpreadsheet className="h-6 w-6" />}
                  title="Fatura de cartão"
                  desc="Compras lançadas no crédito"
                  onClick={() => startAnalysis("fatura")}
                />
              </div>
              <button
                onClick={() => setStep("upload")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Voltar
              </button>
            </div>
          )}

          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Estamos analisando seus lançamentos…</p>
              <p className="text-xs text-muted-foreground">{ANALYZING_MESSAGES[analyzingIdx]}</p>
            </div>
          )}

          {step === "cartao" && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Em qual cartão entram essas compras?</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vincular o cartão deixa a fatura, os limites e os relatórios corretos.
                </p>
              </div>
              {sugestaoCartao && (
                <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    Sugerimos{" "}
                    <strong>
                      {cartoes.find((c) => c.id === sugestaoCartao.cartaoId)?.nome ?? "um cartão"}
                    </strong>{" "}
                    porque {sugestaoCartao.motivo}.
                  </span>
                </div>
              )}
              <div className="space-y-2">
                {cartoes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCartaoSelecionado(c.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                      cartaoSelecionado === c.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent/40",
                    )}
                  >
                    <span
                      className="h-8 w-8 rounded-lg shrink-0"
                      style={{ backgroundColor: c.cor }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.nome}</span>
                      <span className="block text-xs text-muted-foreground">{c.banco}</span>
                    </span>
                    {cartaoSelecionado === c.id && (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  disabled={!cartaoSelecionado}
                  onClick={() => confirmarCartaoFatura(cartaoSelecionado)}
                >
                  Continuar
                </Button>
                <Button variant="ghost" onClick={() => confirmarCartaoFatura(null)}>
                  Importar sem vincular cartão
                </Button>
              </div>
              <button
                onClick={() => setStep("upload")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Voltar
              </button>
            </div>
          )}


          {step === "review" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-medium">{items.length} lançamentos encontrados</p>
                  <p className="text-xs text-muted-foreground">
                    {totalSelecionados} selecionados para importar
                    {duplicadosCount > 0 ? ` • ${duplicadosCount} possíveis duplicados` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAllSelected(true)}>
                    Selecionar todos
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAllSelected(false)}>
                    Desmarcar todos
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["todos", "Todos"],
                    ["selecionados", "Selecionados"],
                    ["duplicados", "Possíveis duplicados"],
                    ["gastos", "Gastos"],
                    ["receitas", "Receitas"],
                    ["transferencias", "Transferências"],
                    ["outros", "A revisar"],

                  ] as Array<[ReviewFilter, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setFilter(id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      filter === id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <ReviewStep
                items={itensFiltrados}
                onUpdate={updateItem}
                onRemove={removeItem}
                onAdd={addEmptyItem}
                categorias={categorias}
                cartoes={cartoes}

                observacaoIA={observacaoIA}
                resumoExtrato={resumoExtrato}
              />
            </div>
          )}

          {step === "done" && result && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-base font-semibold">Importação concluída</p>
              <div className="text-sm text-muted-foreground space-y-0.5">
                <p>{result.adicionados} lançamentos adicionados</p>
                <p>{result.duplicados} duplicados ignorados</p>
                <p>{result.naoImportados} itens não importados</p>
              </div>
              <p className="text-lg font-semibold">{formatBRL(result.total)}</p>
              <div className="flex gap-2 pt-2">
                <Button onClick={() => handleClose(false)}>Ver gastos importados</Button>
                <Button variant="ghost" onClick={() => handleClose(false)}>
                  Concluir
                </Button>
              </div>
            </div>
          )}
        </div>

        {step === "review" && (
          <div className="border-t px-6 py-3 bg-card flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Total a importar:{" "}
              <span className="font-semibold text-foreground">
                {formatBRL(totalSelecionadoValor)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
                {t("footer.cancel")}
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={totalSelecionados === 0}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Importar {totalSelecionados} lançamentos
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      <PremiumLockModal
        open={premiumGate.state.open}
        onOpenChange={(v) => {
          if (!v) premiumGate.close();
        }}
        title={premiumGate.state.title}
        description={premiumGate.state.description}
        feature={premiumGate.state.feature ?? undefined}
      />
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
  files,
  onAddFiles,
  onRemoveFile,
  onAnalyze,
}: {
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (idx: number) => void;
  onAnalyze: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length > 0) onAddFiles(dropped);
        }}
        className={cn(
          "rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <Sparkles className="mx-auto h-8 w-8 text-primary mb-3" />
        <p className="text-sm font-medium mb-1">Importe seus gastos</p>
        <p className="text-xs text-muted-foreground mb-4">
          Arraste aqui ou selecione um PDF, CSV ou imagem (prints também funcionam).
        </p>
        <input
          ref={ref}
          type="file"
          accept="application/pdf,.csv,text/csv,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) onAddFiles(picked);
            e.target.value = "";
          }}
        />
        <Button onClick={() => ref.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          Selecionar arquivo
        </Button>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2"
            >
              {detectFileKind(f) === "imagem" ? (
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : detectFileKind(f) === "csv" ? (
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(f.size)}</p>
              </div>
              <button
                onClick={() => onRemoveFile(idx)}
                aria-label="Remover arquivo"
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button className="w-full" onClick={onAnalyze}>
            <Sparkles className="h-4 w-4 mr-2" />
            Analisar arquivo
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Seus dados são utilizados somente para processar esta importação. O arquivo não é
        armazenado — apenas os lançamentos que você confirmar são salvos.
      </p>
    </div>
  );
}

function ReviewStep({
  items,
  onUpdate,
  onRemove,
  onAdd,
  categorias,
  cartoes,
  observacaoIA,
  resumoExtrato,
}: {
  items: ReviewItem[];
  onUpdate: (id: string, patch: Partial<ReviewItem>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  categorias: ReturnType<typeof getCategorias>;
  cartoes: ReturnType<typeof getCartoes>;
  observacaoIA: string | null;
  resumoExtrato: ExtratoResumo | null;
}) {

  const { t } = useTranslation("import-extrato");
  return (
    <div className="space-y-3">
      {resumoExtrato && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl border bg-card p-3 text-xs">
          <ResumoItem label={t("review.banco")} value={resumoExtrato.banco ?? "—"} />
          <ResumoItem
            label={t("review.periodo")}
            value={
              [resumoExtrato.periodoInicio, resumoExtrato.periodoFim].filter(Boolean).join(" a ") ||
              "—"
            }
          />
          <ResumoItem
            label={t("review.saldoFinal")}
            value={resumoExtrato.saldoFinal != null ? formatBRL(resumoExtrato.saldoFinal) : "—"}
          />
          <ResumoItem
            label={t("review.saldoInicial")}
            value={resumoExtrato.saldoInicial != null ? formatBRL(resumoExtrato.saldoInicial) : "—"}
          />
          <ResumoItem
            label={t("review.entradas")}
            value={
              resumoExtrato.totalEntradas != null ? formatBRL(resumoExtrato.totalEntradas) : "—"
            }
          />
          <ResumoItem
            label={t("review.saidas")}
            value={resumoExtrato.totalSaidas != null ? formatBRL(resumoExtrato.totalSaidas) : "—"}
          />
        </div>
      )}
      {observacaoIA && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span>{observacaoIA}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Exibindo {items.length} lançamento(s)</p>

        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t("review.addRow")}
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

function ResumoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium truncate">{value}</p>
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
  const { t } = useTranslation("import-extrato");
  const dupBadge =
    item.dupStatus === "duplicado_existente"
      ? {
          label: t("row.badge.exists"),
          color: "bg-amber-500/15 text-amber-600 border-amber-500/30",
        }
      : item.dupStatus === "duplicado_lote"
        ? {
            label: t("row.badge.repeated"),
            color: "bg-orange-500/15 text-orange-600 border-orange-500/30",
          }
        : item.valor === null || !item.data || !item.descricao
          ? {
              label: t("row.badge.incomplete"),
              color: "bg-red-500/15 text-red-600 border-red-500/30",
            }
          : item.statusRevisao === "reserva"
            ? {
                label: t("row.badge.reserva"),
                color: "bg-violet-500/15 text-violet-600 border-violet-500/30",
              }
            : item.statusRevisao === "resgate_reserva"
              ? {
                  label: t("row.badge.resgateReserva"),
                  color: "bg-violet-500/15 text-violet-600 border-violet-500/30",
                }
              : item.statusRevisao === "pagamento_fatura_cartao"
                ? {
                    label: t("row.badge.pagamentoFatura"),
                    color: "bg-sky-500/15 text-sky-600 border-sky-500/30",
                  }
                : item.statusRevisao === "revisar"
                  ? {
                      label: t("row.badge.revisar"),
                      color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
                    }
                  : {
                      label: t("row.badge.novo"),
                      color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
                    };

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
                ? t("row.tipos.despesa")
                : item.tipoMovimentacao === "receita"
                  ? t("row.tipos.receita")
                  : t("row.tipos.transferenciaShort")}
            </Badge>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("row.remove")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{t("row.descricao")}</Label>
          <Input
            value={item.descricao}
            onChange={(e) => onUpdate({ descricao: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">{t("row.valor")}</Label>
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
          <Label className="text-xs">{t("row.data")}</Label>
          <Input
            type="date"
            value={item.data ?? ""}
            onChange={(e) => onUpdate({ data: e.target.value || null })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">{t("row.horario")}</Label>
          <Input
            type="time"
            value={item.horario ?? ""}
            onChange={(e) => onUpdate({ horario: e.target.value || null })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">{t("row.tipo")}</Label>
          <Select
            value={item.tipoMovimentacao}
            onValueChange={(v) => onUpdate({ tipoMovimentacao: v as TipoMov })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="despesa">{t("row.tipos.despesa")}</SelectItem>
              <SelectItem value="receita">{t("row.tipos.receita")}</SelectItem>
              <SelectItem value="transferencia_interna">
                {t("row.tipos.transferencia_interna")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {item.tipoMovimentacao !== "transferencia_interna" && (
          <div>
            <Label className="text-xs">{t("row.formaPg")}</Label>
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
            <Label className="text-xs">{t("row.categoria")}</Label>
            <Select value={item.categoriaId} onValueChange={(v) => onUpdate({ categoriaId: v })}>
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
          {t("row.total")}{" "}
          <span className="font-semibold text-foreground">{formatBRL(item.valor)}</span>
        </div>
      )}
    </div>
  );
}
