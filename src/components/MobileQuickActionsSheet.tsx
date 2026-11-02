import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, ArrowUp, Upload, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Action = {
  to: string;
  labelKey: string;
  icon: typeof Plus;
  tone: "primary" | "success" | "muted" | "brand";
};

const ACTIONS: Action[] = [
  { to: "/adicionar", labelKey: "novoGasto", icon: Plus, tone: "primary" },
  { to: "/renda", labelKey: "novaReceita", icon: ArrowUp, tone: "success" },
  { to: "/extratos-importados", labelKey: "importar", icon: Upload, tone: "muted" },
  { to: "/gasto-ai", labelKey: "ia", icon: Sparkles, tone: "brand" },
];

export function MobileQuickActionsSheet({ trigger, financialOnly = false }: { trigger: ReactNode; financialOnly?: boolean }) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const actions = financialOnly
    ? ACTIONS.slice(0, 2).map(action => ({ ...action, to: action.to === "/renda" ? "/renda/nova" : "/manual" }))
    : ACTIONS;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        side="bottom"
        className="rounded-t-3xl border-border/60 px-5 pb-[calc(1.25rem+var(--app-safe-bottom))] pt-4"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{t("quickActions.title")}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {actions.map(({ to, labelKey, icon: Icon, tone }) => (
            <button
              key={to}
              type="button"
              onClick={() => {
                setOpen(false);
                void navigate({ to: to as string });
              }}
              className="group flex min-h-[88px] flex-col items-start justify-between gap-2 rounded-2xl border border-border bg-card p-3.5 text-left shadow-card transition-all active:scale-[0.97]"
            >
              <span
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-xl ring-1 ring-border/40",
                  tone === "primary" && "bg-primary/12 text-primary",
                  tone === "success" && "bg-success/12 text-success",
                  tone === "muted" && "bg-muted text-foreground",
                  tone === "brand" && "bg-brand-soft text-brand",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[13px] font-semibold leading-tight">
                {t(`quickActions.${labelKey}`)}
              </span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
