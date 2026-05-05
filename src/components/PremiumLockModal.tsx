import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Lock } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import type { PlanTier } from "@/lib/plans";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Plano usado quando o usuário ativa o teste grátis. */
  trialPlan?: PlanTier;
  /** Mostra o botão "Continuar" (fechar modal sem ação). */
  showContinue?: boolean;
};

/**
 * Modal padrão de bloqueio premium reutilizável. Mantém o mesmo visual e
 * comportamento do bloqueio de Investimentos, mudando apenas o título e
 * a descrição conforme o recurso acessado.
 */
export function PremiumLockModal({
  open,
  onOpenChange,
  title,
  description,
  trialPlan = "pessoal_premium",
  showContinue = true,
}: Props) {
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
      const res = await startTrial(user.id, trialPlan);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success("Teste grátis ativado por 10 dias.");
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
          <DialogTitle className="text-center">{title}</DialogTitle>
          <DialogDescription className="text-center">
            {description ??
              "Este recurso está disponível apenas em planos elegíveis. Escolha um plano para liberar esse recurso."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!trialUsed && (
            <Button
              className="w-full rounded-2xl"
              disabled={loading}
              onClick={handleTrial}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {loading ? "Ativando…" : "Testar grátis por 10 dias"}
            </Button>
          )}
          <Button asChild variant={trialUsed ? "default" : "outline"} className="w-full rounded-2xl">
            <Link to="/meu-plano" onClick={() => onOpenChange(false)}>
              Ver planos <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {showContinue && (
            <Button
              variant="ghost"
              className="w-full rounded-2xl"
              onClick={() => onOpenChange(false)}
            >
              Continuar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
