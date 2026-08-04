import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { InvestimentoForm } from "@/components/investimentos/InvestimentoForm";
import { listarAtivos, type Ativo } from "@/lib/investimentos";
import { toast } from "sonner";

export const Route = createFileRoute("/investimentos/$id/editar")({
  head: () => ({ meta: [{ title: "Editar investimento — Gasto Inteligente" }] }),
  component: EditarInvestimentoPage,
});

function EditarInvestimentoPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  const [loading, setLoading] = useState(true);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/investimentos" });
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    (async () => {
      try {
        const ativos = await listarAtivos(user.id);
        if (cancel) return;
        const found = ativos.find((a) => a.id === id) ?? null;
        setAtivo(found);
      } catch (e) {
        console.error(e);
        toast.error(i18n.t("common:errors.load"));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [user?.id, id]);

  return (
    <MobileShell wide>
      <header className="pt-2 pb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ml-2">
          <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app" })}>
          <Home className="h-4 w-4" />
        </Button>
      </header>
      <h1 className="text-2xl font-bold tracking-tight mb-4">Editar investimento</h1>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !ativo ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Investimento não encontrado.</p>
          <Button className="mt-4" onClick={back}>
            Voltar para a lista
          </Button>
        </div>
      ) : (
        <InvestimentoForm userId={user?.id} editing={ativo} onCancel={back} onSaved={back} />
      )}
    </MobileShell>
  );
}
