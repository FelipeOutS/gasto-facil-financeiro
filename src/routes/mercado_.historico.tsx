import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Home, History, WalletCards, Check, CircleDashed, Receipt, ListPlus, ShoppingBag, Store, TrendingUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import { SectionBlock } from "@/components/mercado/shell/SectionBlock";
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
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import bannerComunitarioWebp from "@/assets/mercado/banner-comunitario.webp";
import emptyCarrinho from "@/assets/mercado/empty-carrinho.webp";
import { cn } from "@/lib/utils";
import {
  useMercadoHistorico,
  removerCompraHistorico,
  type MercadoCompraHistorico,
} from "@/lib/mercado/listas-store";


export const Route = createFileRoute("/mercado_/historico")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:historico.metaTitle", { lng: i18n.language }) }],
  }),
  component: HistoricoPage,
});

function HistoricoPage() {
  const { t, i18n: i18next } = useTranslation("mercado");
  const navigate = useNavigate();
  const historico = useMercadoHistorico();
  const [pendingDelete, setPendingDelete] = useState<MercadoCompraHistorico | null>(null);
  const [deleting, setDeleting] = useState(false);


  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  const dateFormatter = new Intl.DateTimeFormat(i18next.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const summary = useMemo(() => {
    if (historico.length === 0) {
      return { totalSpent: 0, count: 0, avgTicket: 0, lastMarket: undefined as string | undefined };
    }
    const totalSpent = historico.reduce((acc, h) => acc + (h.totalEstimado || 0), 0);
    const count = historico.length;
    const avgTicket = count > 0 ? totalSpent / count : 0;
    const sorted = [...historico].sort(
      (a, b) => new Date(b.concluidaEm).getTime() - new Date(a.concluidaEm).getTime(),
    );
    const lastMarket = sorted.find((h) => h.mercadoNome)?.mercadoNome;
    return { totalSpent, count, avgTicket, lastMarket };
  }, [historico]);

  const hasHistorico = historico.length > 0;

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("historico.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("historico.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <History className="h-4 w-4" />
            </span>
            <h1 className="text-xl font-bold leading-tight tracking-tight line-clamp-2 md:text-3xl">
              {t("historyV2.banner.title")}
            </h1>
          </div>
        </div>
      </header>

      <div className="mt-4">
        <MercadoBanner
          title={t("historyV2.banner.title")}
          subtitle={t("historyV2.banner.subtitle")}
          imageSrc={bannerComunitario}
          imageSrcWebp={bannerComunitarioWebp}
          tone="community"
        />
      </div>

      {hasHistorico && (
        <SectionBlock title={t("historyV2.summary.title")} className="mt-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile
              icon={<WalletCards className="h-4 w-4" />}
              label={t("historyV2.summary.totalSpent")}
              value={<Money value={summary.totalSpent} />}
            />
            <SummaryTile
              icon={<ShoppingBag className="h-4 w-4" />}
              label={t("historyV2.summary.purchaseCount")}
              value={String(summary.count)}
            />
            <SummaryTile
              icon={<TrendingUp className="h-4 w-4" />}
              label={t("historyV2.summary.averageTicket")}
              value={<Money value={summary.avgTicket} />}
            />
            <SummaryTile
              icon={<Store className="h-4 w-4" />}
              label={t("historyV2.summary.lastMarket")}
              value={summary.lastMarket ?? t("historyV2.summary.noMarket")}
              truncate
            />
          </div>
        </SectionBlock>
      )}

      {!hasHistorico ? (
        <section className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <img
            src={emptyCarrinho}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-32 w-32 object-contain opacity-90"
          />
          <h2 className="mt-3 text-lg font-semibold">{t("historyV2.empty.title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("historyV2.empty.description")}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            <Link
              to="/mercado/listas/nova"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
            >
              <ListPlus className="h-4 w-4" />
              {t("historyV2.empty.createList")}
            </Link>
            <Link
              to="/mercado/importar-cupom"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card-elevated active:scale-[0.98]"
            >
              <Receipt className="h-4 w-4" />
              {t("historyV2.empty.importReceipt")}
            </Link>
          </div>
        </section>
      ) : (
        <SectionBlock title={t("historyV2.list.title")} className="mt-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {historico.map((h) => (
              <HistoricoCard
                key={h.id}
                item={h}
                dateFormatter={dateFormatter}
                onRequestDelete={() => setPendingDelete(h)}
              />
            ))}
          </div>
        </SectionBlock>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("historyV2.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("historyV2.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("historyV2.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDelete || deleting) return;
                setDeleting(true);
                try {
                  const ok = removerCompraHistorico(pendingDelete.id);
                  if (ok) {
                    toast.success(t("historyV2.deleteDialog.success"));
                    setPendingDelete(null);
                  } else {
                    toast.error(t("historyV2.deleteDialog.error"));
                  }
                } catch {
                  toast.error(t("historyV2.deleteDialog.error"));
                } finally {
                  setDeleting(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("historyV2.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );

}

function HistoricoCard({
  item,
  dateFormatter,
}: {
  item: MercadoCompraHistorico;
  dateFormatter: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation("mercado");
  const hasBudget = typeof item.orcamento === "number" && item.orcamento > 0;
  const overBudget = hasBudget && item.economiaOuEstouro < 0;
  const diffAbs = Math.abs(item.economiaOuEstouro);
  const diffFormatted = diffAbs.toLocaleString(undefined, {
    style: "currency",
    currency: "BRL",
  });

  return (
    <article className="flex h-full flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <WalletCards className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{item.nome || "—"}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-card-elevated px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-foreground/80 ring-1 ring-border/60">
              {t(`nova.fields.tipo.options.${item.tipo}`)}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {t("historico.card.finishedOn")} {dateFormatter.format(new Date(item.concluidaEm))}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile
          icon={<Check className="h-4 w-4" />}
          label={t("historico.card.bought")}
          value={String(item.itensComprados)}
          tone="success"
        />
        <Tile
          icon={<CircleDashed className="h-4 w-4" />}
          label={t("historico.card.pending")}
          value={String(item.itensPendentes)}
          tone={item.itensPendentes > 0 ? "warning" : "muted"}
        />
        <Tile
          icon={<WalletCards className="h-4 w-4" />}
          label={t("historico.card.totalEstimated")}
          value={<Money value={item.totalEstimado} />}
        />
      </div>

      {hasBudget ? (
        <div
          className={cn(
            "rounded-2xl border p-3",
            overBudget
              ? "border-destructive/30 bg-destructive/10"
              : "border-success/30 bg-success/10",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("historico.card.budget")}
            </span>
            <span className="text-[12px] font-semibold tabular-nums">
              <Money value={item.orcamento ?? 0} />
            </span>
          </div>
          <p
            className={cn(
              "mt-1 text-[12px] font-semibold",
              overBudget ? "text-destructive" : "text-success",
            )}
          >
            {overBudget
              ? t("historico.card.overBy", { value: diffFormatted })
              : t("historico.card.savedBy", { value: diffFormatted })}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card-elevated p-3 text-[12px] text-muted-foreground">
          {t("historico.card.noBudget")}
        </div>
      )}

      <p className="truncate text-[12px] text-muted-foreground">
        {item.mercadoNome
          ? t("historico.card.market", { value: item.mercadoNome })
          : t("historico.card.marketUnknown")}
      </p>

      <p className="text-[12px] text-muted-foreground">
        {t("historico.card.progress", { percent: item.percentualConcluido })}
      </p>
    </article>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-brand";
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card-elevated p-2.5">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-card ring-1 ring-border/60",
          toneClass,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  truncate = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  truncate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border/60 bg-card p-3 shadow-card">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand ring-1 ring-border/60">
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "text-base font-bold tabular-nums text-foreground md:text-lg",
          truncate && "truncate",
        )}
      >
        {value}
      </p>
    </div>
  );
}

