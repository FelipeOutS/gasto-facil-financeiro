import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImageUp, PencilLine, ArrowLeft, ChevronRight, MessageCircle } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import { WhatsAppExpenseDialog } from "@/components/WhatsAppExpenseDialog";
import i18n from "@/i18n";

export const Route = createFileRoute("/adicionar")({
  head: () => ({ meta: [{ title: i18n.t("adicionar:meta.title") }] }),
  component: Adicionar,
});

function Adicionar() {
  const { t } = useTranslation("adicionar");
  const navigate = useNavigate();
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const [busy, setBusy] = useState(false);
  const [waOpen, setWaOpen] = useState(false);

  useEffect(() => {
    if (!canWrite) {
      requireSubscription(t("requirePlan"));
    }
  }, [canWrite, requireSubscription, t]);

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

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("header.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("header.kicker")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("header.title")}</h1>
        </div>
      </header>

      <p className="mt-3 text-sm text-muted-foreground">{t("subtitle")}</p>

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
            <span className="block text-xs text-muted-foreground">{t("options.whatsapp.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </button>

        <button
          onClick={() => {
            if (!canWrite) {
              requireSubscription(t("requirePlan"));
              return;
            }
            navigate({ to: "/manual" });
          }}
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
          <Link to="/">{t("cancel")}</Link>
        </Button>
      </div>

      <WhatsAppExpenseDialog open={waOpen} onOpenChange={setWaOpen} />
    </MobileShell>
  );
}
