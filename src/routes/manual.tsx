import { SubscriptionPending } from "@/components/SubscriptionPending";
import { useActiveAccount } from "@/lib/active-account";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { GastoForm } from "@/components/GastoForm";
import { findPossibleDuplicate } from "@/lib/store";
import { syncAllForUser } from "@/lib/offline/use-offline-sync";
import { isOnline } from "@/lib/use-online-status";
import { enqueueExpense, listExpenses } from "@/lib/offline/offline-expense-queue";
import { useAuth } from "@/lib/auth-context";
import { OfflineSyncStatus } from "@/components/offline/OfflineSyncStatus";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import i18n from "@/i18n";
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

export const Route = createFileRoute("/manual")({
  head: () => ({ meta: [{ title: i18n.t("adicionar:manual.meta.title") }] }),
  component: Manual,
});

function Manual() {
  const { t } = useTranslation("adicionar");
  const navigate = useNavigate();
  const { canWriteBasic, requireSubscription, loading, error, refresh } = useSubscriptionGuard();
  const redirected = useRef(false);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { activeOwnerId: ownerId, canCreate } = useActiveAccount();
  const [pending, setPending] = useState<null | (() => void)>(null);

  useEffect(() => {
    if (loading || error) return;
    if (canWriteBasic) {
      redirected.current = false;
      return;
    }
    if (!redirected.current) {
      redirected.current = true;
      requireSubscription(t("requirePlan"));
      navigate({ to: "/meu-plano", replace: true });
    }
  }, [loading, error, canWriteBasic, requireSubscription, navigate, t]);

  if (loading || error) return <SubscriptionPending error={error} retry={refresh} />;
  if (!canWriteBasic) return null;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/adicionar"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("header.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("manual.kicker")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t("manual.title")}</h1>
        </div>
      </header>

      <OfflineSyncStatus className="mt-3" />

      <div className="mt-5">
        <GastoForm
          key={ownerId}
          onSubmit={async (data) => {
            if (!userId || !ownerId || !canCreate) {
              toast.error("Sem permissão para lançar nesta conta.");
              return;
            }
            if (!canWriteBasic) {
              requireSubscription(t("requirePlan"));
              return;
            }
            // Offline: salva na fila local e sincroniza depois.
            if (!isOnline()) {
              if (!userId) {
                toast.error("Faça login para salvar gastos offline.");
                return;
              }
              try {
                await enqueueExpense(ownerId, data, userId);
                toast.success(
                  "Gasto salvo offline. Ele será sincronizado quando a internet voltar.",
                );
                navigate({ to: "/app" });
              } catch (err) {
                console.error("[offline] enqueue failed", err);
                toast.error(i18n.t("common:errors.saveOffline"));
              }
              return;
            }

            const dup = findPossibleDuplicate(data.valor, data.data, data.estabelecimento);
            const save = async () => {
              if (!userId) return;
              try {
                const queued = await enqueueExpense(ownerId, data, userId);
                await syncAllForUser(userId);
                const stillPending = (await listExpenses(ownerId, userId)).some(
                  (item) => item.local_id === queued.local_id,
                );
                toast.success(
                  !stillPending
                    ? t("manual.toastSaved")
                    : "Gasto salvo no aparelho. Aguardando sincronização.",
                );
                void navigate({ to: "/app" });
              } catch {
                toast.error(
                  "Não foi possível concluir. Confira as pendências antes de tentar novamente.",
                );
              }
            };
            if (dup) {
              setPending(() => save);
            } else {
              await save();
            }
          }}
        />
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("manual.dup.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("manual.dup.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("manual.dup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pending?.();
                setPending(null);
              }}
            >
              {t("manual.dup.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}
