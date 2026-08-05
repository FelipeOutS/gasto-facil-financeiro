import { useState, useEffect } from "react";
import { getUpsellStatus, dismissUpsell } from "@/lib/upsell.functions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function UpsellBanner() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getUpsellStatus);
  const dismissFn = useServerFn(dismissUpsell);

  const { data: status, isLoading } = useQuery({
    queryKey: ['upsell-status'],
    queryFn: () => fetchStatus(),
    staleTime: 1000 * 60 * 5, // 5 min
  });

  const [showDelayed, setShowDelayed] = useState(false);

  useEffect(() => {
    if (status?.eligible) {
      const timer = setTimeout(() => setShowDelayed(true), 5000);
      return () => clearTimeout(timer);
    } else {
      setShowDelayed(false);
    }
  }, [status?.eligible]);

  const dismissMutation = useMutation({
    mutationFn: (trigger: string) => dismissFn({ type: 'banner', trigger } as any),
    onSuccess: () => {
      queryClient.setQueryData(['upsell-status'], (old: any) => ({ ...old, eligible: false }));
    }
  });

  if (isLoading || !status?.eligible || !showDelayed) return null;

  return (
    <div className="relative mb-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
      <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Aproveite ainda mais o Gasto Inteligente</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Libere recursos avançados, mais limites e ferramentas para cuidar melhor da sua vida financeira.
            </p>
          </div>
        </div>
        
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Button asChild size="sm" className="h-9 grow sm:grow-0">
            <Link to="/meu-plano">
              Conhecer planos
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => dismissMutation.mutate('banner_dismiss_button')}
          >
            Agora não
          </Button>
        </div>
      </div>

      <button 
        onClick={() => dismissMutation.mutate('banner_x_button')}
        className="absolute right-2 top-2 p-1 text-muted-foreground/50 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Decorative background elements */}
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
      <div className="absolute -bottom-8 left-1/4 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
    </div>
  );
}
