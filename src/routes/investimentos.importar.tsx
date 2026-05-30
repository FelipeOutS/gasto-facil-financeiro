import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, Info } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { ImportInvestimentosFlow } from "@/components/ImportInvestimentosFlow";
import { listarAtivos, type Ativo } from "@/lib/investimentos";
import { toast } from "sonner";

export const Route = createFileRoute("/investimentos/importar")({
  head: () => ({ meta: [{ title: "Importar investimentos — Gasto Inteligente" }] }),
  component: ImportarInvestimentosPage,
});

type Origem = "b3" | "corretora" | "csv" | "pdf";

const OPCOES: Array<{ id: Origem; label: string; desc: string }> = [
  { id: "b3", label: "Importar extrato da B3", desc: "Arquivo exportado da Área do Investidor (PDF, CSV ou XLSX)." },
  { id: "corretora", label: "Importar extrato da corretora", desc: "Relatório oficial da sua corretora (PDF, CSV ou XLSX)." },
  { id: "csv", label: "Importar CSV / planilha", desc: "Modelo livre com seus ativos. Aceita CSV, XLSX e XLS." },
  { id: "pdf", label: "Importar PDF", desc: "Extrato em PDF com prévia antes de salvar." },
];

function ImportarInvestimentosPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [origem, setOrigem] = useState<Origem | null>(null);

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
      <h1 className="text-2xl font-bold tracking-tight mb-1">Importar investimentos</h1>
      <p className="text-sm text-muted-foreground mb-4">Escolha de onde quer trazer seus dados.</p>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="grid gap-2">
          {OPCOES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="w-full text-left rounded-2xl border border-border/60 bg-card/40 hover:bg-accent/40 p-4 transition-colors min-h-11"
              onClick={() => setOrigem(opt.id)}
            >
              <div className="font-medium text-sm">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-[11px] text-muted-foreground mt-4">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Não pedimos senha, CPF, token bancário ou acesso à sua conta. A importação usa apenas
          arquivos enviados por você.
        </span>
      </div>

      <ImportInvestimentosFlow
        open={!!origem}
        origem={origem}
        userId={user?.id}
        ativosExistentes={ativos}
        onOpenChange={(v) => { if (!v) setOrigem(null); }}
        onImported={() => { back(); }}
      />
    </MobileShell>
  );
}
