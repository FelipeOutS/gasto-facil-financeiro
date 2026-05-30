import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { InvestimentoRendimentoForm } from "@/components/investimentos/InvestimentoRendimentoForm";
import {
  listarAtivos,
  listarRendimentos,
  type Ativo,
  type Rendimento,
} from "@/lib/investimentos";
import { toast } from "sonner";

export const Route = createFileRoute("/investimentos/rendimento/$rendId/editar")({
  head: () => ({ meta: [{ title: "Editar rendimento — Gasto Inteligente" }] }),
  component: EditarRendimentoPage,
});

function EditarRendimentoPage() {
  const { rendId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [rend, setRend] = useState<Rendimento | null>(null);
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
        const [as, rs] = await Promise.all([
          listarAtivos(user.id),
          listarRendimentos(user.id),
        ]);
        if (cancel) return;
        setAtivos(as);
        setRend(rs.find((r) => r.id === rendId) ?? null);
      } catch (e) {
        console.error(e);
        toast.error(i18n.t("common:errors.load"));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [user?.id, rendId]);

  const ativo = rend ? ativos.find((a) => a.id === rend.ativo_id) ?? null : null;

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
      <h1 className="text-2xl font-bold tracking-tight mb-1">Editar rendimento</h1>
      <p className="text-sm text-muted-foreground mb-4">
        {ativo ? ativo.nome : "Atualize os dados do rendimento."}
      </p>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !rend ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Rendimento não encontrado.</p>
          <Button className="mt-4" onClick={() => navigate({ to: "/investimentos" })}>
            Voltar para a lista
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4">
          <InvestimentoRendimentoForm
            userId={user?.id}
            ativos={ativos}
            editing={rend}
            onCancel={back}
            onSaved={back}
          />
        </div>
      )}
    </MobileShell>
  );
}
