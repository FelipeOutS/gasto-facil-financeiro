import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MobileShell } from "@/components/MobileShell";
import { getCartoes, getGastos, useBootstrap, useStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
// FaturaSheet é importado do arquivo de rota /cartoes para reaproveitar
// 100% da lógica/UX existente. O componente aceita `inline` para renderizar
// sem Sheet/modal (compatível com Android WebView).
import { FaturaSheet } from "@/routes/cartoes.index";

export const Route = createFileRoute("/cartoes/$id/")({
  component: CartaoDetalhePage,
});

function CartaoDetalhePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const ready = useBootstrap();
  const cartoes = useStore(() => getCartoes());
  const gastos = useStore(() => getGastos());
  const cartao = cartoes.find((c) => c.id === id) ?? null;

  // Se o cartão não existir (após boot), volta para a lista.
  useEffect(() => {
    if (ready && !cartao) {
      navigate({ to: "/cartoes", replace: true });
    }
  }, [ready, cartao, navigate]);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/cartoes" });
    }
  };

  return (
    <MobileShell wide>
      {!ready || !cartao ? (
        <div className="space-y-3 pt-2">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="pt-2">
          <FaturaSheet
            cartao={cartao}
            gastos={gastos}
            inline
            onBack={back}
            onOpenChange={(o: boolean) => {
              if (!o) back();
            }}
            onEdit={(c) => navigate({ to: "/cartoes/$id/editar", params: { id: c.id } })}
            onImport={(c) => navigate({ to: "/cartoes", search: { importar: c.id } })}
          />
        </div>
      )}
    </MobileShell>
  );
}
