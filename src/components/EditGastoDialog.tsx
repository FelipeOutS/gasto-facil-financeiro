import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GastoForm } from "./GastoForm";
import { updateGasto, type NovoGastoInput } from "@/lib/store";
import type { Gasto } from "@/lib/types";
import { parseDateLocal, toLocalISODate } from "@/lib/format";
import { toast } from "sonner";

export function EditGastoDialog({
  gasto,
  open,
  onOpenChange,
}: {
  gasto: Gasto | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  // keep a local snapshot so the form keeps its initial values during the close animation
  const [snapshot, setSnapshot] = useState<Gasto | null>(gasto);

  useEffect(() => {
    if (gasto) setSnapshot(gasto);
  }, [gasto]);

  if (!snapshot) return null;

  const initial: Partial<NovoGastoInput> = {
    valor: snapshot.valor,
    data: snapshot.data,
    descricao: snapshot.descricao,
    estabelecimento: snapshot.estabelecimento,
    categoriaId: snapshot.categoriaId,
    formaPagamento: snapshot.formaPagamento,
    observacao: snapshot.observacao,
    imagemUrl: snapshot.imagemUrl,
    tipoGasto: snapshot.tipoGasto,
    parcelaAtual: snapshot.parcelaAtual,
    totalParcelas: snapshot.totalParcelas,
    essencial: snapshot.essencial,
    gastoFixo: snapshot.gastoFixo,
    cartaoId: snapshot.cartaoId,
  };

  function handleSubmit(input: NovoGastoInput) {
    if (!snapshot) return;

    // Validations
    const nome = (input.descricao || input.estabelecimento || "").trim();
    if (!nome) {
      toast.error("Preencha o nome do gasto.");
      return;
    }
    if (!input.valor || input.valor <= 0 || !Number.isFinite(input.valor)) {
      toast.error("Informe um valor válido.");
      return;
    }
    const parsed = parseDateLocal(input.data);
    if (!parsed) {
      toast.error("Escolha uma data para o gasto.");
      return;
    }
    const dataNorm = toLocalISODate(parsed);

    try {
      updateGasto(snapshot.id, {
        descricao: nome,
        estabelecimento: input.estabelecimento ?? "",
        valor: input.valor,
        data: dataNorm,
        categoriaId: input.categoriaId,
        formaPagamento: input.formaPagamento,
        observacao: input.observacao,
        essencial: input.essencial,
        gastoFixo: input.gastoFixo,
        cartaoId: input.formaPagamento === "credito" ? input.cartaoId : undefined,
      });
      toast.success("Gasto atualizado com sucesso.");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível atualizar o gasto. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar gasto</DialogTitle>
          <DialogDescription>
            Atualize os dados do gasto. As alterações refletem em todo o app.
          </DialogDescription>
        </DialogHeader>
        <GastoForm
          initial={initial}
          submitLabel="Salvar alterações"
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
