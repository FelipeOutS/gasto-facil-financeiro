import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  Plus,
  Check,
  Pencil,
  Trash2,
  ListChecks,
  ShoppingBasket,
  WalletCards,
  CircleDashed,
  CheckCircle2,
  X,
  Save,
  ScanBarcode,
  Search,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  buscarProdutoPorCodigoBarras,
  ProductLookupError,
  type ProductLookupResult,
} from "@/lib/mercado/products-api";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import {
  addItemLista,
  computeOrcamentoLista,
  computeResumo,
  finalizarListaCompra,
  removeItemLista,
  toggleItemComprado,
  updateItemLista,
  useMercadoLista,
  type ListaItem,
  type ListaStatus,
  type MercadoLista,
} from "@/lib/mercado/listas-store";

export const Route = createFileRoute("/mercado_/listas_/$id")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:detail.metaTitle", { lng: i18n.language }) }],
  }),
  component: ListaDetailPage,
});

function ListaDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const lista = useMercadoLista(id);

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado/listas" });
  }

  if (!lista) {
    return (
      <MobileShell wide>
        <HeaderBar onBack={handleBack} title={t("detail.titleFallback")} />
        <section className="mt-8 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card-elevated text-muted-foreground ring-1 ring-border/60">
            <ListChecks className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">{t("detail.notFoundTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("detail.notFoundDescription")}
          </p>
          <Link
            to="/mercado/listas"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("detail.back")}
          </Link>
        </section>
      </MobileShell>
    );
  }

  return <ListaContent lista={lista} onBack={handleBack} />;
}

function HeaderBar({ onBack, title }: { onBack: () => void; title: string }) {
  const { t } = useTranslation("mercado");
  return (
    <header className="flex items-start gap-3 pt-1">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("detail.back")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <Link
        to="/app"
        aria-label={t("detail.home")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
      >
        <Home className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      </div>
    </header>
  );
}

const statusToneMap: Record<ListaStatus, string> = {
  planning: "bg-warning/10 text-warning ring-1 ring-warning/20",
  ongoing: "bg-primary/10 text-primary ring-1 ring-primary/20",
  done: "bg-success/10 text-success ring-1 ring-success/20",
};

function ListaContent({ lista, onBack }: { lista: MercadoLista; onBack: () => void }) {
  const { t, i18n: i18next } = useTranslation("mercado");
  const resumo = useMemo(() => computeResumo(lista), [lista]);

  const dateFormatter = new Intl.DateTimeFormat(i18next.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <MobileShell wide>
      {/* Header */}
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("detail.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("detail.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{lista.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-card-elevated px-2.5 py-1 text-[11px] font-semibold text-foreground/80 ring-1 ring-border/60">
              {t(`nova.fields.tipo.options.${lista.tipo}`)}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
                statusToneMap[lista.status],
              )}
            >
              {t(`detail.status.${lista.status === "ongoing" ? "active" : lista.status}`)}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {dateFormatter.format(new Date(lista.createdAt))}
            </span>
          </div>
        </div>
      </header>

      {/* Resumo */}
      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          icon={WalletCards}
          label={t("detail.summary.totalEstimated")}
          value={<Money value={resumo.totalEstimado} />}
        />
        <SummaryTile
          icon={Check}
          label={t("detail.summary.bought")}
          value={String(resumo.itensComprados)}
          tone="success"
        />
        <SummaryTile
          icon={CircleDashed}
          label={t("detail.summary.pending")}
          value={String(resumo.itensPendentes)}
          tone="warning"
        />
        <SummaryTile
          icon={ShoppingBasket}
          label={t("detail.summary.progress")}
          value={`${resumo.percentualConcluido}%`}
        />
      </section>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("detail.summary.progress")}
          </span>
          <span className="text-[12px] font-semibold tabular-nums text-foreground">
            {resumo.itensComprados}/{resumo.totalItens}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={resumo.percentualConcluido}
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-card-elevated ring-1 ring-border/60"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              lista.status === "done"
                ? "bg-success"
                : lista.status === "ongoing"
                  ? "bg-primary"
                  : "bg-warning",
            )}
            style={{ width: `${Math.max(0, Math.min(100, resumo.percentualConcluido))}%` }}
          />
        </div>
      </div>

      {/* Budget */}
      <BudgetCard lista={lista} />





      {/* Form */}
      <AddItemForm listaId={lista.id} />

      {/* Items */}
      {lista.entries.length === 0 ? (
        <section className="mt-5 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
            <ShoppingBasket className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">{t("detail.empty.title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("detail.empty.description")}
          </p>
        </section>
      ) : (
        <section className="mt-5 flex flex-col gap-3">
          {lista.entries.map((item) => (
            <ItemRow key={item.id} item={item} listaId={lista.id} />
          ))}
        </section>
      )}

      {/* Finalize */}
      <FinalizeCard lista={lista} />
    </MobileShell>
  );
}

