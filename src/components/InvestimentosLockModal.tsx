import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Lock } from "lucide-react";
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
import { useAuth } from "@/lib/auth-context";
import { usePlan, startTrial } from "@/lib/use-plan";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

/**
 * Modal exibido quando o usuário tenta acessar Investimentos sem ter
 * um plano que libere o recurso. Oferece teste grátis de 10 dias se
 * o usuário ainda não usou.
 */
export function InvestimentosLockModal({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { trialUsed, refresh } = usePlan();
  const [loading, setLoading] = useState(false);

  async function handleTrial() {
    if (!user?.id) {
      toast.error("Faça login para testar.");
      return;
    }
    setLoading(true);
    try {
      // Recurso liberado a partir de Controle Completo Pessoal — escolhemos
      // esse plano como padrão para o teste a partir desse modal.
      const res = await startTrial(user.id, "pessoal_premium");
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success("Teste grátis ativado! Investimentos liberado por 10 dias.");
      await refresh();
      onOpenChange(false);
    } catch {
      toast.error("Erro ao iniciar o teste.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-primary/20 ring-1 ring-primary/20">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">Investimentos é um recurso premium</DialogTitle>
          <DialogDescription className="text-center">
            Acompanhe sua carteira, patrimônio, rendimentos e movimentações em um só lugar. Este
            recurso está disponível nos planos Controle Completo Pessoal, MEI Completo e Empresa.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!trialUsed && (
            <Button className="w-full rounded-2xl" disabled={loading} onClick={handleTrial}>
              <Sparkles className="mr-2 h-4 w-4" />
              {loading ? "Ativando…" : "Testar grátis por 10 dias"}
            </Button>
          )}
          <Button
            asChild
            variant={trialUsed ? "default" : "outline"}
            className="w-full rounded-2xl"
          >
            <Link to="/meu-plano" onClick={() => onOpenChange(false)}>
              Ver planos <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full rounded-2xl"
            onClick={() => onOpenChange(false)}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
