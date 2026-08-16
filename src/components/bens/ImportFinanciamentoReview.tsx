import { useState } from "react";
import { 
  Check, 
  AlertTriangle, 
  Info,
  ArrowRight,
  Loader2,
  Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatBRL, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { criarHistoricoSaldo, atualizarFinanciamento } from "@/lib/bens";

interface ComparisonRowProps {
  label: string;
  current: string | number | null;
  found: string | number | null;
  selected: boolean;
  onSelect: (val: boolean) => void;
  confidence: "alta" | "media" | "baixa";
  format?: (val: any) => string;
}

function ComparisonRow({ 
  label, 
  current, 
  found, 
  selected, 
  onSelect, 
  confidence,
  format = (v) => String(v ?? "Não informado")
}: ComparisonRowProps) {
  const hasDiff = current !== found && found !== null;
  const isNew = current === null || current === undefined || current === "" || current === 0;

  return (
    <div className={cn(
      "group flex items-center justify-between border-b p-3 transition-colors hover:bg-muted/30",
      selected && "bg-primary/5"
    )}>
      <div className="flex items-center gap-3">
        <Checkbox 
          id={`check-${label}`} 
          checked={selected} 
          onCheckedChange={(v) => onSelect(!!v)}
          disabled={!hasDiff && !isNew}
        />
        <div className="space-y-0.5">
          <Label htmlFor={`check-${label}`} className="text-sm font-medium">{label}</Label>
          <div className="flex items-center gap-2">
            {confidence === "baixa" && (
              <span className="flex items-center gap-1 text-[10px] text-amber-600">
                <AlertTriangle className="h-3 w-3" /> Confira esta informação
              </span>
            )}
            {confidence === "alta" && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                <Check className="h-3 w-3" /> Identificado
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-right">
        <div className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Atual</p>
          <p className="text-sm text-muted-foreground">{format(current)}</p>
        </div>
        {(hasDiff || isNew) && (
          <>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <div className="space-y-0.5">
              <p className="text-[10px] text-primary uppercase tracking-wider font-semibold">Documento</p>
              <p className="text-sm font-semibold text-primary">{format(found)}</p>
            </div>
          </>
        )}
        {!hasDiff && !isNew && (
          <p className="text-xs text-muted-foreground italic">Sem alteração</p>
        )}
      </div>
    </div>
  );
}

export function ImportFinanciamentoReview({ 
  bemId, 
  financiamentoId, 
  data, 
  onClose,
  onConfirm 
}: { 
  bemId: string; 
  financiamentoId?: string; 
  data: any; 
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [selections, setSelections] = useState({
    saldoDevedor: data.saldoDevedor !== null,
    valorParcela: data.valorParcela !== null,
    taxaJuros: data.taxaJuros !== null,
    sistemaAmortizacao: data.sistemaAmortizacao !== null && data.sistemaAmortizacao !== "outro",
  });
  
  const [dataRef, setDataRef] = useState(data.dataReferenciaSaldo || todayISO());
  const [busy, setBusy] = useState(false);

  const confirmUpdates = async () => {
    setBusy(true);
    try {
      const updates: any = {};
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // 1. Atualizar Saldo (Histórico)
      if (selections.saldoDevedor && financiamentoId) {
        await criarHistoricoSaldo(user.id, financiamentoId, {
          saldo_devedor: data.saldoDevedor,
          data_referencia: dataRef,
          observacao: "Atualizado via documento"
        });
      }

      // 2. Atualizar Financiamento (Campos diretos)
      if (selections.valorParcela) updates.valor_parcela_identificada = data.valorParcela;
      if (selections.taxaJuros) {
        updates.taxa_juros_anual = data.taxaJuros;
        updates.taxa_juros_periodicidade = data.periodicidadeTaxa;
        updates.taxa_juros_tipo = data.tipoTaxa;
      }
      if (selections.sistemaAmortizacao) updates.sistema_amortizacao = data.sistemaAmortizacao.toLowerCase();

      if (Object.keys(updates).length > 0 && financiamentoId) {
        await atualizarFinanciamento(financiamentoId, updates);
      }

      // 3. Rastrear alterações confirmadas no documento
      await supabase
        .from("bens_documentos_processados")
        .update({ 
          alteracoes_confirmadas: selections,
          status: "revisado" 
        } as any)
        .eq("id", data.docId);

      toast.success("Dados do financiamento atualizados.");
      onConfirm();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar atualizações.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="rounded-lg bg-blue-50 p-4 text-blue-700">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Documento analisado com sucesso!</p>
            <p>Selecione as informações abaixo que você deseja atualizar no Gasto Inteligente.</p>
          </div>
        </div>
      </div>

      <div className="space-y-0 border rounded-xl overflow-hidden bg-white">
        <ComparisonRow 
          label="Saldo Devedor"
          current={null}
          found={data.saldoDevedor}
          selected={selections.saldoDevedor}
          onSelect={(v) => setSelections({ ...selections, saldoDevedor: v })}
          confidence={data.confianca}
          format={formatBRL}
        />
        <ComparisonRow 
          label="Valor da Parcela"
          current={null}
          found={data.valorParcela}
          selected={selections.valorParcela}
          onSelect={(v) => setSelections({ ...selections, valorParcela: v })}
          confidence={data.confianca}
          format={formatBRL}
        />
        <ComparisonRow 
          label="Taxa de Juros"
          current={null}
          found={data.taxaJuros ? `${data.taxaJuros}% ${data.periodicidadeTaxa || ""} ${data.tipoTaxa || ""}` : null}
          selected={selections.taxaJuros}
          onSelect={(v) => setSelections({ ...selections, taxaJuros: v })}
          confidence={data.confianca}
        />
        <ComparisonRow 
          label="Sistema de Amortização"
          current={null}
          found={data.sistemaAmortizacao}
          selected={selections.sistemaAmortizacao}
          onSelect={(v) => setSelections({ ...selections, sistemaAmortizacao: v })}
          confidence={data.confianca}
        />
      </div>

      {selections.saldoDevedor && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Calendar className="h-4 w-4" />
            Data de Referência do Saldo
          </div>
          <p className="text-xs text-amber-700">
            Precisamos saber a data em que este saldo devedor era válido no banco.
          </p>
          <Input 
            type="date" 
            value={dataRef} 
            onChange={(e) => setDataRef(e.target.value)}
            className="max-w-[200px] border-amber-200 bg-white"
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <div className="flex items-center gap-3">
          <Button 
            className="gap-2" 
            disabled={busy || !Object.values(selections).some(v => v)}
            onClick={confirmUpdates}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar e Atualizar
          </Button>
        </div>
      </div>
    </div>
  );
}

