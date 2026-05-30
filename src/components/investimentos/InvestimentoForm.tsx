import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { parseBRLInput, todayISO } from "@/lib/format";
import {
  TIPOS_INVESTIMENTO,
  type Ativo,
  type TipoInvestimento,
  criarAtivo,
  atualizarAtivo,
  classeAtivo,
  getTipoInvestimentoLabel,
  getRentabilidadeTipoLabel,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export const RENT_TIPOS = [
  { id: "cdi", label: "% do CDI" },
  { id: "ipca", label: "IPCA +" },
  { id: "prefixado", label: "Prefixado" },
  { id: "selic", label: "Selic" },
  { id: "outro", label: "Outro" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export type InvestimentoFormProps = {
  userId?: string;
  editing: Ativo | null;
  /** Used as a reset trigger when the form is re-mounted in a Dialog. */
  resetKey?: number | string | boolean;
  onSaved: () => void;
  onCancel?: () => void;
  /** Hide internal buttons when the parent renders its own footer. */
  hideFooter?: boolean;
  submitLabel?: string;
};

export function InvestimentoForm({
  userId,
  editing,
  resetKey,
  onSaved,
  onCancel,
  hideFooter,
  submitLabel,
}: InvestimentoFormProps) {
  const { t: tr } = useTranslation("investimentos");
  const [nome, setNome] = useState("");
  const [ticker, setTicker] = useState("");
  const [tipo, setTipo] = useState<TipoInvestimento>("acoes");
  const [instituicao, setInstituicao] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [precoMedio, setPrecoMedio] = useState("");
  const [precoAtual, setPrecoAtual] = useState("");
  const [valorAplicado, setValorAplicado] = useState("");
  const [valorAtual, setValorAtual] = useState("");
  const [rentTipo, setRentTipo] = useState("");
  const [rentPct, setRentPct] = useState("");
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataVenc, setDataVenc] = useState("");
  const [liquidez, setLiquidez] = useState("");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAvancado, setShowAvancado] = useState(false);

  const classe = classeAtivo(tipo);
  const isRendaVariavel = classe === "Renda variável" || tipo === "cripto";
  const isRendaFixa = classe === "Renda fixa" || classe === "Fundos";

  useEffect(() => {
    if (!isRendaVariavel) return;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : NaN;
    const pm = precoMedio ? Number(precoMedio.replace(",", ".")) : NaN;
    if (!isNaN(qtd) && !isNaN(pm) && qtd > 0 && pm > 0) {
      const total = qtd * pm;
      setValorAplicado(total.toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantidade, precoMedio, isRendaVariavel]);

  useEffect(() => {
    if (!isRendaVariavel) return;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : NaN;
    const pa = precoAtual ? Number(precoAtual.replace(",", ".")) : NaN;
    if (!isNaN(qtd) && !isNaN(pa) && qtd > 0 && pa > 0) {
      const total = qtd * pa;
      setValorAtual(total.toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantidade, precoAtual, isRendaVariavel]);

  useEffect(() => {
    if (editing) {
      setNome(editing.nome);
      setTicker(editing.ticker ?? "");
      setTipo(editing.tipo);
      setInstituicao(editing.instituicao ?? "");
      setQuantidade(editing.quantidade?.toString() ?? "");
      setPrecoMedio(editing.preco_medio?.toString() ?? "");
      setPrecoAtual(editing.preco_atual?.toString() ?? "");
      setValorAplicado(editing.valor_aplicado.toString());
      setValorAtual(editing.valor_atual.toString());
      setRentTipo(editing.rentabilidade_tipo ?? "");
      setRentPct(editing.rentabilidade_percentual ?? "");
      setDataInicio(editing.data_inicio ?? todayISO());
      setDataVenc(editing.data_vencimento ?? "");
      setLiquidez(editing.liquidez ?? "");
      setObservacao(editing.observacao ?? "");
    } else {
      setNome(""); setTicker(""); setTipo("acoes"); setInstituicao("");
      setQuantidade(""); setPrecoMedio(""); setPrecoAtual("");
      setValorAplicado(""); setValorAtual("");
      setRentTipo(""); setRentPct(""); setDataInicio(todayISO()); setDataVenc("");
      setLiquidez(""); setObservacao("");
    }
  }, [editing, resetKey]);

  async function handleSave() {
    if (!userId) return;
    if (!nome.trim()) {
      toast.error("Informe o nome do investimento.");
      return;
    }
    const aplicado = parseBRLInput(valorAplicado) || 0;
    const atual = parseBRLInput(valorAtual) || aplicado;
    const qtd = quantidade ? Number(quantidade.replace(",", ".")) : null;
    const pm = precoMedio ? Number(precoMedio.replace(",", ".")) : null;
    const pa = precoAtual ? Number(precoAtual.replace(",", ".")) : null;
    const payload: Partial<Ativo> = {
      nome: nome.trim(),
      ticker: ticker.trim() || null,
      tipo,
      instituicao: instituicao.trim() || null,
      quantidade: qtd,
      preco_medio: pm,
      preco_atual: pa,
      valor_aplicado: aplicado,
      valor_atual: atual,
      rentabilidade_tipo: rentTipo || null,
      rentabilidade_percentual: rentPct.trim() || null,
      data_inicio: dataInicio || null,
      data_vencimento: dataVenc || null,
      liquidez: liquidez.trim() || null,
      observacao: observacao.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) {
        await atualizarAtivo(editing.id, payload);
        toast.success("Investimento atualizado.");
      } else {
        await criarAtivo(userId, payload);
        toast.success("Investimento cadastrado.");
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3">
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {isRendaVariavel
              ? "Use quantidade, preço médio e preço atual para calcular os valores automaticamente."
              : "Use valor aplicado e valor atual. Quantidade e preço médio não são necessários."}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo *">
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoInvestimento)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_INVESTIMENTO.map((it) => (
                  <SelectItem key={it.id} value={it.id}>{getTipoInvestimentoLabel(it.id, tr)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Instituição / corretora">
            <Input value={instituicao} onChange={(e) => setInstituicao(e.target.value)} placeholder="XP, Nubank, Rico…" />
          </Field>
        </div>

        <Field label="Nome do investimento *">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={isRendaVariavel ? "Ex.: Maxi Renda FII" : "Ex.: Tesouro Selic 2029"}
          />
        </Field>

        {isRendaVariavel && (
          <Field label="Ticker / código *">
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="MXRF11, PETR4, BTC…"
            />
          </Field>
        )}

        {isRendaVariavel && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Quantidade">
                <Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="10" />
              </Field>
              <Field label="Preço médio">
                <Input value={precoMedio} onChange={(e) => setPrecoMedio(e.target.value)} placeholder="10,20" />
              </Field>
              <Field label="Preço atual">
                <Input value={precoAtual} onChange={(e) => setPrecoAtual(e.target.value)} placeholder="10,50" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor aplicado (auto)">
                <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 102,00" />
              </Field>
              <Field label="Valor atual (auto)">
                <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 105,00" />
              </Field>
            </div>
            <Field label="Data da compra">
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </Field>
          </>
        )}

        {isRendaFixa && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor aplicado *">
                <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 1.000,00" />
              </Field>
              <Field label="Valor atual">
                <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 1.042,30" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo de rentabilidade">
                <Select value={rentTipo} onValueChange={setRentTipo}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {RENT_TIPOS.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Percentual / índice">
                <Input value={rentPct} onChange={(e) => setRentPct(e.target.value)} placeholder="110% do CDI" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data da aplicação">
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </Field>
              <Field label="Vencimento">
                <Input type="date" value={dataVenc} onChange={(e) => setDataVenc(e.target.value)} />
              </Field>
            </div>
            <Field label="Liquidez">
              <Input value={liquidez} onChange={(e) => setLiquidez(e.target.value)} placeholder="Diária, no vencimento…" />
            </Field>

            <button
              type="button"
              onClick={() => setShowAvancado((v) => !v)}
              className="text-xs text-brand hover:underline self-start"
            >
              {showAvancado ? "Ocultar campos avançados" : "Mostrar campos avançados (ticker, quantidade)"}
            </button>
            {showAvancado && (
              <div className="grid gap-3 rounded-lg border border-dashed border-border/60 p-3">
                <Field label="Ticker / código (opcional)">
                  <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="—" />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Quantidade">
                    <Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                  </Field>
                  <Field label="Preço médio">
                    <Input value={precoMedio} onChange={(e) => setPrecoMedio(e.target.value)} />
                  </Field>
                  <Field label="Preço atual">
                    <Input value={precoAtual} onChange={(e) => setPrecoAtual(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </>
        )}

        {!isRendaVariavel && !isRendaFixa && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor aplicado">
                <Input value={valorAplicado} onChange={(e) => setValorAplicado(e.target.value)} placeholder="R$ 1.000,00" />
              </Field>
              <Field label="Valor atual">
                <Input value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="R$ 1.042,30" />
              </Field>
            </div>
            <Field label="Data da aplicação">
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Observação">
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        </Field>
      </div>

      {!hideFooter && (
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={saving} className="h-11 sm:h-10">
              Cancelar
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="h-11 sm:h-10">
            {saving ? "Salvando…" : submitLabel ?? (editing ? "Salvar" : "Cadastrar")}
          </Button>
        </div>
      )}
    </div>
  );
}
