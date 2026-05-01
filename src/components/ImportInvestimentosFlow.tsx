import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  TIPOS_INVESTIMENTO,
  type TipoInvestimento,
  criarAtivo,
  criarImportacao,
  atualizarResumoImportacao,
  type Ativo,
} from "@/lib/investimentos";
import { formatBRL } from "@/lib/format";

type Origem = "b3" | "corretora" | "csv" | "pdf";

type ItemBruto = {
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

type ItemEdit = ItemBruto & {
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
      "Envie um arquivo exportado da Área do Investidor da B3. O sistema tentará identificar seus investimentos automaticamente e você poderá revisar tudo antes de salvar.",
    aceita: ".pdf,.csv,.xlsx,.xls",
    tipoLog: "b3",
  },
  corretora: {
    titulo: "Importar extrato da corretora",
    descricao:
      "Envie um extrato exportado pela sua corretora. O sistema tentará identificar ativos, valores e quantidades automaticamente.",
    aceita: ".pdf,.csv,.xlsx,.xls",
    tipoLog: "corretora",
  },
  csv: {
    titulo: "Importar CSV / planilha",
    descricao:
      "Envie um CSV ou XLSX com seus ativos. Aceitamos colunas como Ativo, Ticker, Tipo, Quantidade, Preço médio, Valor aplicado, Valor atual, Instituição e Data.",
    aceita: ".csv,.xlsx,.xls",
    tipoLog: "csv",
  },
  pdf: {
    titulo: "Importar PDF",
    descricao:
      "Envie um extrato em PDF da sua corretora ou da B3. O sistema tentará identificar seus investimentos automaticamente e você poderá revisar tudo antes de salvar.",
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

function dedupKey(it: ItemBruto): string {
  return [
    (it.ticker || it.nome || "").toLowerCase().trim(),
    it.tipo,
    Math.round((it.valorAplicado ?? 0) * 100),
    Math.round((it.valorAtual ?? 0) * 100),
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
  const [step, setStep] = useState<"upload" | "processando" | "preview" | "salvando" | "feito">(
    "upload",
  );
  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemEdit[]>([]);
  const [resumo, setResumo] = useState<{
    importados: number;
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
      setItens([]);
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

  if (!origem) return null;
  const info = ORIGEM_INFO[origem];

  function marcarDuplicados(lista: ItemBruto[]): ItemEdit[] {
    const seen = new Set<string>();
    return lista.map((b) => {
      const k = dedupKey(b);
      const tickerKey = `${(b.ticker || b.nome || "").toLowerCase().trim()}|${b.tipo}`;
      const dup = seen.has(k) || existentesKeys.has(tickerKey);
      seen.add(k);
      return { ...b, _id: makeId(), _ignorado: false, _duplicado: dup };
    });
  }

  async function processar(arquivo: File) {
    setErro(null);
    setAviso(null);
    setStep("processando");
    try {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() || "";
      let payload: Record<string, unknown> = { origem };

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

      const resp = await fetch("/api/import-investimentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data?.error || "Não conseguimos ler este arquivo.");
        setStep("upload");
        return;
      }
      const brutos: ItemBruto[] = Array.isArray(data?.itens) ? data.itens : [];
      if (brutos.length === 0) {
        setErro(
          data?.observacao ||
            "Não conseguimos identificar investimentos neste arquivo. Tente outro arquivo ou cadastre manualmente.",
        );
        setStep("upload");
        return;
      }
      const marcados = marcarDuplicados(brutos);
      setItens(marcados);
      const naoProntos = marcados.filter(
        (i) => i.confianca === "baixa" || (!i.valorAplicado && !i.valorAtual),
      );
      if (naoProntos.length > 0) {
        setAviso(
          "O arquivo foi lido, mas alguns dados precisam de revisão antes de importar.",
        );
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

  async function confirmar() {
    if (!userId) return;
    const ativosParaSalvar = itens.filter((i) => !i._ignorado);
    if (ativosParaSalvar.length === 0) {
      toast.error("Nenhum item selecionado para importar.");
      return;
    }
    setStep("salvando");
    let ok = 0;
    let falhas = 0;
    let importacaoId: string | null = null;
    try {
      const imp = await criarImportacao(userId, {
        tipo: info.tipoLog,
        arquivo_nome: file?.name ?? null,
        status: "concluida",
        dados_extraidos: { total: itens.length },
      });
      importacaoId = imp.id;
    } catch (e) {
      console.error(e);
    }
    for (const it of ativosParaSalvar) {
      try {
        const valorAplicado = Number(it.valorAplicado ?? it.valorAtual ?? 0);
        const valorAtual = Number(it.valorAtual ?? it.valorAplicado ?? 0);
        await criarAtivo(userId, {
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
        ok++;
      } catch (e) {
        console.error(e);
        falhas++;
      }
    }
    if (importacaoId) {
      try {
        await atualizarResumoImportacao(importacaoId, {
          ativos: ok,
          movimentacoes: 0,
          rendimentos: 0,
        });
      } catch (e) {
        console.error(e);
      }
    }
    const ignorados = itens.length - ativosParaSalvar.length;
    setResumo({ importados: ok, ignorados, erros: falhas });
    setStep("feito");
    if (ok > 0) toast.success(`${ok} investimento(s) importado(s).`);
    if (falhas > 0) toast.error(`${falhas} item(ns) não puderam ser salvos.`);
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

  const prontos = itens.filter(
    (i) => !i._ignorado && i.confianca !== "baixa" && (i.valorAplicado || i.valorAtual),
  ).length;
  const revisar = itens.filter(
    (i) => !i._ignorado && (i.confianca === "baixa" || (!i.valorAplicado && !i.valorAtual)),
  ).length;
  const duplicados = itens.filter((i) => !i._ignorado && i._duplicado).length;
  const ignorados = itens.filter((i) => i._ignorado).length;

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
              <Button
                variant="outline"
                size="sm"
                onClick={baixarModelo}
                className="w-full"
              >
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
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Total: {itens.length}</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15">
                Prontos: {prontos}
              </Badge>
              {revisar > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15">
                  Revisar: {revisar}
                </Badge>
              )}
              {duplicados > 0 && (
                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/15">
                  Duplicados: {duplicados}
                </Badge>
              )}
              {ignorados > 0 && <Badge variant="outline">Ignorados: {ignorados}</Badge>}
            </div>

            {aviso && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{aviso}</span>
              </div>
            )}

            <div className="space-y-2">
              {itens.map((it) => (
                <ItemCard
                  key={it._id}
                  item={it}
                  onChange={(patch) =>
                    setItens((prev) =>
                      prev.map((p) => (p._id === it._id ? { ...p, ...patch } : p)),
                    )
                  }
                />
              ))}
            </div>
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
              {resumo.importados} importado(s), {resumo.ignorados} ignorado(s)
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
                  setItens([]);
                  setFile(null);
                  setStep("upload");
                }}
              >
                Importar outro arquivo
              </Button>
              <Button onClick={confirmar} disabled={prontos + duplicados === 0}>
                Confirmar importação
              </Button>
            </>
          )}
          {step === "feito" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setItens([]);
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
    </Dialog>
  );
}

function ItemCard({
  item,
  onChange,
}: {
  item: ItemEdit;
  onChange: (patch: Partial<ItemEdit>) => void;
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
