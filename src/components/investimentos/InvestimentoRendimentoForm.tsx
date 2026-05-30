import { useEffect, useState } from "react";
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
  TIPOS_RENDIMENTO,
  type Ativo,
  type Rendimento,
  type TipoRendimento,
  tipoLabel,
  getTipoInvestimentoLabel,
  getTipoRendimentoLabel,
  criarRendimento,
  atualizarRendimento,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export type InvestimentoRendimentoFormProps = {
  userId?: string;
  ativos: Ativo[];
  editing: Rendimento | null;
  defaultAtivoId?: string | null;
  resetKey?: number | string | boolean;
  onSaved: () => void;
  onCancel?: () => void;
};

export function InvestimentoRendimentoForm({
  userId,
  ativos,
  editing,
  defaultAtivoId,
  resetKey,
  onSaved,
  onCancel,
}: InvestimentoRendimentoFormProps) {
  const { t: tr } = useTranslation("investimentos");
  const [ativoId, setAtivoId] = useState<string>("");
  const [tipo, setTipo] = useState<TipoRendimento>("dividendo");
  const [dataPag, setDataPag] = useState(todayISO());
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState<"recebido" | "previsto">("recebido");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (editing) {
      setAtivoId(editing.ativo_id ?? "");
      setTipo(editing.tipo);
      setDataPag(editing.data_pagamento ?? todayISO());
      setValor(editing.valor != null ? String(editing.valor).replace(".", ",") : "");
      setStatus(editing.status);
      setObservacao(editing.observacao ?? "");
    } else {
      setAtivoId(defaultAtivoId ?? (ativos[0]?.id ?? ""));
      setTipo("dividendo");
      setDataPag(todayISO());
      setValor("");
      setStatus("recebido");
      setObservacao("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, defaultAtivoId, resetKey]);

  async function salvar() {
    if (!userId) return;
    if (!ativoId) {
      toast.error("Selecione um investimento.");
      return;
    }
    const v = parseBRLInput(valor);
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    const payload: Partial<Rendimento> = {
      ativo_id: ativoId,
      tipo,
      data_pagamento: dataPag,
      valor: v,
      status,
      observacao: observacao || null,
      origem: "manual",
    };
    setSalvando(true);
    try {
      if (editing) await atualizarRendimento(editing.id, payload);
      else await criarRendimento(userId, payload);
      toast.success(editing ? "Rendimento atualizado." : "Rendimento adicionado.");
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível salvar o rendimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Investimento</label>
        <Select value={ativoId} onValueChange={setAtivoId}>
          <SelectTrigger className="min-h-11">
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
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoRendimento)}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_RENDIMENTO.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as "recebido" | "previsto")}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recebido">Recebido</SelectItem>
              <SelectItem value="previsto">Previsto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Data de pagamento</label>
          <Input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} className="min-h-11" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Valor recebido</label>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className="min-h-11" />
        </div>
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

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={salvando} className="min-h-11">
            Cancelar
          </Button>
        )}
        <Button onClick={salvar} disabled={salvando} className="min-h-11">
          {salvando ? "Salvando…" : editing ? "Salvar" : "Adicionar"}
        </Button>
      </div>
    </div>
  );
}