function BudgetCard({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const o = useMemo(() => computeOrcamentoLista(lista), [lista]);

  if (!o.hasBudget) {
    return (
      <section className="mt-4 rounded-3xl border border-dashed border-border bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated text-muted-foreground ring-1 ring-border/60">
            <WalletCards className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {t("detail.budget.noBudgetTitle")}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {t("detail.budget.noBudgetHint")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const pct = o.percentualUsado;
  const barWidth = Math.max(0, Math.min(100, pct));
  const barClass = pct > 100 ? "bg-destructive" : pct > 80 ? "bg-warning" : "bg-success";
  const pctTextClass =
    pct > 100 ? "text-destructive" : pct > 80 ? "text-warning" : "text-success";
  const diffAbs = Math.abs(o.diferenca);

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated ring-1 ring-border/60",
            pctTextClass,
          )}
        >
          <WalletCards className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{t("detail.budget.title")}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t("detail.budget.subtitle")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("detail.budget.defined")}
          </p>
          <p className="mt-1 text-base font-bold tabular-nums">
            <Money value={o.budget} />
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("detail.budget.totalEstimated")}
          </p>
          <p className="mt-1 text-base font-bold tabular-nums">
            <Money value={o.totalEstimado} />
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card-elevated p-3">
          <p
            className={cn(
              "truncate text-[10px] font-semibold uppercase tracking-widest",
              o.overBudget ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {o.overBudget ? t("detail.budget.over") : t("detail.budget.remaining")}
          </p>
          <p
            className={cn(
              "mt-1 text-base font-bold tabular-nums",
              o.overBudget ? "text-destructive" : "text-success",
            )}
          >
            <Money value={diffAbs} />
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("detail.budget.usedLabel")}
          </span>
          <span className={cn("text-[12px] font-semibold tabular-nums", pctTextClass)}>
            {pct}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct)}
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-card-elevated ring-1 ring-border/60"
        >
          <div
            className={cn("h-full rounded-full transition-all", barClass)}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <p
          className={cn(
            "mt-2 text-[12px]",
            o.overBudget ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {o.overBudget
            ? t("detail.budget.overHint", {
                value: diffAbs.toLocaleString(undefined, {
                  style: "currency",
                  currency: "BRL",
                }),
              })
            : t("detail.budget.withinHint", {
                value: diffAbs.toLocaleString(undefined, {
                  style: "currency",
                  currency: "BRL",
                }),
              })}
        </p>
      </div>
    </section>
  );
}



function SummaryTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone?: "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-brand";
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-card sm:p-4">
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated ring-1 ring-border/60",
          toneClass,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 truncate text-base font-bold">{value}</p>
      </div>
    </div>
  );
}

function parseNumber(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function AddItemForm({ listaId }: { listaId: string }) {
  const { t } = useTranslation("mercado");
  const [nome, setNome] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [unidade, setUnidade] = useState("");
  const [precoEstimado, setPrecoEstimado] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      toast.error(t("detail.form.requiredName"));
      return;
    }
    const created = addItemLista(listaId, {
      nome: trimmed,
      quantidade: parseNumber(quantidade) ?? 1,
      unidade: unidade.trim() || undefined,
      precoEstimado: parseNumber(precoEstimado),
    });
    if (created) {
      toast.success(t("detail.form.added"));
      setNome("");
      setQuantidade("1");
      setUnidade("");
      setPrecoEstimado("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5"
    >
      <h2 className="text-sm font-semibold text-foreground">{t("detail.form.title")}</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label
            htmlFor="item-nome"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.form.itemName")}
          </label>
          <input
            id="item-nome"
            type="text"
            required
            maxLength={80}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("detail.form.itemName")}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label
            htmlFor="item-quantidade"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.form.quantity")}
          </label>
          <input
            id="item-quantidade"
            type="text"
            inputMode="decimal"
            maxLength={8}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value.replace(/[^\d.,]/g, ""))}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label
            htmlFor="item-unidade"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.form.unit")}
          </label>
          <input
            id="item-unidade"
            type="text"
            maxLength={12}
            value={unidade}
            onChange={(e) => setUnidade(e.target.value)}
            placeholder={t("detail.form.unitPlaceholder")}
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="md:col-span-2">
          <label
            htmlFor="item-preco"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.form.estimatedPrice")}
          </label>
          <input
            id="item-preco"
            type="text"
            inputMode="decimal"
            maxLength={12}
            value={precoEstimado}
            onChange={(e) => setPrecoEstimado(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0,00"
            className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {t("detail.form.add")}
        </button>
      </div>
    </form>
  );
}

