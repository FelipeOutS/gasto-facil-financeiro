import { useState, useEffect } from "react";
import { toast } from "sonner";
import i18n from "i18next";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateIncome,
  type OfflineIncome,
} from "@/lib/offline/offline-income-queue";
import { recordHistoryEvent } from "@/lib/offline/offline-sync-history";
import { TIPOS_RECEITA, type TipoReceita } from "@/lib/types";
import { parseBRLInput } from "@/lib/format";

type Props = {
  item: OfflineIncome | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditOfflineIncomeDialog({ item, open, onOpenChange }: Props) {
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<TipoReceita>("salario");

  useEffect(() => {
    if (item && open) {
      setDescricao(item.input.descricao);
      setValorStr(item.input.valor.toFixed(2).replace(".", ","));
      setData(item.input.data);
      setTipo(item.input.tipo);
    }
  }, [item, open]);

  function handleClose(o: boolean) {
    if (!o) {
      setDescricao("");
      setValorStr("");
      setData("");
      setTipo("salario");
    }
    onOpenChange(o);
  }

  async function handleSave() {
    if (!item) return;
    if (item.status === "syncing") {
      toast.error("Esta receita está sincronizando. Aguarde finalizar.");
      return;
    }
    const valor = parseBRLInput(valorStr);
    const desc = descricao.trim();
    if (!valor || valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (!desc) {
      toast.error("Informe a descrição.");
      return;
    }
    if (!data) {
      toast.error("Informe a data.");
      return;
    }
    try {
      const newInput = {
        ...item.input,
        descricao: desc,
        valor,
        data,
        tipo,
      };
      await updateIncome(item.local_id, {
        input: newInput,
        descricao: desc,
        valor,
        data,
        tipo,
        status: "pending",
        error_message: undefined,
        technical_error: undefined,
      });
      void recordHistoryEvent({
        user_id: item.user_id,
        type: "income",
        action: "edited",
        title: desc,
        amount: valor,
      });
      toast.success("Pendência atualizada.");
      handleClose(false);
    } catch (err) {
      console.error("[offline-income] update failed", err);
      toast.error(i18n.t("common:errors.update"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar receita pendente</DialogTitle>
          <DialogDescription>
            As alterações ficam salvas localmente e serão enviadas na próxima sincronização.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="off-inc-desc">Descrição</Label>
              <Input
                id="off-inc-desc"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="off-inc-valor">Valor</Label>
                <Input
                  id="off-inc-valor"
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="off-inc-data">Data</Label>
                <Input
                  id="off-inc-data"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEITA.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>Salvar alterações</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
