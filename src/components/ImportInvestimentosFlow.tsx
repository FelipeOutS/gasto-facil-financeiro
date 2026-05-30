import { apiFetch } from "@/lib/api-fetch";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePremiumApiGate } from "@/lib/premium-errors";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import * as XLSX from "@e965/xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  X,
  Pencil,
  Download,
  ArrowDownUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  TIPOS_INVESTIMENTO,
  TIPOS_MOVIMENTACAO,
  type TipoInvestimento,
  type TipoMovimentacao,
  criarAtivo,
  atualizarAtivo,
  criarMovimentacao,
  criarImportacao,
  atualizarResumoImportacao,
  recalcularAtivoPorMovimentacoes,
  type Ativo,
} from "@/lib/investimentos";
import { formatBRL } from "@/lib/format";

type Origem = "b3" | "corretora" | "csv" | "pdf";

type PosicaoBruta = {
  nome: string | null;
  ticker: string | null;
  tipo: TipoInvestimento;
  quantidade: number | null;
  precoMedio: number | null;
  valorAplicado: number | null;
  valorAtual: number | null;
  instituicao: string | null;
  dataInicio: string | null;
  dataVencimento: string | null;
  rentabilidadeTipo: string | null;
  rentabilidadePercentual: string | null;
  liquidez: string | null;
  observacao: string | null;
  confianca: "alta" | "media" | "baixa";
};

type MovimentacaoBruta = {
  data: string | null;
  tipo: TipoMovimentacao;
  nome: string | null;
  ticker: string | null;
  tipoAtivo: TipoInvestimento;
  quantidade: number | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  instituicao: string | null;
  observacao: string | null;
  confianca: "alta" | "media" | "baixa";
};

type PosicaoEdit = PosicaoBruta & {
  _id: string;
  _ignorado: boolean;
  _duplicado: boolean;
};

type MovimentacaoEdit = MovimentacaoBruta & {
  _id: string;
  _ignorado: boolean;
  _duplicado: boolean;
};

const ORIGEM_INFO: Record<
  Origem,
  { titulo: string; descricao: string; aceita: string; tipoLog: string }
