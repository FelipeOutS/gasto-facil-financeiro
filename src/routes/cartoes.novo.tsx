import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { CartaoForm } from "@/components/CartaoForm";
import i18n from "@/i18n";

export const Route = createFileRoute("/cartoes/novo")({
  head: () => ({
    meta: [
      { title: i18n.t("cartoes:form.newTitle") + " — Gasto Inteligente" },
    ],
  }),
  component: NovoCartaoPage,
});

function NovoCartaoPage() {
  const { t } = useTranslation("cartoes");
  const navigate = useNavigate();

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/cartoes" });
    }
  };

  return (
    <MobileShell wide>
      <header className="pt-2 animate-rise">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {t("hero.eyebrow")}
        </p>
        <h1 className="mt-0.5 flex items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
            <CreditCard className="h-4 w-4" />
          </span>
          {t("form.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("form.subtitle")}</p>
      </header>

      <div className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <CartaoForm
          editing={null}
          onCancel={back}
          onSaved={() => navigate({ to: "/cartoes" })}
        />
      </div>
    </MobileShell>
  );
}
