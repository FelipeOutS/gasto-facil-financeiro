import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, HandCoins } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ReceberContaForm } from "@/components/contas/ReceberContaForm";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { type ContaReceber, listarContasReceber } from "@/lib/contas-receber";
import { toast } from "sonner";

export const Route = createFileRoute("/contas-a-receber/$id/receber")({
  head: () => ({ meta: [{ title: "Receber conta — Gasto Inteligente" }] }),
  component: ReceberContaPage,
});

function ReceberContaPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation("contas-a-receber");
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [conta, setConta] = useState<ContaReceber | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    listarContasReceber(userId)
      .then((lista) => {
        setConta(lista.find((c) => c.id === id) ?? null);
      })
      .catch((e) => {
        console.error(e);
        toast.error(t("errors.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [userId, id, t]);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/contas-a-receber" });
    }
  };

  return (
    <MobileShell wide>
      <header className="pt-2 animate-rise">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground/80 transition hover:bg-card-elevated"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("header.back")}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/app" })}
            aria-label="Ir para o início"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground/70 transition hover:bg-card-elevated"
          >
            <Home className="h-4 w-4" />
          </button>
        </div>
        <h1 className="flex items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
            <HandCoins className="h-4 w-4" />
          </span>
          {t("receive.title")}
        </h1>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !conta ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Conta a receber não encontrada.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/contas-a-receber" })}>
              {t("header.back")}
            </Button>
          </div>
        ) : (
          <ReceberContaForm
            key={conta.id}
            conta={conta}
            fullWidthActions
            onConfirmed={() => navigate({ to: "/contas-a-receber" })}
            onCancel={back}
          />
        )}
      </div>
    </MobileShell>
  );
}
