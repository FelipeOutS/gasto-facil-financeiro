
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { GastoForm } from "@/components/GastoForm";
import { addGasto, findPossibleDuplicate } from "@/lib/store";
import { isOnline } from "@/lib/use-online-status";
import { enqueueExpense } from "@/lib/offline/offline-expense-queue";
import { useAuth } from "@/lib/auth-context";
import { OfflineSyncStatus } from "@/components/offline/OfflineSyncStatus";
import { toast } from "sonner";
import { useEffect, useState } from "react";
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
  const { canWriteBasic, requireSubscription } = useSubscriptionGuard();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [pending, setPending] = useState<null | (() => void)>(null);

  useEffect(() => {
    if (!canWriteBasic) {
      requireSubscription(t("requirePlan"));
      navigate({ to: "/meu-plano" });
    }
  }, [canWriteBasic, requireSubscription, navigate, t]);

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("manual.kicker")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("manual.title")}</h1>
        </div>
      </header>

      <OfflineSyncStatus className="mt-3" />

      <div className="mt-5">
        <GastoForm
          onSubmit={async (data) => {
            if (!canWrite) {
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
                await enqueueExpense(userId, data);
                toast.success(
                  "Gasto salvo offline. Ele será sincronizado quando a internet voltar.",
                );
                navigate({ to: "/" });
              } catch (err) {
                console.error("[offline] enqueue failed", err);
                toast.error(i18n.t("common:errors.saveOffline"));
              }
              return;
            }

            const dup = findPossibleDuplicate(data.valor, data.data, data.estabelecimento);
            const save = () => {
              addGasto(data);
              toast.success(t("manual.toastSaved"));
              navigate({ to: "/" });
            };
            if (dup) {
              setPending(() => save);
            } else {
              save();
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
