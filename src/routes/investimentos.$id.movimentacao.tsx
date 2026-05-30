import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { InvestimentoMovimentacaoForm } from "@/components/investimentos/InvestimentoMovimentacaoForm";
import { listarAtivos, type Ativo } from "@/lib/investimentos";
import { toast } from "sonner";

export const Route = createFileRoute("/investimentos/$id/movimentacao")({
  head: () => ({ meta: [{ title: "Nova movimentação — Gasto Inteligente" }] }),
  component: NovaMovimentacaoPage,
});

function NovaMovimentacaoPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
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
        const list = await listarAtivos(user.id);
        if (!cancel) setAtivos(list);
      } catch (e) {
        console.error(e);
        toast.error(i18n.t("common:errors.load"));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [user?.id]);

  const ativo = ativos.find((a) => a.id === id) ?? null;

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
      <h1 className="text-2xl font-bold tracking-tight mb-1">Nova movimentação</h1>
      <p className="text-sm text-muted-foreground mb-4">
        {ativo ? ativo.nome : "Registro manual — não realiza compra ou venda real."}
      </p>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : ativos.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Nenhum investimento cadastrado ainda.</p>
          <Button className="mt-4" onClick={() => navigate({ to: "/investimentos" })}>
            Voltar para a lista
          </Button>
        </div>
      ) : (
        <InvestimentoMovimentacaoForm
          userId={user?.id}
          ativos={ativos}
          editing={null}
          defaultAtivoId={id}
          onCancel={back}
          onSaved={back}
        />
      )}
    </MobileShell>
  );
}
