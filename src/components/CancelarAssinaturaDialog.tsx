import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cancelarAssinatura } from "@/lib/payments-mp";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  onCancelled?: () => void;
};

export function CancelarAssinaturaDialog({ open, onOpenChange, userId, onCancelled }: Props) {
  const [loading, setLoading] = useState(false);

  async function confirmar() {
    setLoading(true);
    try {
      const res = await cancelarAssinatura(userId);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      const ate = new Date(res.accessUntil).toLocaleDateString("pt-BR");
      toast.success(`Assinatura cancelada. Seu acesso continua até ${ate}.`);
      onCancelled?.();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar assinatura</DialogTitle>
          <DialogDescription>
            Você continuará com acesso aos recursos do plano até o fim do período já pago. Depois
            disso, os recursos premium serão bloqueados, mas seus dados continuarão salvos.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            className="w-full rounded-2xl"
            disabled={loading}
            onClick={confirmar}
          >
            {loading ? "Cancelando…" : "Cancelar assinatura"}
          </Button>
          <Button
            variant="outline"
            className="w-full rounded-2xl"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Manter assinatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
