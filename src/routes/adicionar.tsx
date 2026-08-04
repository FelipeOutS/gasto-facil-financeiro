import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  Camera,
  ImageUp,
  PencilLine,
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  ArrowUp,
  X,
  Sparkles,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import { WhatsAppExpenseDialog } from "@/components/WhatsAppExpenseDialog";
import { useAuth } from "@/lib/auth-context";
import { tipoEfetivo, type TipoCadastro } from "@/lib/profile-utils";
import i18n from "@/i18n";

const searchSchema = z.object({
  // `tipo` é opcional. Aceita "gasto" | "receita"; qualquer outro valor
  // (ausente, inválido, lixo na URL) cai como undefined sem quebrar a tela.
  tipo: z.preprocess(
    (v) => (v === "gasto" || v === "receita" ? v : undefined),
    z.enum(["gasto", "receita"]).optional(),
  ),
});

export const Route = createFileRoute("/adicionar")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: i18n.t("adicionar:meta.title") }] }),
  component: Adicionar,
});

const GUIDE_DISMISS_PREFIX = "gi.guided-entry-dismissed-v1:";

function isGuideDismissed(userId: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GUIDE_DISMISS_PREFIX + (userId ?? "anon")) === "1";
  } catch {
    return false;
  }
}

function markGuideDismissed(userId: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDE_DISMISS_PREFIX + (userId ?? "anon"), "1");
  } catch {
    /* noop */
  }
}

function Adicionar() {
  const { t } = useTranslation("adicionar");
  const navigate = useNavigate();
  const { tipo } = Route.useSearch();
  const { canWrite, canWriteBasic, requireSubscription } = useSubscriptionGuard();
  const { user, profile } = useAuth();
  const tipoCad = tipoEfetivo(profile?.tipo_cadastro as TipoCadastro);
  const isBusiness = tipoCad === "mei" || tipoCad === "empresa";
  const incomeKey = isBusiness ? "revenue" : "income";
  const [busy, setBusy] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState<boolean>(() =>
    isGuideDismissed(user?.id ?? null),
  );

  useEffect(() => {
    setGuideDismissed(isGuideDismissed(user?.id ?? null));
  }, [user?.id]);

  useEffect(() => {
    // Permitir acesso à tela se o usuário pode pelo menos escrita básica
    // (free_ads ou plano pago). OCR/IA/WhatsApp continuam bloqueados abaixo.
    if (!canWriteBasic) {
      requireSubscription(t("requirePlan"));
    }
  }, [canWriteBasic, requireSubscription, t]);

  const goManual = () => {
    if (!canWriteBasic) {
      requireSubscription(t("requirePlan"));
      return;
    }
    navigate({ to: "/manual" });
  };

  const goRenda = () => {
    if (!canWriteBasic) {
      requireSubscription(t("requirePlan"));
      return;
    }
    navigate({ to: "/renda/nova" });
  };

  function pickImage(camera: boolean) {
    if (!canWrite) {
      requireSubscription(t("requirePlan"));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        sessionStorage.setItem("gf:pendingImage", dataUrl);
        navigate({ to: "/confirmar" });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  const highlightExpense = tipo === "gasto";
  const highlightIncome = tipo === "receita";

  const incomeTitle = useMemo(() => t(`guidedEntry.types.${incomeKey}.title`), [t, incomeKey]);
  const incomeDesc = useMemo(() => t(`guidedEntry.types.${incomeKey}.description`), [t, incomeKey]);

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("header.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("header.kicker")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t("header.title")}</h1>
        </div>
      </header>

      <p className="mt-3 text-sm text-muted-foreground">{t("subtitle")}</p>

      {!guideDismissed && (
        <section className="mt-5 rounded-3xl border border-border bg-card/60 p-4 animate-fade-in">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold leading-tight">{t("guidedEntry.title")}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isBusiness ? t("guidedEntry.descriptionBusiness") : t("guidedEntry.description")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                markGuideDismissed(user?.id ?? null);
                setGuideDismissed(true);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("guidedEntry.dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(["chooseType", "fillDetails", "saveAndTrack"] as const).map((step, i) => (
              <li
                key={step}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="leading-snug">{t(`guidedEntry.steps.${step}`)}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={goManual}
              className={cn(
                "card-press hover-lift flex min-h-[88px] w-full flex-col gap-1.5 rounded-2xl border bg-card p-4 text-left transition-all",
                highlightExpense
                  ? "border-primary/60 bg-primary/5 ring-2 ring-primary/30"
                  : "border-border hover:border-primary/40",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">
                  {t("guidedEntry.types.expense.title")}
                </span>
              </span>
              <span className="text-xs leading-snug text-muted-foreground">
                {t("guidedEntry.types.expense.description")}
              </span>
            </button>

            <button
              type="button"
              onClick={goRenda}
              className={cn(
                "card-press hover-lift flex min-h-[88px] w-full flex-col gap-1.5 rounded-2xl border bg-card p-4 text-left transition-all",
                highlightIncome
                  ? "border-success/60 bg-success/5 ring-2 ring-success/30"
                  : "border-border hover:border-success/40",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/15 text-success">
                  <ArrowUp className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{incomeTitle}</span>
              </span>
              <span className="text-xs leading-snug text-muted-foreground">{incomeDesc}</span>
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("guidedEntry.hint")}
          </p>
        </section>
      )}

      <div className="mt-6 space-y-3 stagger">
        <button
          onClick={() => pickImage(true)}
          disabled={busy}
          className="card-press hover-lift group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:border-brand/60 hover:bg-card-elevated disabled:opacity-60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-besteiras/15 text-[var(--cat-besteiras)] transition-transform group-hover:scale-110">
            <Camera className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">{t("options.photo.title")}</span>
            <span className="block text-xs text-muted-foreground">{t("options.photo.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </button>

        <button
          onClick={() => pickImage(false)}
          disabled={busy}
          className="card-press hover-lift group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:border-brand/60 hover:bg-card-elevated disabled:opacity-60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-roupas/15 text-[var(--cat-roupas)] transition-transform group-hover:scale-110">
            <ImageUp className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">{t("options.gallery.title")}</span>
            <span className="block text-xs text-muted-foreground">{t("options.gallery.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </button>

        <button
          onClick={() => {
            if (!canWrite) {
              requireSubscription(t("requirePlan"));
              return;
            }
            setWaOpen(true);
          }}
          className="card-press hover-lift group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:border-emerald-500/60 hover:bg-card-elevated"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-400 transition-transform group-hover:scale-110">
            <MessageCircle className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">{t("options.whatsapp.title")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("options.whatsapp.desc")}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </button>

        <button
          onClick={goManual}
          className="card-press hover-lift group flex w-full items-center gap-4 rounded-3xl border border-border bg-card p-5 text-left shadow-card transition-all hover:border-brand/60 hover:bg-card-elevated"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cat-mercado/15 text-[var(--cat-mercado)] transition-transform group-hover:scale-110">
            <PencilLine className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold">{t("options.manual.title")}</span>
            <span className="block text-xs text-muted-foreground">{t("options.manual.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </button>
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground animate-fade-in">
        {t("hint")}
      </div>

      <div className="mt-6">
        <Button asChild variant="outline" className="w-full">
          <Link to="/app">{t("cancel")}</Link>
        </Button>
      </div>

      <WhatsAppExpenseDialog open={waOpen} onOpenChange={setWaOpen} />
    </MobileShell>
  );
}
