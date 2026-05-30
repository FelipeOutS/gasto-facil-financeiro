import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import {
  type Ativo,
  atualizarValorAtivo,
  tipoLabel,
  getTipoInvestimentoLabel,
  formatarDataHora,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export type InvestimentoAtualizarValorFormProps = {
  userId?: string;
  ativo: Ativo;
  resetKey?: number | string | boolean;
  onSaved: () => void;
  onCancel?: () => void;
};

export function InvestimentoAtualizarValorForm({
  userId,
  ativo,
  resetKey,
  onSaved,
  onCancel,
}: InvestimentoAtualizarValorFormProps) {
  const [valorAtual, setValorAtual] = useState("");
  const [precoAtual, setPrecoAtual] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [data, setData] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);

  const isVariavel = ["acoes", "fii", "etf", "bdr", "cripto"].includes(ativo.tipo);

  useEffect(() => {
    setValorAtual(ativo.valor_atual != null ? String(ativo.valor_atual).replace(".", ",") : "");
    setPrecoAtual(ativo.preco_atual != null ? String(ativo.preco_atual).replace(".", ",") : "");
    setQuantidade(ativo.quantidade != null ? String(ativo.quantidade).replace(".", ",") : "");
    setObservacao("");
    setData(todayISO());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo.id, resetKey]);

  useEffect(() => {
    if (!isVariavel) return;
    const p = Number(precoAtual.replace(",", "."));
    const q = Number(quantidade.replace(",", "."));
    if (p > 0 && q > 0) {
      setValorAtual((p * q).toFixed(2).replace(".", ","));
    }
  }, [precoAtual, quantidade, isVariavel]);

  async function salvar() {
    if (!userId) return;
    const valorNovo = parseBRLInput(valorAtual);
    if (!Number.isFinite(valorNovo) || valorNovo < 0) {
      toast.error("Informe um valor atual válido.");
      return;
    }
    setSalvando(true);
    try {
      await atualizarValorAtivo(userId, ativo, {
        valor_novo: valorNovo,
        preco_novo: precoAtual ? parseBRLInput(precoAtual) : null,
        quantidade: quantidade ? Number(quantidade.replace(",", ".")) : null,
        observacao: observacao || null,
        data_atualizacao: new Date(data + "T" + new Date().toTimeString().slice(0, 8)).toISOString(),
        origem: "manual",
      });
      toast.success("Valor atualizado.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível atualizar o valor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Investimento</label>
        <div className="text-sm font-medium">{ativo.nome}</div>
        <div className="text-[11px] text-muted-foreground">
          {tipoLabel(ativo.tipo)}
          {ativo.instituicao ? ` · ${ativo.instituicao}` : ""}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Valor aplicado</label>
        <Input
          value={formatBRL(Number(ativo.valor_aplicado || 0))}
          disabled
          className="bg-muted/30 min-h-11"
        />
      </div>

      {isVariavel && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Preço atual</label>
            <Input
              value={precoAtual}
              onChange={(e) => setPrecoAtual(e.target.value)}
              placeholder="0,00"
              className="min-h-11"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Quantidade</label>
            <Input
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              placeholder="0"
              className="min-h-11"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground">
          Valor atual{isVariavel ? " (calculado)" : ""}
        </label>
        <Input
          value={valorAtual}
          onChange={(e) => setValorAtual(e.target.value)}
          placeholder="0,00"
          className="min-h-11"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Data da atualização</label>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="min-h-11" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Observação</label>
        <Textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex.: cotação consultada na corretora"
          rows={2}
        />
      </div>

      {ativo.ultima_atualizacao && (
        <div className="text-[11px] text-muted-foreground">
          Última atualização: {formatarDataHora(ativo.ultima_atualizacao)}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={salvando} className="min-h-11">
            Cancelar
          </Button>
        )}
        <Button onClick={salvar} disabled={salvando} className="min-h-11">
          {salvando ? "Salvando…" : "Salvar atualização"}
        </Button>
      </div>
    </div>
  );
}
