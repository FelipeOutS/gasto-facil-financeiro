import { toast } from "sonner";
import i18n from "i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GastoForm } from "@/components/GastoForm";
import { updateExpense, type OfflineExpense } from "@/lib/offline/offline-expense-queue";
import { recordHistoryEvent } from "@/lib/offline/offline-sync-history";
import type { NovoGastoInput } from "@/lib/store";

type Props = {
  item: OfflineExpense | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditOfflineExpenseDialog({ item, open, onOpenChange }: Props) {
  async function handleSubmit(data: NovoGastoInput) {
    if (!item) return;
    if (item.status === "syncing") {
      toast.error("Este gasto está sincronizando. Aguarde finalizar.");
      return;
    }
    if (!data.valor || data.valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (!data.data) {
      toast.error("Informe a data do gasto.");
      return;
    }
    try {
      await updateExpense(item.local_id, {
        input: data,
        descricao: (data.descricao || data.estabelecimento || "Gasto").trim(),
        valor: data.valor,
        data: data.data,
        forma_pagamento: data.formaPagamento,
        cartao_id: data.cartaoId,
        observacao: data.observacao,
        status: "pending",
        error_message: undefined,
        technical_error: undefined,
      });
      void recordHistoryEvent({
        user_id: item.user_id,
        type: "expense",
        action: "edited",
        title: (data.descricao || data.estabelecimento || "Gasto").trim(),
        amount: data.valor,
      });
      toast.success("Pendência atualizada.");
      onOpenChange(false);
    } catch (err) {
      console.error("[offline] update failed", err);
      toast.error(i18n.t("common:errors.update"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar gasto pendente</DialogTitle>
          <DialogDescription>
            As alterações ficam salvas localmente e serão enviadas na próxima sincronização.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <GastoForm initial={item.input} submitLabel="Salvar alterações" onSubmit={handleSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}
