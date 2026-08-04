import i18n from "i18next";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Home, History, Trash2 } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { useAuth } from "@/lib/auth-context";
import {
  listarImportacoes,
  excluirImportacaoSomenteHistorico,
  excluirImportacaoComDados,
  getTipoImportacaoLabel,
  type Importacao,
} from "@/lib/investimentos";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/investimentos/importacoes")({
  head: () => ({ meta: [{ title: "Histórico de importações — Gasto Inteligente" }] }),
  component: HistoricoImportacoesPage,
});

function HistoricoImportacoesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t: tInv } = useTranslation("investimentos");
  const [importacoes, setImportacoes] = useState<Importacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmar, setConfirmar] = useState<Importacao | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/investimentos" });
    }
  };

  async function reload() {
    if (!user?.id) return;
    try {
      const list = await listarImportacoes(user.id);
      setImportacoes(list);
    } catch (e) {
      console.error(e);
      toast.error(i18n.t("common:errors.load"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleExcluir(modo: "historico" | "tudo") {
    if (!user?.id || !confirmar) return;
    setExcluindo(true);
    try {
      if (modo === "historico") {
        await excluirImportacaoSomenteHistorico(confirmar.id);
        toast.success("Histórico da importação excluído.");
      } else {
        await excluirImportacaoComDados(user.id, confirmar.id);
        toast.success("Importação e dados vinculados excluídos.");
      }
      setConfirmar(null);
      await reload();
    } catch (e) {
      console.error(e);
      toastFromError(e, "Não foi possível excluir.");
    } finally {
      setExcluindo(false);
    }
  }

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
      <h1 className="text-2xl font-bold tracking-tight mb-1">Histórico de importações</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Veja todas as importações realizadas e remova quando precisar.
      </p>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : importacoes.length === 0 ? (
        <div className="py-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-brand-soft/60 grid place-items-center text-brand-on-soft mb-3">
            <History className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">Nenhuma importação ainda</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Quando você importar extratos da B3, corretora, CSV ou PDF, eles aparecerão aqui.
          </p>
          <Button
            className="mt-4 min-h-11"
            onClick={() => navigate({ to: "/investimentos/importar" })}
          >
            Importar agora
          </Button>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {importacoes.map((imp) => {
            const r = imp.resumo ?? {};
            const data = new Date(imp.created_at).toLocaleDateString("pt-BR");
            return (
              <li key={imp.id} className="rounded-2xl border border-border/60 bg-card/40 p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">
                      {imp.arquivo_nome || tInv("importacoes.manualName")}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge variant="secondary" className="text-[10px]">
                        {getTipoImportacaoLabel(imp.tipo, tInv)}
                      </Badge>
                      <Badge
                        variant={imp.status === "concluida" ? "secondary" : "outline"}
                        className="text-[10px] capitalize"
                      >
                        {imp.status}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {tInv("importacoes.importedOn", { date: data })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5">
                      {r.ativos ?? 0} ativos · {r.movimentacoes ?? 0} movimentações ·{" "}
                      {r.rendimentos ?? 0} rendimentos
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 text-rose-500 hover:text-rose-500 shrink-0"
                    onClick={() => setConfirmar(imp)}
                    aria-label="Excluir importação"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(v) => !v && !excluindo && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta importação?</AlertDialogTitle>
            <AlertDialogDescription>
              Escolha como deseja remover esta importação. "Apenas histórico" mantém os ativos,
              movimentações e rendimentos criados. "Tudo relacionado" remove também os dados gerados
              por ela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel disabled={excluindo} className="min-h-11">
              Cancelar
            </AlertDialogCancel>
            <Button
              variant="outline"
              disabled={excluindo}
              onClick={() => handleExcluir("historico")}
              className="min-h-11"
            >
              Apenas histórico
            </Button>
            <AlertDialogAction
              disabled={excluindo}
              onClick={() => handleExcluir("tudo")}
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindo ? "Excluindo…" : "Excluir tudo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}
