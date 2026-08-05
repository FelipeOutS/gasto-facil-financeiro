import { useServerFn } from "@tanstack/react-start";
import { dismissUpsell } from "@/lib/upsell.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useUpsellGate } from "@/hooks/use-upsell-gate";

export function UpsellBanner() {
  const queryClient = useQueryClient();
  const dismissFn = useServerFn(dismissUpsell);
  const { visible, hide } = useUpsellGate({ channel: "banner" });

  const dismissMutation = useMutation({
    mutationFn: (trigger: string) => dismissFn({ data: { type: "banner", trigger } }),
    onSuccess: () => {
      hide();
      void queryClient.invalidateQueries({ queryKey: ["upsell-status"] });
    },
  });

  if (!visible) return null;

  return (
    <section
      role="region"
      aria-label="Sugestão de planos do Gasto Inteligente"
      className="relative mb-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5"
    >
      <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Aproveite ainda mais o Gasto Inteligente
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Libere recursos avançados, mais limites e ferramentas para cuidar melhor da sua vida
              financeira.
            </p>
          </div>
        </div>

        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Button asChild size="sm" className="h-9 grow sm:grow-0">
            <Link to="/meu-plano">
              Conhecer planos
              <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => dismissMutation.mutate("banner_dismiss_button")}
          >
            Agora não
          </Button>
        </div>
      </div>

      <button
        type="button"
        aria-label="Fechar aviso de planos"
        onClick={() => dismissMutation.mutate("banner_x_button")}
        className="absolute right-2 top-2 p-1 text-muted-foreground/50 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
      <div className="absolute -bottom-8 left-1/4 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
    </section>
  );
}
