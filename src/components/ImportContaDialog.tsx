import { useRef, useState } from "react";
import { Upload, Loader2, AlertTriangle, FileText, ImageIcon } from "lucide-react";
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
import { toast } from "sonner";
import {
  addContaAPagar,
  findContaByCodigo,
  findContaDuplicado,
  getCategorias,
  useStore,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import { parseBRLInput, todayISO } from "@/lib/format";

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

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImportContaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const categorias = useStore(() => getCategorias());
  const [aba, setAba] = useState<"imagem" | "texto">("imagem");
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [conta, setConta] = useState<ContaExtraida | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Campos editáveis na revisão
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
      const res = await fetch("/api/import-conta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? "Falha ao ler a conta.");
        return;
      }
      if (!json.conta) {
        toast.warning(json.observacao ?? "Nada de útil identificado.");
        return;
      }
      aplicarConta(json.conta);
      toast.success("Dados extraídos. Revise antes de salvar.");
    } catch (err) {
      console.error(err);
      toast.error("Erro de rede ao processar a conta.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem (JPG, PNG, WEBP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 10MB).");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    await processar({ images: [dataUrl] });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleTexto() {
    if (!texto.trim()) {
      toast.error("Cole o texto do boleto/Pix.");
      return;
    }
    await processar({ text: texto });
  }

  function handleSalvar() {
    const valor = parseBRLInput(valorStr);
    if (!nome.trim()) return toast.error("Informe o nome da conta.");
    if (!Number.isFinite(valor) || valor <= 0)
      return toast.error("Valor inválido.");
    if (!vencimento) return toast.error("Informe o vencimento.");

    // Bloqueio por código de boleto/Pix idêntico
    if (codigoBoleto.trim()) {
      const dup = findContaByCodigo(codigoBoleto, "boleto");
      if (dup) {
        toast.error("Esta conta parece já estar cadastrada (mesmo código de boleto).");
        return;
      }
    }
    if (codigoPix.trim()) {
      const dup = findContaByCodigo(codigoPix, "pix");
      if (dup) {
        toast.error("Esta conta parece já estar cadastrada (mesmo código Pix).");
        return;
      }
    }

    // Aviso de possível duplicado por valor + vencimento + nome
    const possivel = findContaDuplicado({
      valor,
      dataVencimento: vencimento,
      nome,
      beneficiario: beneficiario || undefined,
    });
    if (possivel) {
      const ok = window.confirm(
        `Já existe uma conta parecida ("${possivel.nome}", ${possivel.dataVencimento}). Salvar mesmo assim?`,
      );
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
    toast.success("Conta importada e salva. ✅");
    handleClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar conta</DialogTitle>
          <DialogDescription>
            Tire foto do boleto/Pix ou cole o texto. Você revisa antes de salvar.
          </DialogDescription>
        </DialogHeader>

        {!conta && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={aba === "imagem" ? "default" : "outline"}
                onClick={() => setAba("imagem")}
                disabled={loading}
              >
                <ImageIcon className="mr-1 h-4 w-4" />
                Imagem
              </Button>
              <Button
                variant={aba === "texto" ? "default" : "outline"}
                onClick={() => setAba("texto")}
                disabled={loading}
              >
                <FileText className="mr-1 h-4 w-4" />
                Texto
              </Button>
            </div>

            {aba === "imagem" ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Foto ou print do boleto/Pix</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  JPG, PNG ou WEBP até 10MB.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => fileRef.current?.click()}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      Lendo…
                    </>
                  ) : (
                    "Selecionar imagem"
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="conta-texto">Cole o texto</Label>
                <Textarea
                  id="conta-texto"
                  rows={6}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Cole aqui o texto do boleto, Pix copia e cola, ou da fatura..."
                />
                <Button onClick={handleTexto} disabled={loading} className="w-full">
                  {loading ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      Lendo…
                    </>
                  ) : (
                    "Extrair dados"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {conta && (
          <div className="space-y-3">
            {conta.confianca === "baixa" && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Confiança baixa na leitura. Confira todos os campos com atenção
                  antes de salvar.
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="imp-nome">Nome da conta</Label>
              <Input id="imp-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-benef">Beneficiário</Label>
              <Input
                id="imp-benef"
                value={beneficiario}
                onChange={(e) => setBeneficiario(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-valor">Valor</Label>
                <Input
                  id="imp-valor"
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-venc">Vencimento</Label>
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
                <Label>Forma</Label>
                <Select
                  value={forma || "_none"}
                  onValueChange={(v) => setForma((v === "_none" ? "" : v) as FormaPagamento | "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">—</SelectItem>
                    {FORMAS_PAGAMENTO.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={categoriaId || "_none"}
                  onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sem categoria</SelectItem>
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
              <Label htmlFor="imp-boleto">Código do boleto</Label>
              <Input
                id="imp-boleto"
                value={codigoBoleto}
                onChange={(e) => setCodigoBoleto(e.target.value)}
                placeholder="Linha digitável"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-pix">Pix copia e cola</Label>
              <Textarea
                id="imp-pix"
                rows={2}
                value={codigoPix}
                onChange={(e) => setCodigoPix(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-chave">Chave Pix</Label>
                <Input
                  id="imp-chave"
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-banco">Banco emissor</Label>
                <Input
                  id="imp-banco"
                  value={bancoEmissor}
                  onChange={(e) => setBancoEmissor(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="imp-obs">Observação</Label>
              <Textarea
                id="imp-obs"
                rows={2}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {conta ? (
            <>
              <Button variant="outline" onClick={() => setConta(null)}>
                Voltar
              </Button>
              <Button onClick={handleSalvar}>Salvar conta</Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
