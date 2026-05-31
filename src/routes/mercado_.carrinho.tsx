import { useMemo, useState, type FormEvent } from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  ShoppingCart,
  ListChecks,
  CircleDashed,
  Plus,
  CheckCircle2,
  Flag,
  Pencil,
  X,
  Save,
  ScanBarcode,
  Search,
  Loader2,
  Check,
  ShoppingBasket,
} from "lucide-react";
import { BarcodeScannerButton } from "@/components/mercado/BarcodeScannerButton";
import {
  buscarProdutoPorCodigoBarras,
  ProductLookupError,
  type ProductLookupResult,
} from "@/lib/mercado/products-api";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { confirmAsync } from "@/components/ConfirmDialog";
import { Money } from "@/components/Money";
import { PrecoInsight } from "@/components/mercado/PrecoInsight";
import { CommunityPriceSuggestion } from "@/components/mercado/CommunityPriceSuggestion";
import { CommunityPriceSavingsSummary } from "@/components/mercado/CommunityPriceSavingsSummary";
import {
  getSuggestionsFor,
  useActiveCommunityPrices,
} from "@/lib/mercado/community-prices-suggestions";

import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import {
  addItemLista,
  computeOrcamentoLista,
  computeResumo,
  finalizarListaCompra,
  toggleItemComprado,
  updateItemLista,
  useMercadoLista,
  useMercadoListas,
  type ListaItem,
  type MercadoLista,
} from "@/lib/mercado/listas-store";

type CarrinhoSearch = { lista?: string };

export const Route = createFileRoute("/mercado_/carrinho")({
  head: () => ({
    meta: [{ title: i18n.t("mercado:carrinho.metaTitle", { lng: i18n.language }) }],
  }),
  validateSearch: (raw: Record<string, unknown>): CarrinhoSearch => ({
    lista: typeof raw.lista === "string" && raw.lista ? raw.lista : undefined,
  }),
  component: CarrinhoPage,
});

function CarrinhoPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const { lista: listaId } = useSearch({ from: "/mercado_/carrinho" }) as CarrinhoSearch;
  const lista = useMercadoLista(listaId);

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  return (
    <MobileShell wide>
      <header className="flex items-start gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("carrinho.back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link
          to="/app"
          aria-label={t("carrinho.home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          <Home className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
              <ShoppingCart className="h-4 w-4" />
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {t("carrinho.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("carrinho.subtitle")}
          </p>
        </div>
      </header>

      {listaId && lista ? (
        <CartMode key={lista.id} lista={lista} />
      ) : (
        <ListPicker requestedId={listaId} />
      )}
    </MobileShell>
  );
}

// ---------------------------------------------------------------------------
// List picker
// ---------------------------------------------------------------------------

function ListPicker({ requestedId }: { requestedId?: string }) {
  const { t } = useTranslation("mercado");
  const listas = useMercadoListas();

  // requestedId was passed but list missing → show notice
  const showMissing = !!requestedId && !listas.some((l) => l.id === requestedId);

  if (listas.length === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
          <ListChecks className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{t("carrinho.empty.title")}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {t("carrinho.empty.description")}
        </p>
        <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link
            to="/mercado/listas/nova"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            {t("carrinho.empty.cta")}
          </Link>
          <Link
            to="/mercado/listas"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-card-elevated"
          >
            {t("carrinho.empty.secondaryCta")}
          </Link>
        </div>
        <p className="mx-auto mt-3 max-w-md text-[11px] text-muted-foreground">
          {t("carrinho.empty.helper")}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5">
      {showMissing && (
        <p className="mb-3 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-[13px] text-warning">
          {t("carrinho.missingList")}
        </p>
      )}
      <h2 className="text-base font-semibold md:text-lg">{t("carrinho.picker.title")}</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {t("carrinho.picker.description")}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {listas.map((l) => (
          <ListPickerCard key={l.id} lista={l} />
        ))}
      </ul>
    </section>
  );
}

function ListPickerCard({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const resumo = computeResumo(lista);
  const orc = computeOrcamentoLista(lista);
  return (
    <li className="flex h-full flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ListChecks className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{lista.name || "—"}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t(`nova.fields.tipo.options.${lista.tipo}`)} ·{" "}
            {t("carrinho.picker.itemsCount", { count: resumo.totalItens })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Mini label={t("carrinho.picker.totalEstimated")} value={<Money value={resumo.totalEstimado} />} />
        <Mini
          label={t("carrinho.picker.budget")}
          value={orc.hasBudget ? <Money value={orc.budget} /> : "—"}
        />
      </div>

      <Link
        to="/mercado/carrinho"
        search={{ lista: lista.id }}
        className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
      >
        <ShoppingCart className="h-4 w-4" />
        {t("carrinho.picker.use")}
      </Link>
    </li>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card-elevated p-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cart mode
// ---------------------------------------------------------------------------

function CartMode({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const { can } = usePlan();
  const resumo = useMemo(() => computeResumo(lista), [lista]);
  const orc = useMemo(() => computeOrcamentoLista(lista), [lista]);
  const [mercadoNome, setMercadoNome] = useState("");

  const status: "sem_orcamento" | "dentro" | "atencao" | "excedido" = !orc.hasBudget
    ? "sem_orcamento"
    : orc.percentualUsado > 100
      ? "excedido"
      : orc.percentualUsado > 80
        ? "atencao"
        : "dentro";

  const tone = toneFor(status);
  const progressPct = Math.min(100, Math.max(0, orc.percentualUsado));

  async function handleFinalize() {
    if (resumo.totalItens === 0) {
      toast.error(t("carrinho.finalize.errorEmpty"));
      return;
    }
    if (resumo.itensPendentes > 0) {
      const ok = await confirmAsync({
        title: t("carrinho.finalize.confirmPending", { pending: resumo.itensPendentes }),
      });
      if (!ok) return;
    }
    const entry = finalizarListaCompra(lista.id, {
      mercadoNome: mercadoNome.trim() || undefined,
    });
    if (!entry) {
      toast.error(t("carrinho.finalize.errorGeneric"));
      return;
    }
    toast.success(t("carrinho.finalize.success"));
    // Etapa 17 — só leva ao histórico se o usuário tem `mercado_avancado`;
    // caso contrário volta à hub para evitar o modal premium logo após finalizar.
    void navigate({ to: can("mercado_avancado") ? "/mercado/historico" : "/mercado" });
  }

  return (
    <>
      {/* Summary */}
      <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("carrinho.summary.activeList")}
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold md:text-lg">
              {lista.name || "—"}
            </h2>
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
              tone.badge,
            )}
          >
            {t(`carrinho.status.${status}`)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Mini label={t("carrinho.summary.totalEstimated")} value={<Money value={resumo.totalEstimado} />} />
          <Mini label={t("carrinho.summary.totalBought")} value={<Money value={resumo.totalCompradoEstimado} />} />
          <Mini label={t("carrinho.summary.bought")} value={String(resumo.itensComprados)} />
          <Mini label={t("carrinho.summary.pending")} value={String(resumo.itensPendentes)} />
          <Mini
            label={t("carrinho.summary.budget")}
            value={orc.hasBudget ? <Money value={orc.budget} /> : "—"}
          />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>{t("carrinho.summary.progress", { percent: resumo.percentualConcluido })}</span>
            {orc.hasBudget && (
              <span className="tabular-nums">{orc.percentualUsado}%</span>
            )}
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated ring-1 ring-border/60">
            <div
              className={cn("h-full transition-all", tone.bar)}
              style={{ width: `${progressPct}%` }}
              aria-hidden
            />
          </div>
        </div>

        <p className={cn("mt-3 rounded-2xl border p-3 text-[13px] leading-snug", tone.message)}>
          {t(`carrinho.message.${status}`)}
        </p>

        <div className="mt-4">
          <label
            htmlFor="carrinho-mercado"
            className="block text-[12px] font-semibold text-foreground"
          >
            {t("detail.finalize.marketLabel")}
          </label>
          <input
            id="carrinho-mercado"
            type="text"
            value={mercadoNome}
            onChange={(e) => setMercadoNome(e.target.value)}
            maxLength={80}
            placeholder={t("detail.finalize.marketPlaceholder")}
            className="mt-1.5 w-full min-w-0 rounded-2xl border border-border bg-card-elevated px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("detail.finalize.marketHint")}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link
            to="/mercado/carrinho"
            search={{}}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-card active:scale-[0.98]"
          >
            {t("carrinho.summary.changeList")}
          </Link>
          <button
            type="button"
            onClick={handleFinalize}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98]"
          >
            <Flag className="h-4 w-4" />
            {t("carrinho.summary.finalize")}
          </button>
        </div>
      </section>

      {/* Quick add */}
      <QuickAddForm listaId={lista.id} />

      {/* Items */}
      <section className="mt-5">
        <h2 className="text-base font-semibold md:text-lg">{t("carrinho.items.title")}</h2>
        {lista.entries.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-dashed border-border bg-card p-6 text-center shadow-card">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-card-elevated text-brand ring-1 ring-border/60">
              <ListChecks className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm text-muted-foreground">{t("carrinho.items.empty")}</p>
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {lista.entries.map((it) => (
              <CartItemRow key={it.id} listaId={lista.id} item={it} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function CartItemRow({ listaId, item }: { listaId: string; item: ListaItem }) {
  const { t } = useTranslation("mercado");
  const [editing, setEditing] = useState(false);
  const [valor, setValor] = useState<string>(
    item.precoEstimado != null ? String(item.precoEstimado) : "",
  );

  function handleToggle() {
    toggleItemComprado(listaId, item.id);
  }

  function handleSavePrice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = Number(valor.replace(",", "."));
    updateItemLista(listaId, item.id, {
      precoEstimado: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    });
    setEditing(false);
  }

  const subtotal = (item.precoEstimado ?? 0) * (item.quantidade || 1);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card transition-colors",
        item.comprado ? "border-success/30 bg-success/5" : "border-border/60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-label={
            item.comprado ? t("carrinho.items.unmark") : t("carrinho.items.mark")
          }
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ring-border/60 transition-colors active:scale-95",
            item.comprado
              ? "bg-success text-success-foreground"
              : "bg-card-elevated text-muted-foreground hover:text-foreground",
          )}
        >
          {item.comprado ? <CheckCircle2 className="h-5 w-5" /> : <CircleDashed className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              item.comprado && "text-muted-foreground line-through",
            )}
          >
            {item.nome}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {item.quantidade} {item.unidade || ""} ×{" "}
            <span className="tabular-nums"><Money value={item.precoEstimado || 0} /></span>
            {" = "}
            <span className="tabular-nums"><Money value={subtotal} /></span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-label={t("carrinho.items.editPrice")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-card-elevated text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </button>
      </div>

      {editing && (
        <form onSubmit={handleSavePrice} className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-muted-foreground">R$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={t("carrinho.items.pricePlaceholder")}
            className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-card-elevated px-3 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand"
          />
          <button
            type="submit"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-grad px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-elevated active:scale-[0.98]"
          >
            <Save className="h-3.5 w-3.5" />
            {t("carrinho.items.save")}
          </button>
        </form>
      )}
      {editing && (
        <PrecoInsight
          nome={item.nome}
          codigoBarras={item.codigoBarras}
          precoUnitario={Number(valor.replace(",", ".")) || undefined}
        />
      )}
    </li>
  );
}

function QuickAddForm({ listaId }: { listaId: string }) {
  const { t } = useTranslation("mercado");
  const [nome, setNome] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [unidade, setUnidade] = useState("");
  const [preco, setPreco] = useState("");

  const subtotalPreview = (Number(quantidade) || 1) * (Number(preco.replace(",", ".")) || 0);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error(t("carrinho.quickAdd.errorNome"));
      return;
    }
    const q = Number(quantidade);
    const p = Number(preco.replace(",", "."));
    const created = addItemLista(listaId, {
      nome,
      quantidade: Number.isFinite(q) && q > 0 ? q : 1,
      unidade: unidade.trim() || undefined,
      precoEstimado: Number.isFinite(p) && p > 0 ? p : undefined,
    });
    if (!created) {
      toast.error(t("carrinho.quickAdd.errorGeneric"));
      return;
    }
    setNome("");
    setQuantidade("1");
    setUnidade("");
    setPreco("");
  }

  return (
    <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <h2 className="text-base font-semibold md:text-lg">{t("carrinho.quickAdd.title")}</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{t("carrinho.quickAdd.hint")}</p>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t("carrinho.quickAdd.namePlaceholder")}
          className="min-h-11 min-w-0 rounded-2xl border border-border bg-card-elevated px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand sm:col-span-5"
        />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          placeholder={t("carrinho.quickAdd.qtyPlaceholder")}
          className="min-h-11 min-w-0 rounded-2xl border border-border bg-card-elevated px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand sm:col-span-2"
        />
        <input
          type="text"
          value={unidade}
          onChange={(e) => setUnidade(e.target.value)}
          placeholder={t("carrinho.quickAdd.unitPlaceholder")}
          className="min-h-11 min-w-0 rounded-2xl border border-border bg-card-elevated px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand sm:col-span-2"
        />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          placeholder={t("carrinho.quickAdd.pricePlaceholder")}
          className="min-h-11 min-w-0 rounded-2xl border border-border bg-card-elevated px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand sm:col-span-2"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.98] sm:col-span-1"
        >
          <Plus className="h-4 w-4" />
        </button>
      </form>
      {subtotalPreview > 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {t("carrinho.quickAdd.subtotalPreview")}:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            <Money value={subtotalPreview} />
          </span>
        </p>
      )}
      <QuickAddBarcodeBlock onApplyName={(name) => setNome(name)} />
      <PrecoInsight
        nome={nome}
        precoUnitario={Number(preco.replace(",", ".")) || undefined}
      />
    </section>
  );
}

function QuickAddBarcodeBlock({ onApplyName }: { onApplyName: (name: string) => void }) {
  const { t } = useTranslation("mercado");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setError(null);
    setResult(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t("detail.barcode.invalid"));
      return;
    }
    setLoading(true);
    try {
      const r = await buscarProdutoPorCodigoBarras(trimmed);
      setResult(r);
    } catch (err) {
      if (err instanceof ProductLookupError && (err.code === "invalid" || err.code === "empty")) {
        setError(t("detail.barcode.invalid"));
      } else {
        setError(t("detail.barcode.error"));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (!result?.found) return;
    const name = result.name?.trim();
    if (!name) {
      toast.error(t("detail.barcode.noName"));
      return;
    }
    onApplyName(name);
    toast.success(t("detail.barcode.applied"));
    setResult(null);
    setCode("");
    setError(null);
  }

  return (
    <div className="mt-3 rounded-2xl border border-dashed border-border bg-card-elevated/40 p-3">
      <div className="flex items-center gap-2">
        <ScanBarcode className="h-4 w-4 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("detail.barcode.title")}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {t("detail.barcode.manualHint")}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D+/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!loading) void handleSearch();
            }
          }}
          placeholder={t("detail.barcode.placeholder")}
          className="min-h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading || !code.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span>{loading ? t("detail.barcode.loading") : t("detail.barcode.search")}</span>
        </button>
      </div>

      <div className="mt-2">
        <BarcodeScannerButton
          onDetected={(c) => {
            setCode(c);
            setError(null);
            setResult(null);
          }}
        />
      </div>

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}

      {result && !result.found ? (
        <p className="mt-2 text-[12px] text-muted-foreground">{t("detail.barcode.notFound")}</p>
      ) : null}

      {result?.found ? (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3">
          {result.imageUrl ? (
            <img
              src={result.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-14 w-14 shrink-0 rounded-xl border border-border/60 bg-background object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border/60 bg-card-elevated text-muted-foreground">
              <ShoppingBasket className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {result.name?.trim() || t("detail.barcode.noName")}
            </p>
            {result.brand ? (
              <p className="truncate text-[12px] text-muted-foreground">{result.brand}</p>
            ) : null}
            {result.quantity ? (
              <p className="truncate text-[12px] text-muted-foreground">{result.quantity}</p>
            ) : null}
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
              {t("detail.barcode.source")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleApply}
            disabled={!result.name?.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-brand-grad px-3 py-2 text-[12px] font-semibold text-primary-foreground shadow-elevated transition hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" />
            {t("detail.barcode.useProduct")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tone helpers
// ---------------------------------------------------------------------------

function toneFor(status: "sem_orcamento" | "dentro" | "atencao" | "excedido") {
  switch (status) {
    case "dentro":
      return {
        badge: "bg-success/15 text-success ring-1 ring-success/30",
        bar: "bg-success",
        message: "border-success/30 bg-success/10 text-success",
      };
    case "atencao":
      return {
        badge: "bg-warning/15 text-warning ring-1 ring-warning/30",
        bar: "bg-warning",
        message: "border-warning/30 bg-warning/10 text-warning",
      };
    case "excedido":
      return {
        badge: "bg-destructive/15 text-destructive ring-1 ring-destructive/30",
        bar: "bg-destructive",
        message: "border-destructive/30 bg-destructive/10 text-destructive",
      };
    default:
      return {
        badge: "bg-card-elevated text-muted-foreground ring-1 ring-border/60",
        bar: "bg-muted-foreground/40",
        message: "border-border bg-card-elevated text-muted-foreground",
      };
  }
}
