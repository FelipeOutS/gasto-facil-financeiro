import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { GastoForm } from "@/components/GastoForm";
import { addGasto, findPossibleDuplicate } from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
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
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const [pending, setPending] = useState<null | (() => void)>(null);

  useEffect(() => {
    if (!canWrite) {
      requireSubscription(t("requirePlan"));
      navigate({ to: "/meu-plano" });
    }
  }, [canWrite, requireSubscription, navigate, t]);

  if (!canWrite) return null;

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

      <div className="mt-5">
        <GastoForm
          onSubmit={async (data) => {
            if (!(await requireOnline())) return;
            const dup = findPossibleDuplicate(data.valor, data.data, data.estabelecimento);
            const save = () => {
              if (!canWrite) {
                requireSubscription(t("requirePlan"));
                return;
              }
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