function ItemRow({ item, listaId }: { item: ListaItem; listaId: string }) {
  const { t } = useTranslation("mercado");
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(item.nome);
  const [quantidade, setQuantidade] = useState(String(item.quantidade));
  const [unidade, setUnidade] = useState(item.unidade ?? "");
  const [precoEstimado, setPrecoEstimado] = useState(
    item.precoEstimado != null ? String(item.precoEstimado) : "",
  );

  function startEdit() {
    setNome(item.nome);
    setQuantidade(String(item.quantidade));
    setUnidade(item.unidade ?? "");
    setPrecoEstimado(item.precoEstimado != null ? String(item.precoEstimado) : "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveEdit() {
    const trimmed = nome.trim();
    if (!trimmed) {
      toast.error(t("detail.form.requiredName"));
      return;
    }
    updateItemLista(listaId, item.id, {
      nome: trimmed,
      quantidade: parseNumber(quantidade) ?? 1,
      unidade: unidade.trim() || undefined,
      precoEstimado: parseNumber(precoEstimado),
    });
    toast.success(t("detail.form.updated"));
    setEditing(false);
  }

  function handleRemove() {
    if (typeof window !== "undefined" && !window.confirm(t("detail.item.confirmRemove"))) {
      return;
    }
    removeItemLista(listaId, item.id);
    toast.success(t("detail.form.removed"));
  }

  function handleToggle() {
    toggleItemComprado(listaId, item.id);
  }

  if (editing) {
    return (
      <article className="rounded-3xl border border-border/60 bg-card p-4 shadow-card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("detail.form.itemName")}
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={80}
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("detail.form.quantity")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value.replace(/[^\d.,]/g, ""))}
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("detail.form.unit")}
            </label>
            <input
              type="text"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              maxLength={12}
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("detail.form.estimatedPrice")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={precoEstimado}
              onChange={(e) => setPrecoEstimado(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0,00"
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cancelEdit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:text-foreground active:scale-[0.98]"
          >
            <X className="h-4 w-4" />
            {t("detail.form.cancel")}
          </button>
          <button
            type="button"
            onClick={saveEdit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <Save className="h-4 w-4" />
            {t("detail.form.save")}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-card transition-colors md:p-4",
        item.comprado && "opacity-80",
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-label={item.comprado ? t("detail.item.markPending") : t("detail.item.markBought")}
        aria-pressed={item.comprado}
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-2xl border transition-all active:scale-95",
          item.comprado
            ? "border-success/40 bg-success/15 text-success"
            : "border-border bg-card-elevated text-muted-foreground hover:text-foreground",
        )}
      >
        {item.comprado ? <Check className="h-5 w-5" /> : <CircleDashed className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-semibold text-foreground sm:text-base",
            item.comprado && "line-through text-muted-foreground",
          )}
        >
          {item.nome}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {item.quantidade}
          {item.unidade ? ` ${item.unidade}` : ""}
          {item.precoEstimado != null ? (
            <>
              {" · "}
              <Money value={item.precoEstimado * (item.quantidade || 1)} />
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={startEdit}
          aria-label={t("detail.item.edit")}
          className="grid h-10 w-10 place-items-center rounded-2xl border border-border bg-card-elevated text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleRemove}
          aria-label={t("detail.item.remove")}
          className="grid h-10 w-10 place-items-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15 active:scale-95"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function FinalizeCard({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const resumo = useMemo(() => computeResumo(lista), [lista]);

  function handleFinalize() {
    if (resumo.totalItens === 0) {
      toast.error(t("detail.finalize.emptyError"));
      return;
    }
    if (resumo.itensPendentes > 0) {
      const ok =
        typeof window !== "undefined" &&
        window.confirm(t("detail.finalize.confirmPending"));
      if (!ok) return;
    }
    const result = finalizarListaCompra(lista.id);
    if (!result) {
      toast.error(t("detail.finalize.error"));
      return;
    }
    toast.success(t("detail.finalize.success"));
    void navigate({ to: "/mercado/historico" });
  }

  return (
    <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated text-success ring-1 ring-border/60">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              {t("detail.finalize.cta")}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t("detail.finalize.hint")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleFinalize}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
        >
          <CheckCircle2 className="h-4 w-4" />
          {t("detail.finalize.cta")}
        </button>
      </div>
    </section>
  );
}