> = {
  b3: {
    titulo: "Importar extrato da B3",
    descricao:
      "Envie um arquivo exportado da Área do Investidor da B3. Vamos identificar posições e movimentações automaticamente para você revisar antes de salvar.",
    aceita: ".pdf,.csv,.xlsx,.xls",
    tipoLog: "b3",
  },
  corretora: {
    titulo: "Importar extrato da corretora",
    descricao:
      "Envie um extrato exportado pela sua corretora. Vamos identificar posições e movimentações automaticamente.",
    aceita: ".pdf,.csv,.xlsx,.xls",
    tipoLog: "corretora",
  },
  csv: {
    titulo: "Importar CSV / planilha",
    descricao:
      "Envie um CSV ou XLSX com seus ativos ou movimentações. Vamos identificar tudo que conseguirmos para você revisar.",
    aceita: ".csv,.xlsx,.xls",
    tipoLog: "csv",
  },
  pdf: {
    titulo: "Importar PDF",
    descricao:
      "Envie um extrato em PDF da sua corretora ou da B3. Vamos identificar posições e movimentações para você revisar antes de salvar.",
    aceita: ".pdf",
    tipoLog: "pdf",
  },
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function parsePlanilha(file: File): Promise<{ colunas: string[]; linhas: string[][] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const rows = (aoa as unknown[][])
    .map((r) => r.map((c) => (c == null ? "" : String(c))))
    .filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { colunas: [], linhas: [] };
  const colunas = rows[0];
  const linhas = rows.slice(1);
  return { colunas, linhas };
}

function dedupKeyPosicao(it: PosicaoBruta): string {
  return [
    (it.ticker || it.nome || "").toLowerCase().trim(),
    it.tipo,
    Math.round((it.valorAplicado ?? 0) * 100),
    Math.round((it.valorAtual ?? 0) * 100),
  ].join("|");
}

function dedupKeyMov(it: MovimentacaoBruta): string {
  return [
    it.data || "",
    it.tipo,
    (it.ticker || it.nome || "").toLowerCase().trim(),
    Math.round((it.valorTotal ?? 0) * 100),
    Math.round((it.quantidade ?? 0) * 100),
    (it.instituicao || "").toLowerCase().trim(),
  ].join("|");
}

export function ImportInvestimentosFlow({
  open,
  origem,
  userId,
  onOpenChange,
  onImported,
  ativosExistentes,
}: {
  open: boolean;
  origem: Origem | null;
  userId: string | undefined;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
  ativosExistentes: Ativo[];
}) {
  const { t: tc } = useTranslation("common");
  const { t: ti } = useTranslation("import-investimentos");
  const premiumGate = usePremiumApiGate();
  const [step, setStep] = useState<"upload" | "processando" | "preview" | "salvando" | "feito">(
    "upload",
  );
  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [posicoes, setPosicoes] = useState<PosicaoEdit[]>([]);
  const [movs, setMovs] = useState<MovimentacaoEdit[]>([]);
  const [resumo, setResumo] = useState<{
    posImportadas: number;
    movImportadas: number;
    ignorados: number;
    erros: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setFile(null);
      setErro(null);
      setAviso(null);
      setPosicoes([]);
      setMovs([]);
      setResumo(null);
    }
  }, [open]);

  const existentesKeys = useMemo(() => {
    const set = new Set<string>();
    for (const a of ativosExistentes) {
      const ticker = (a.ticker || a.nome || "").toLowerCase().trim();
      set.add(`${ticker}|${a.tipo}`);
    }
    return set;
  }, [ativosExistentes]);

  const info = origem ? ORIGEM_INFO[origem] : null;

  function marcarPosicoes(lista: PosicaoBruta[]): PosicaoEdit[] {
    const seen = new Set<string>();
    return lista.map((b) => {
      const k = dedupKeyPosicao(b);
      const tickerKey = `${(b.ticker || b.nome || "").toLowerCase().trim()}|${b.tipo}`;
      const dup = seen.has(k) || existentesKeys.has(tickerKey);
      seen.add(k);
      return { ...b, _id: makeId(), _ignorado: false, _duplicado: dup };
    });
  }

  function marcarMovs(lista: MovimentacaoBruta[]): MovimentacaoEdit[] {
    const seen = new Set<string>();
    return lista.map((b) => {
      const k = dedupKeyMov(b);
      const dup = seen.has(k);
      seen.add(k);
      return { ...b, _id: makeId(), _ignorado: false, _duplicado: dup };
    });
  }

  async function processar(arquivo: File) {
    if (!origem) return;
    setErro(null);
    setAviso(null);
    setStep("processando");
    try {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() || "";
      const payload: Record<string, unknown> = { origem };

      if (ext === "pdf") {
        const b64 = await fileToBase64(arquivo);
        payload.pdf = b64;
      } else if (ext === "csv" || ext === "xlsx" || ext === "xls") {
        const { colunas, linhas } = await parsePlanilha(arquivo);
        if (linhas.length === 0) {
          setErro("Esse arquivo parece estar vazio ou em um formato não suportado.");
          setStep("upload");
          return;
        }
        payload.colunas = colunas;
        payload.linhas = linhas;
      } else {
        setErro("Formato não suportado. Envie PDF, CSV, XLSX ou XLS.");
        setStep("upload");
        return;
      }

      const resp = await apiFetch("/api/import-investimentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (
          premiumGate.handleResponse(resp, data, {
            title: tc("premium.premiumApi.importInvestimentos.title"),
            description: tc("premium.premiumApi.importInvestimentos.description"),
            fallbackFeature: "investimentos",
          })
        ) {
          setStep("upload");
          return;
        }
        setErro(data?.error || "Não conseguimos ler este arquivo.");
        setStep("upload");
        return;
      }
      const posBrutas: PosicaoBruta[] = Array.isArray(data?.posicoes)
        ? data.posicoes
        : Array.isArray(data?.itens)
        ? data.itens
        : [];
      const movBrutas: MovimentacaoBruta[] = Array.isArray(data?.movimentacoes)
        ? data.movimentacoes
        : [];

      if (posBrutas.length === 0 && movBrutas.length === 0) {
        setErro(
          data?.observacao ||
            "Conseguimos abrir o arquivo, mas não identificamos investimentos nem movimentações automaticamente. Você pode tentar outro arquivo ou cadastrar manualmente.",
        );
        setStep("upload");
        return;
      }

      const posEdit = marcarPosicoes(posBrutas);
      const movEdit = marcarMovs(movBrutas);
      setPosicoes(posEdit);
      setMovs(movEdit);

      if (posBrutas.length === 0 && movBrutas.length > 0) {
        setAviso("Encontramos movimentações no arquivo. Revise os dados antes de salvar.");
      } else {
        const naoProntos =
          posEdit.filter(
            (i) => i.confianca === "baixa" || (!i.valorAplicado && !i.valorAtual),
          ).length +
          movEdit.filter((m) => m.confianca === "baixa" || !m.data || !m.valorTotal).length;
        if (naoProntos > 0) {
          setAviso(
            "O arquivo foi lido, mas alguns dados precisam de revisão antes de importar.",
          );
        }
      }
      setStep("preview");
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao processar o arquivo.");
      setStep("upload");
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      processar(f);
    }
  }

  /** Encontra um ativo já existente por ticker+tipo ou nome+tipo. */
  function encontrarAtivo(
    poolNovos: Map<string, string>, // chave -> ativoId recém-criado
    ticker: string | null,
    nome: string | null,
    tipo: TipoInvestimento,
  ): { id: string; existente: Ativo | null } | null {
    const tk = (ticker || "").toLowerCase().trim();
    const nm = (nome || "").toLowerCase().trim();
    if (tk) {
      const poolId = poolNovos.get(`${tk}|${tipo}`);
      if (poolId) return { id: poolId, existente: null };
      const existente = ativosExistentes.find(
        (a) => (a.ticker || "").toLowerCase().trim() === tk && a.tipo === tipo,
      );
      if (existente) return { id: existente.id, existente };
    }
    if (nm) {
      const poolId = poolNovos.get(`nome:${nm}|${tipo}`);
      if (poolId) return { id: poolId, existente: null };
      const existente = ativosExistentes.find(
        (a) => !a.ticker && (a.nome || "").toLowerCase().trim() === nm && a.tipo === tipo,
      );
      if (existente) return { id: existente.id, existente };
    }
    return null;
  }

  async function confirmar() {
    if (!userId || !info) return;
    const posSalvar = posicoes.filter((i) => !i._ignorado);
    const movSalvar = movs.filter((m) => !m._ignorado && m.data && m.valorTotal);

    if (posSalvar.length === 0 && movSalvar.length === 0) {
      toast.error(ti("toast.noneSelected"));
      return;
    }
    setStep("salvando");

    let posOk = 0;
    let movOk = 0;
    let falhas = 0;
    let importacaoId: string | null = null;

    try {
      const imp = await criarImportacao(userId, {
        tipo: info.tipoLog,
        arquivo_nome: file?.name ?? null,
        status: "concluida",
        dados_extraidos: { posicoes: posicoes.length, movimentacoes: movs.length },
      });
      importacaoId = imp.id;
    } catch (e) {
      console.error(e);
    }

    // mapa: chave (ticker|tipo ou nome:nome|tipo) -> ativoId
    const novosCriados = new Map<string, string>();
    const ativosImpactados = new Set<string>();

    // 1) Salvar posições — cria ativos
    for (const it of posSalvar) {
      try {
        const valorAplicado = Number(it.valorAplicado ?? it.valorAtual ?? 0);
        const valorAtual = Number(it.valorAtual ?? it.valorAplicado ?? 0);
        const novo = await criarAtivo(userId, {
          nome: it.nome || it.ticker || "Ativo importado",
          ticker: it.ticker,
          tipo: it.tipo,
          instituicao: it.instituicao,
          quantidade: it.quantidade,
          preco_medio: it.precoMedio,
          preco_atual: it.precoMedio,
          valor_aplicado: valorAplicado,
          valor_atual: valorAtual,
          rentabilidade_tipo: it.rentabilidadeTipo,
          rentabilidade_percentual: it.rentabilidadePercentual,
          data_inicio: it.dataInicio,
          data_vencimento: it.dataVencimento,
          liquidez: it.liquidez,
          observacao: it.observacao,
          origem: `import_${info.tipoLog}`,
          importacao_id: importacaoId,
          ultima_atualizacao: new Date().toISOString(),
        });
        const tk = (it.ticker || "").toLowerCase().trim();
        const nm = (it.nome || "").toLowerCase().trim();
        if (tk) novosCriados.set(`${tk}|${it.tipo}`, novo.id);
        else if (nm) novosCriados.set(`nome:${nm}|${it.tipo}`, novo.id);
        posOk++;
      } catch (e) {
        console.error(e);
        falhas++;
      }
    }

    // 2) Salvar movimentações — vincula a ativo existente; se não houver, cria um esqueleto
    for (const m of movSalvar) {
      try {
        let ativoId: string | null = null;
        const found = encontrarAtivo(novosCriados, m.ticker, m.nome, m.tipoAtivo);
        if (found) {
          ativoId = found.id;
        } else if (m.nome || m.ticker) {
          // cria ativo esqueleto a partir da movimentação (ex: PDF só de movs)
          const ehEntrada =
            m.tipo === "compra" || m.tipo === "aplicacao";
          const valorRef = ehEntrada ? Number(m.valorTotal || 0) : 0;
          const novo = await criarAtivo(userId, {
            nome: m.nome || m.ticker || "Ativo importado",
            ticker: m.ticker,
            tipo: m.tipoAtivo,
            instituicao: m.instituicao,
            quantidade: ehEntrada ? m.quantidade : null,
            preco_medio: m.valorUnitario,
            preco_atual: m.valorUnitario,
            valor_aplicado: valorRef,
            valor_atual: valorRef,
            rentabilidade_tipo: null,
            rentabilidade_percentual: null,
            data_inicio: m.data,
            data_vencimento: null,
            liquidez: null,
            observacao: null,
            origem: `import_${info.tipoLog}`,
            importacao_id: importacaoId,
            ultima_atualizacao: new Date().toISOString(),
          });
          ativoId = novo.id;
          const tk = (m.ticker || "").toLowerCase().trim();
          const nm = (m.nome || "").toLowerCase().trim();
          if (tk) novosCriados.set(`${tk}|${m.tipoAtivo}`, novo.id);
          else if (nm) novosCriados.set(`nome:${nm}|${m.tipoAtivo}`, novo.id);
        }

        if (!ativoId) {
          falhas++;
          continue;
        }

        await criarMovimentacao(userId, {
          ativo_id: ativoId,
          tipo: m.tipo,
          data: m.data!,
          quantidade: m.quantidade,
          valor_unitario: m.valorUnitario,
          valor_total: Number(m.valorTotal || 0),
          instituicao: m.instituicao,
          observacao: m.observacao,
          origem: `import_${info.tipoLog}`,
          importacao_id: importacaoId ?? undefined,
        });
        ativosImpactados.add(ativoId);
        movOk++;
      } catch (e) {
        console.error(e);
        falhas++;
      }
    }

    // 3) Recalcular ativos afetados por movimentações
    for (const ativoId of ativosImpactados) {
      try {
        await recalcularAtivoPorMovimentacoes(userId, ativoId);
      } catch (e) {
        console.error(e);
      }
    }

    // 4) Atualizar resumo da importação
    if (importacaoId) {
      try {
        await atualizarResumoImportacao(importacaoId, {
          ativos: posOk,
          movimentacoes: movOk,
          rendimentos: 0,
        });
      } catch (e) {
        console.error(e);
      }
    }

    // marca data/última atualização para refletir no totalizador
    if (posOk > 0) {
      try {
        // já feito no criarAtivo; nada a fazer
        void atualizarAtivo;
      } catch {
        /* noop */
      }
    }

    const ignorados =
      posicoes.length + movs.length - posSalvar.length - movSalvar.length;
    setResumo({ posImportadas: posOk, movImportadas: movOk, ignorados, erros: falhas });
    setStep("feito");
    if (posOk + movOk > 0) {
      toast.success(
        ti("toast.partialSuccess", { positions: posOk, movements: movOk }),
      );
    }
    if (falhas > 0) toast.error(ti("toast.partialErrors", { count: falhas }));
    onImported();
  }


  function baixarModelo() {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "Ativo",
        "Ticker",
        "Tipo",
        "Quantidade",
        "Preço médio",
        "Valor aplicado",
        "Valor atual",
        "Instituição",
        "Data",
      ],
      ["Petrobras PN", "PETR4", "acoes", 100, "32,50", "3.250,00", "3.500,00", "XP", "01/05/2026"],
      ["Tesouro IPCA+ 2029", "", "tesouro", "", "", "5.000,00", "5.420,00", "Banco Inter", "10/01/2024"],
      ["CDB Inter 110% CDI", "", "cdb", "", "", "10.000,00", "10.580,00", "Banco Inter", "01/03/2025"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Investimentos");
    XLSX.writeFile(wb, "modelo-investimentos.xlsx");
  }

  const posProntos = posicoes.filter(
    (i) => !i._ignorado && i.confianca !== "baixa" && (i.valorAplicado || i.valorAtual),
  ).length;
  const posRevisar = posicoes.filter(
    (i) => !i._ignorado && (i.confianca === "baixa" || (!i.valorAplicado && !i.valorAtual)),
  ).length;
  const posDup = posicoes.filter((i) => !i._ignorado && i._duplicado).length;
  const movProntas = movs.filter(
    (m) => !m._ignorado && m.data && m.valorTotal && m.confianca !== "baixa",
  ).length;
  const movRevisar = movs.filter(
    (m) => !m._ignorado && (m.confianca === "baixa" || !m.data || !m.valorTotal),
  ).length;
  const movDup = movs.filter((m) => !m._ignorado && m._duplicado).length;
  const totalIgnorados =
    posicoes.filter((i) => i._ignorado).length + movs.filter((m) => m._ignorado).length;

  if (!info) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" />
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{info.titulo}</DialogTitle>
          <DialogDescription>{info.descricao}</DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-border/70 hover:border-primary/60 bg-muted/30 hover:bg-muted/50 transition-colors p-8 text-center cursor-pointer"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center mb-3">
                {origem === "csv" ? (
                  <FileSpreadsheet className="h-6 w-6 text-primary" />
                ) : origem === "pdf" ? (
                  <FileText className="h-6 w-6 text-primary" />
                ) : (
                  <Upload className="h-6 w-6 text-primary" />
                )}
              </div>
              <div className="font-medium text-sm">
                Clique para escolher um arquivo ou arraste aqui
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Formatos aceitos: {info.aceita.replace(/\./g, "").toUpperCase()}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={info.aceita}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    processar(f);
                  }
                }}
              />
            </div>

            {origem === "csv" && (
              <Button variant="outline" size="sm" onClick={baixarModelo} className="w-full">
                <Download className="h-3.5 w-3.5 mr-1.5" /> Baixar modelo de planilha
              </Button>
            )}

            {erro && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive p-3 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{erro}</span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Não pedimos senha, CPF, token bancário ou acesso à sua conta. A importação
                usa apenas arquivos enviados por você.
              </span>
            </div>
          </div>
        )}

        {step === "processando" && (
          <div className="py-10 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary mb-3" />
            <div className="text-sm font-medium">Lendo o arquivo…</div>
            <div className="text-xs text-muted-foreground mt-1">
              Isso pode levar alguns segundos.
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">
                Posições: {posicoes.length} · Movimentações: {movs.length}
              </Badge>
              {posProntos + movProntas > 0 && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15">
                  Prontos: {posProntos + movProntas}
                </Badge>
              )}
              {posRevisar + movRevisar > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15">
                  Revisar: {posRevisar + movRevisar}
                </Badge>
              )}
              {posDup + movDup > 0 && (
                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/15">
                  Duplicados: {posDup + movDup}
                </Badge>
              )}
              {totalIgnorados > 0 && (
                <Badge variant="outline">Ignorados: {totalIgnorados}</Badge>
              )}
            </div>

            {aviso && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{aviso}</span>
              </div>
            )}

            {posicoes.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4 text-primary" />
                  Investimentos encontrados
                  <span className="text-xs text-muted-foreground font-normal">
                    ({posicoes.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {posicoes.map((it) => (
                    <PosicaoCard
                      key={it._id}
                      item={it}
                      onChange={(patch) =>
                        setPosicoes((prev) =>
                          prev.map((p) => (p._id === it._id ? { ...p, ...patch } : p)),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {movs.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ArrowDownUp className="h-4 w-4 text-primary" />
                  Movimentações encontradas
                  <span className="text-xs text-muted-foreground font-normal">
                    ({movs.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {movs.map((m) => (
                    <MovimentacaoCard
                      key={m._id}
                      item={m}
                      onChange={(patch) =>
                        setMovs((prev) =>
                          prev.map((p) => (p._id === m._id ? { ...p, ...patch } : p)),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {step === "salvando" && (
          <div className="py-10 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary mb-3" />
            <div className="text-sm font-medium">Salvando seus investimentos…</div>
          </div>
        )}

        {step === "feito" && resumo && (
          <div className="py-6 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 grid place-items-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="text-base font-semibold">Importação concluída</div>
            <div className="text-sm text-muted-foreground">
              {resumo.posImportadas} posição(ões), {resumo.movImportadas} movimentação(ões),{" "}
              {resumo.ignorados} ignorado(s)
              {resumo.erros > 0 ? `, ${resumo.erros} com erro` : ""}.
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPosicoes([]);
                  setMovs([]);
                  setFile(null);
                  setStep("upload");
                }}
              >
                Importar outro arquivo
              </Button>
              <Button
                onClick={confirmar}
                disabled={posProntos + posDup + movProntas + movDup === 0}
              >
                Confirmar importação
              </Button>
            </>
          )}
          {step === "feito" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setPosicoes([]);
                  setMovs([]);
                  setFile(null);
                  setResumo(null);
                  setStep("upload");
                }}
              >
                Importar outro arquivo
              </Button>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </>
          )}
          {(step === "upload" || step === "processando") && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <PremiumLockModal
        open={premiumGate.state.open}
        onOpenChange={(v) => { if (!v) premiumGate.close(); }}
        title={premiumGate.state.title}
        description={premiumGate.state.description}
        feature={premiumGate.state.feature ?? undefined}
      />
    </Dialog>
  );
}

function PosicaoCard({
  item,
  onChange,
}: {
  item: PosicaoEdit;
  onChange: (patch: Partial<PosicaoEdit>) => void;
}) {
  const [editando, setEditando] = useState(false);
  const status = item._ignorado
    ? { label: "Ignorado", cls: "bg-muted text-muted-foreground" }
    : item._duplicado
    ? {
        label: "Possível duplicado",
        cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
      }
    : item.confianca === "baixa" || (!item.valorAplicado && !item.valorAtual)
    ? {
        label: "Precisa revisar",
        cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      }
    : {
        label: "Pronto",
        cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };

  return (
    <div
      className={`rounded-xl border border-border/60 p-3 ${
        item._ignorado ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium text-sm truncate">
              {item.nome || item.ticker || "—"}
            </div>
            {item.ticker && (
              <Badge variant="outline" className="text-[10px]">
                {item.ticker}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {TIPOS_INVESTIMENTO.find((t) => t.id === item.tipo)?.label || item.tipo}
            </Badge>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {item.quantidade != null && <span>Qtd: {item.quantidade}</span>}
            {item.precoMedio != null && <span>PM: {formatBRL(item.precoMedio)}</span>}
            {item.valorAplicado != null && (
              <span>Aplicado: {formatBRL(item.valorAplicado)}</span>
            )}
            {item.valorAtual != null && <span>Atual: {formatBRL(item.valorAtual)}</span>}
            {item.instituicao && <span>{item.instituicao}</span>}
            {item.dataInicio && <span>{item.dataInicio}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditando((v) => !v)}
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onChange({ _ignorado: !item._ignorado })}
            title={item._ignorado ? "Restaurar" : "Ignorar"}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editando && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Field label="Nome">
            <Input
              value={item.nome ?? ""}
              onChange={(e) => onChange({ nome: e.target.value })}
            />
          </Field>
          <Field label="Ticker">
            <Input
              value={item.ticker ?? ""}
              onChange={(e) => onChange({ ticker: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Tipo">
            <Select
              value={item.tipo}
              onValueChange={(v) => onChange({ tipo: v as TipoInvestimento })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INVESTIMENTO.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Instituição">
            <Input
              value={item.instituicao ?? ""}
              onChange={(e) => onChange({ instituicao: e.target.value })}
            />
          </Field>
          <Field label="Quantidade">
            <Input
              type="number"
              value={item.quantidade ?? ""}
              onChange={(e) =>
                onChange({ quantidade: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label="Preço médio">
            <Input
              type="number"
              value={item.precoMedio ?? ""}
              onChange={(e) =>
                onChange({ precoMedio: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label="Valor aplicado">
            <Input
              type="number"
              value={item.valorAplicado ?? ""}
              onChange={(e) =>
                onChange({
                  valorAplicado: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <Field label="Valor atual">
            <Input
              type="number"
              value={item.valorAtual ?? ""}
              onChange={(e) =>
                onChange({
                  valorAtual: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <Field label="Data">
            <Input
              type="date"
              value={item.dataInicio ?? ""}
              onChange={(e) => onChange({ dataInicio: e.target.value || null })}
            />
          </Field>
          <Field label="Vencimento">
            <Input
              type="date"
              value={item.dataVencimento ?? ""}
              onChange={(e) => onChange({ dataVencimento: e.target.value || null })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function MovimentacaoCard({
  item,
  onChange,
}: {
  item: MovimentacaoEdit;
  onChange: (patch: Partial<MovimentacaoEdit>) => void;
}) {
  const [editando, setEditando] = useState(false);
  const precisaRevisar = item.confianca === "baixa" || !item.data || !item.valorTotal;
  const status = item._ignorado
    ? { label: "Ignorado", cls: "bg-muted text-muted-foreground" }
    : item._duplicado
    ? {
        label: "Possível duplicado",
        cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
      }
    : precisaRevisar
    ? {
        label: "Precisa revisar",
        cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      }
    : {
        label: "Pronto",
        cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };

  const tipoLabel =
    TIPOS_MOVIMENTACAO.find((t) => t.id === item.tipo)?.label || item.tipo;

  return (
    <div
      className={`rounded-xl border border-border/60 p-3 ${
        item._ignorado ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">
              {tipoLabel}
            </Badge>
            <div className="font-medium text-sm truncate">
              {item.nome || item.ticker || "—"}
            </div>
            {item.ticker && (
              <Badge variant="outline" className="text-[10px]">
                {item.ticker}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {TIPOS_INVESTIMENTO.find((t) => t.id === item.tipoAtivo)?.label ||
                item.tipoAtivo}
            </Badge>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {item.data && <span>{item.data}</span>}
            {item.quantidade != null && <span>Qtd: {item.quantidade}</span>}
            {item.valorUnitario != null && (
              <span>Unit.: {formatBRL(item.valorUnitario)}</span>
            )}
            {item.valorTotal != null && (
              <span>Total: {formatBRL(item.valorTotal)}</span>
            )}
            {item.instituicao && <span>{item.instituicao}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditando((v) => !v)}
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onChange({ _ignorado: !item._ignorado })}
            title={item._ignorado ? "Restaurar" : "Ignorar"}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editando && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Field label="Tipo da movimentação">
            <Select
              value={item.tipo}
              onValueChange={(v) => onChange({ tipo: v as TipoMovimentacao })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_MOVIMENTACAO.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Data">
            <Input
              type="date"
              value={item.data ?? ""}
              onChange={(e) => onChange({ data: e.target.value || null })}
            />
          </Field>
          <Field label="Nome do ativo">
            <Input
              value={item.nome ?? ""}
              onChange={(e) => onChange({ nome: e.target.value })}
            />
          </Field>
          <Field label="Ticker">
            <Input
              value={item.ticker ?? ""}
              onChange={(e) => onChange({ ticker: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Tipo do ativo">
            <Select
              value={item.tipoAtivo}
              onValueChange={(v) => onChange({ tipoAtivo: v as TipoInvestimento })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INVESTIMENTO.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Instituição">
            <Input
              value={item.instituicao ?? ""}
              onChange={(e) => onChange({ instituicao: e.target.value })}
            />
          </Field>
          <Field label="Quantidade">
            <Input
              type="number"
              value={item.quantidade ?? ""}
              onChange={(e) =>
                onChange({ quantidade: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label="Valor unitário">
            <Input
              type="number"
              value={item.valorUnitario ?? ""}
              onChange={(e) =>
                onChange({ valorUnitario: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label="Valor total">
            <Input
              type="number"
              value={item.valorTotal ?? ""}
              onChange={(e) =>
                onChange({ valorTotal: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted-foreground mb-0.5 block">
        {label}
      </span>
      {children}
    </label>
  );
}
