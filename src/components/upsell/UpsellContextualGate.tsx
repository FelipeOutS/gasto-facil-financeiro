import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordPaidFeatureAttempt } from "@/lib/upsell.functions";
import { Lock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UpsellContextualGateProps {
  feature: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Gate contextual: sempre disparado por ação explícita do usuário em recurso pago.
 * Não depende da frequência automática (banner/modal) e registra o gatilho
 * "tentativa de recurso pago" no servidor.
 */
export function UpsellContextualGate({ feature, isOpen, onClose }: UpsellContextualGateProps) {
  const record = useServerFn(recordPaidFeatureAttempt);
  const recorded = useRef(false);

  useEffect(() => {
    if (!isOpen || recorded.current) return;
    recorded.current = true;
    void record({}).catch(() => {});
  }, [isOpen, record]);

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
            <Lock className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center text-lg font-bold">
            Recurso disponível em planos completos
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            O recurso <span className="font-semibold text-foreground">"{feature}"</span> faz parte
            das ferramentas avançadas do Gasto Inteligente.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 rounded-xl bg-accent/50 p-4">
          <p className="text-xs text-muted-foreground">
            Este recurso está disponível nos planos completos. Faça upgrade para liberar esta e
            outras ferramentas avançadas.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/meu-plano" onClick={onClose}>
              Ver planos
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
