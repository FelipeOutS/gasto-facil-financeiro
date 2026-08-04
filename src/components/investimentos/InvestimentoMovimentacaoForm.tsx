import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Info } from "lucide-react";
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
  TIPOS_MOVIMENTACAO,
  type Ativo,
  type Movimentacao,
  type TipoMovimentacao,
  isRendaVariavel,
  tipoLabel,
  getTipoInvestimentoLabel,
  getTipoMovimentacaoLabel,
  criarMovimentacao,
  atualizarMovimentacao,
  recalcularAtivoPorMovimentacoes,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export const TIPOS_MOV_PRINCIPAIS: TipoMovimentacao[] = [
  "compra",
  "venda",
  "aplicacao",
  "resgate",
  "transferencia",
  "rendimento",
  "dividendo",
  "jcp",
  "amortizacao",
  "bonificacao",
];

export type InvestimentoMovimentacaoFormProps = {
  userId?: string;
  ativos: Ativo[];
  editing: Movimentacao | null;
  defaultAtivoId?: string | null;
  /** Used as a reset trigger when re-mounted in a Dialog. */
  resetKey?: number | string | boolean;
  onSaved: () => void;
  onCancel?: () => void;
  hideHeader?: boolean;
  hideFooter?: boolean;
};

export function InvestimentoMovimentacaoForm({
  userId,
  ativos,
  editing,
  defaultAtivoId,
  resetKey,
  onSaved,
  onCancel,
  hideHeader,
  hideFooter,
}: InvestimentoMovimentacaoFormProps) {
  const { t: tr } = useTranslation("investimentos");
  const [ativoId, setAtivoId] = useState<string>("");
  const [tipo, setTipo] = useState<TipoMovimentacao>("compra");
  const [data, setData] = useState(todayISO());
  const [quantidade, setQuantidade] = useState("");
  const [valorUnitario, setValorUnitario] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [instituicao, setInstituicao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const ativoSelecionado = useMemo(
    () => ativos.find((a) => a.id === ativoId) ?? null,
    [ativos, ativoId],
  );
  const variavel = ativoSelecionado ? isRendaVariavel(ativoSelecionado.tipo) : false;

  useEffect(() => {
    if (editing) {
      setAtivoId(editing.ativo_id ?? "");
      setTipo(editing.tipo);
      setData(editing.data ?? todayISO());
      setQuantidade(editing.quantidade != null ? String(editing.quantidade).replace(".", ",") : "");
      setValorUnitario(
        editing.valor_unitario != null ? String(editing.valor_unitario).replace(".", ",") : "",
      );
      setValorTotal(
        editing.valor_total != null ? String(editing.valor_total).replace(".", ",") : "",
      );
      setInstituicao(editing.instituicao ?? "");
      setObservacao(editing.observacao ?? "");
    } else {
      setAtivoId(defaultAtivoId ?? ativos[0]?.id ?? "");
      setTipo("compra");
      setData(todayISO());
      setQuantidade("");
      setValorUnitario("");
      setValorTotal("");
      setInstituicao("");
      setObservacao("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, defaultAtivoId, resetKey]);

  useEffect(() => {
    if (!variavel) return;
    const q = Number(quantidade.replace(",", "."));
    const vu = Number(valorUnitario.replace(",", "."));
    if (q > 0 && vu > 0) {
      setValorTotal((q * vu).toFixed(2).replace(".", ","));
    }
  }, [quantidade, valorUnitario, variavel]);

  async function salvar() {
    if (!userId) return;
    if (!ativoId) {
      toast.error("Selecione um investimento.");
      return;
    }
    const vt = parseBRLInput(valorTotal);
    if (!Number.isFinite(vt) || vt < 0) {
      toast.error("Informe um valor total válido.");
      return;
    }
    const payload: Partial<Movimentacao> = {
      ativo_id: ativoId,
      tipo,
      data,
      quantidade: quantidade ? Number(quantidade.replace(",", ".")) : null,
      valor_unitario: valorUnitario ? parseBRLInput(valorUnitario) : null,
      valor_total: vt,
      instituicao: instituicao || null,
      observacao: observacao || null,
      origem: "manual",
    };
    setSalvando(true);
    try {
      if (editing) {
        await atualizarMovimentacao(editing.id, payload);
        const oldAtivo = editing.ativo_id;
        if (oldAtivo && oldAtivo !== ativoId) {
          await recalcularAtivoPorMovimentacoes(userId, oldAtivo);
        }
      } else {
        await criarMovimentacao(userId, payload);
      }
      await recalcularAtivoPorMovimentacoes(userId, ativoId);
      toast.success(editing ? "Movimentação atualizada." : "Movimentação adicionada.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar a movimentação.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!hideHeader && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Registro manual · não realiza compra ou venda real.
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Investimento</label>
          <Select value={ativoId} onValueChange={setAtivoId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {ativos.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.nome} ({getTipoInvestimentoLabel(a.tipo, tr)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Tipo</label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMovimentacao)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_MOVIMENTACAO.filter(
                  (m) => TIPOS_MOV_PRINCIPAIS.includes(m.id) || m.id === tipo,
                ).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {getTipoMovimentacaoLabel(m.id, tr)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Data</label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>

        {variavel && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Quantidade</label>
              <Input
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor unitário</label>
              <Input
                value={valorUnitario}
                onChange={(e) => setValorUnitario(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground">
            Valor total{variavel ? " (calculado)" : ""}
          </label>
          <Input
            value={valorTotal}
            onChange={(e) => setValorTotal(e.target.value)}
            placeholder="0,00"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Instituição / corretora</label>
          <Input
            value={instituicao}
            onChange={(e) => setInstituicao(e.target.value)}
            placeholder="Ex.: NuInvest, XP, Banco Inter"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Observação</label>
          <Textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder="opcional"
          />
        </div>

        {ativoSelecionado && !variavel && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Para renda fixa, quantidade não é obrigatória. Os totais do investimento serão
            recalculados automaticamente.
          </p>
        )}
      </div>

      {!hideFooter && (
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={salvando}>
              Cancelar
            </Button>
          )}
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editing ? "Salvar" : "Adicionar"}
          </Button>
        </div>
      )}
    </div>
  );
}
