import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getUpsellStatus, dismissUpsell } from "@/lib/upsell.functions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, ChevronRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UpsellModal() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getUpsellStatus);
  const dismissFn = useServerFn(dismissUpsell);
  const [open, setOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['upsell-status'],
    queryFn: () => fetchStatus(),
    staleTime: 1000 * 60 * 5,
  });

  const dismissMutation = useMutation({
    mutationFn: (trigger: string) => dismissFn({ type: 'modal', trigger } as any),
    onSuccess: () => {
      setOpen(false);
      queryClient.setQueryData(['upsell-status'], (old: any) => ({ ...old, eligible: false }));
    }
  });

  useEffect(() => {
    // Regra: modal só aparece ocasionalmente (interval_days no config)
    // Aqui simplificamos: se o servidor diz eligible e não é a mesma sessão.
    if (status?.eligible && !sessionStorage.getItem('upsell_modal_shown')) {
      // Pequeno delay para não ser invasivo no load
      const timer = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem('upsell_modal_shown', 'true');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) dismissMutation.mutate('modal_close_button');
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Zap className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center text-xl font-bold">Quer aproveitar mais recursos?</DialogTitle>
          <DialogDescription className="text-center text-sm">
            Conheça os planos do Gasto Inteligente e libere funcionalidades avançadas para organizar suas finanças com ainda mais facilidade.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-3">
            {[
              "Lançamentos ilimitados",
              "Importação de extratos e faturas",
              "Relatórios avançados e metas visuais",
              "WhatsApp e Gasto Inteligente AI"
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">
                  <Sparkles className="h-3 w-3" />
                </div>
                {feature}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/meu-plano">
              Conhecer planos
            </Link>
          </Button>
          <Button 
            variant="ghost" 
            className="w-full text-muted-foreground"
            onClick={() => dismissMutation.mutate('modal_cancel_button')}
          >
            Continuar no gratuito
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
