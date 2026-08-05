import { useServerFn } from "@tanstack/react-start";
import { dismissUpsell } from "@/lib/upsell.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpsellGate } from "@/hooks/use-upsell-gate";

export function UpsellModal() {
  const queryClient = useQueryClient();
  const dismissFn = useServerFn(dismissUpsell);
  const { visible, hide } = useUpsellGate({ channel: "modal" });

  const dismissMutation = useMutation({
    mutationFn: (trigger: string) => dismissFn({ data: { type: "modal", trigger } }),
    onSuccess: () => {
      hide();
      void queryClient.invalidateQueries({ queryKey: ["upsell-status"] });
    },
  });

  if (!visible) return null;

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) dismissMutation.mutate("modal_close_button");
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Zap className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center text-xl font-bold">
            Quer aproveitar mais recursos?
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            Conheça os planos do Gasto Inteligente e libere funcionalidades avançadas para organizar
            suas finanças com ainda mais facilidade.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-3">
            {[
              "Lançamentos ilimitados",
              "Importação de extratos e faturas",
              "Relatórios avançados e metas visuais",
              "WhatsApp e Gasto Inteligente AI",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                </div>
                {feature}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/meu-plano" onClick={() => dismissMutation.mutate("modal_cta_planos")}>
              Conhecer planos
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => dismissMutation.mutate("modal_cancel_button")}
          >
            Continuar no gratuito
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
