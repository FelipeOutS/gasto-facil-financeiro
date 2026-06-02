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
import { confirmAsync } from "@/components/ConfirmDialog";
import { Money } from "@/components/Money";
import { PrecoInsight } from "@/components/mercado/PrecoInsight";
import { BarcodeScannerButton } from "@/components/mercado/BarcodeScannerButton";
import { CommunityPriceSuggestion } from "@/components/mercado/CommunityPriceSuggestion";
import { CommunityPriceSavingsSummary } from "@/components/mercado/CommunityPriceSavingsSummary";
import {
  getSuggestionsFor,
  useActiveCommunityPrices,
} from "@/lib/mercado/community-prices-suggestions";
import { MercadoBanner, type MercadoCategoryKey } from "@/components/mercado/shell";
import bannerComunitario from "@/assets/mercado/banner-comunitario.jpg";
import bannerComunitarioWebp from "@/assets/mercado/banner-comunitario.webp";
import emptyCarrinho from "@/assets/mercado/empty-carrinho.webp";

import { cn } from "@/lib/utils";
import { FinalizeMarketDialog } from "@/components/mercado/FinalizeMarketDialog";
import { submitHistoricoToCommunity } from "@/lib/mercado/community-prices-from-purchase";
import { usePlan } from "@/lib/use-plan";
import {
  addItemLista,
  computeOrcamentoLista,
  computeResumo,
  finalizarListaCompra,
  removeItemLista,
  removeLista,
  toggleItemComprado,
  updateItemLista,
  updateListaDados,
  useMercadoLista,
  type ListaItem,
  type ListaStatus,
  type ListaTipo,
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
    void navigate({ to: "/mercado/listas", replace: true });
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

type CategoryGroupKey = MercadoCategoryKey | "outros";

const CATEGORY_GROUP_ORDER: CategoryGroupKey[] = [
  "hortifruti",
  "acougue",
  "padaria",
  "bebidas",
  "laticinios",
  "limpeza",
  "mercearia",
  "utilidades",
  "outros",
];

const CATEGORY_KEYWORDS: Record<MercadoCategoryKey, string[]> = {
  hortifruti: ["hortifruti", "fruta", "verdura", "legume", "tomate", "alface", "banana", "maca", "maçã", "cebola", "batata", "cenoura"],
  acougue: ["acougue", "açougue", "carne", "frango", "boi", "porco", "linguica", "linguiça", "bife", "file", "filé", "peito", "coxa"],
  padaria: ["padaria", "pao", "pão", "bolo", "biscoito", "torrada", "croissant", "rosca"],
  bebidas: ["bebida", "refrigerante", "suco", "agua", "água", "cerveja", "vinho", "cafe", "café", "cha", "chá", "leite condensado"],
  laticinios: ["laticinio", "laticínio", "leite", "queijo", "iogurte", "manteiga", "requeijao", "requeijão", "creme de leite"],
  limpeza: ["limpeza", "detergente", "sabao", "sabão", "amaciante", "desinfetante", "esponja", "agua sanitaria", "água sanitária", "alvejante"],
  mercearia: ["mercearia", "arroz", "feijao", "feijão", "macarrao", "macarrão", "azeite", "oleo", "óleo", "sal", "acucar", "açúcar", "farinha", "molho"],
  utilidades: ["utilidade", "papel higienico", "papel higiênico", "guardanapo", "fralda", "absorvente", "escova", "pasta de dente", "sabonete", "shampoo"],
};

function detectCategory(item: ListaItem): CategoryGroupKey {
  const explicit = item.categoria?.toLowerCase().trim();
  if (explicit) {
    for (const key of Object.keys(CATEGORY_KEYWORDS) as MercadoCategoryKey[]) {
      if (explicit.includes(key) || CATEGORY_KEYWORDS[key].some((k) => explicit.includes(k))) {
        return key;
      }
    }
  }
  const name = item.nome.toLowerCase();
  for (const key of Object.keys(CATEGORY_KEYWORDS) as MercadoCategoryKey[]) {
    if (CATEGORY_KEYWORDS[key].some((k) => name.includes(k))) return key;
  }
  return "outros";
}

function ListaContent({ lista, onBack }: { lista: MercadoLista; onBack: () => void }) {
  const { t, i18n: i18next } = useTranslation("mercado");
  const resumo = useMemo(() => computeResumo(lista), [lista]);
  const [search, setSearch] = useState("");

  const dateFormatter = new Intl.DateTimeFormat(i18next.language || "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lista.entries;
    return lista.entries.filter((e) => e.nome.toLowerCase().includes(q));
  }, [lista.entries, search]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<CategoryGroupKey, ListaItem[]>();
    for (const item of filteredEntries) {
      const key = detectCategory(item);
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    return CATEGORY_GROUP_ORDER.filter((k) => groups.has(k)).map(
      (k) => [k, groups.get(k)!] as const,
    );
  }, [filteredEntries]);

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

      {/* Visual banner */}
      <div className="mt-4">
        <MercadoBanner
          tone="fresh"
          title={lista.name}
          subtitle={t("listDetailV2.bannerSubtitle")}
          imageSrc={bannerComunitario}
          imageSrcWebp={bannerComunitarioWebp}
          imageAlt={t("listDetailV2.bannerSubtitle")}
          compact
        />
      </div>

      {/* Local search */}
      <div className="mt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("listDetailV2.searchPlaceholder")}
            aria-label={t("listDetailV2.searchAria")}
            className="min-h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>


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

      {/* Edit list metadata (name, tipo, estimate, observation) */}
      <EditListaCard lista={lista} />






      {/* Form */}
      <AddItemForm listaId={lista.id} />

      {/* Items */}
      {lista.entries.length === 0 ? (
        <section className="mt-5 overflow-hidden rounded-3xl border border-dashed border-border bg-card p-6 text-center shadow-card md:p-8">
          <img
            src={emptyCarrinho}
            alt={t("listDetailV2.emptyImageAlt")}
            loading="lazy"
            className="mx-auto h-28 w-auto object-contain sm:h-36"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <h2 className="mt-4 text-lg font-semibold">{t("listDetailV2.emptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("listDetailV2.emptyDesc")}
          </p>
        </section>
      ) : filteredEntries.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
          {t("listDetailV2.noMatch")}
        </section>
      ) : (
        <>
          <section className="mt-5 flex flex-col gap-5 pb-24 md:pb-0">
            {groupedEntries.map(([groupKey, items]) => (
              <div key={groupKey}>
                <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t(`listDetailV2.groupTitle.${groupKey}`)}{" "}
                  <span className="text-foreground/60 normal-case tracking-normal">· {items.length}</span>
                </h3>
                <div className="flex flex-col gap-3">
                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} listaId={lista.id} />
                  ))}
                </div>
              </div>
            ))}
          </section>
          <CommunityPriceSavingsSummary
            items={lista.entries.map((it) => ({
              nome: it.nome,
              quantidade: it.quantidade,
              precoEstimado: it.precoEstimado,
            }))}
          />
        </>
      )}

      {/* Sticky mobile summary footer */}
      {lista.entries.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-card/95 px-4 py-3 shadow-elevated backdrop-blur md:hidden"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-screen-sm items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("listDetailV2.stickyTotal")}
              </p>
              <p className="truncate text-base font-bold tabular-nums">
                <Money value={resumo.totalEstimado} />
                <span className="ml-2 text-[11px] font-medium text-muted-foreground">
                  {t("listDetailV2.stickyItems", { bought: resumo.itensComprados, total: resumo.totalItens })}
                </span>
              </p>
            </div>
            <Link
              to="/mercado/carrinho"
              search={{ lista: lista.id }}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated active:scale-[0.98]"
            >
              <ShoppingBasket className="h-4 w-4" />
              {t("listDetailV2.stickyGoCart")}
            </Link>
          </div>
        </div>
      )}

      {/* Finalize */}
      <FinalizeCard lista={lista} />

      {/* Danger zone */}
      <DangerZoneCard listaId={lista.id} />
    </MobileShell>
  );
}

function DangerZoneCard({ listaId }: { listaId: string }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  function handleConfirm() {
    setConfirming(false);
    if (removeLista(listaId)) {
      toast.success(t("detail.delete.success"));
      void navigate({ to: "/mercado/listas", replace: true });
    } else {
      toast.error(t("detail.delete.error"));
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-destructive/30 bg-destructive/5 p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-destructive">
            {t("detail.delete.title")}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {t("detail.delete.description")}
          </p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
            {t("detail.delete.button")}
          </button>
        )}
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="detail-delete-title"
          className="mt-4 rounded-2xl border border-destructive/30 bg-card p-3"
        >
          <p
            id="detail-delete-title"
            className="text-sm font-semibold text-destructive"
          >
            {t("detail.delete.confirmTitle")}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            {t("detail.delete.confirmDescription")}
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card active:scale-95"
            >
              {t("detail.delete.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 active:scale-95"
            >
              <Trash2 className="h-4 w-4" />
              {t("detail.delete.confirmButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const TIPOS_EDIT: ListaTipo[] = ["compraMes", "reposicao", "churrasco", "farmacia", "outros"];

function EditListaCard({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(lista.name);
  const [tipo, setTipo] = useState<ListaTipo>(lista.tipo);
  const [estimate, setEstimate] = useState(
    lista.estimate != null ? String(lista.estimate).replace(".", ",") : "",
  );
  const [observation, setObservation] = useState(lista.observation ?? "");

  function handleOpen() {
    setName(lista.name);
    setTipo(lista.tipo);
    setEstimate(lista.estimate != null ? String(lista.estimate).replace(".", ",") : "");
    setObservation(lista.observation ?? "");
    setOpen(true);
  }

  function handleCancel() {
    setOpen(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("detail.editList.requiredName"));
      return;
    }
    const parsed = estimate ? Number(estimate.replace(/\./g, "").replace(",", ".")) : NaN;
    const estimateValue: number | null =
      Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    const ok = updateListaDados(lista.id, {
      name: trimmed,
      tipo,
      estimate: estimateValue,
      observation: observation.trim() || null,
    });
    if (!ok) {
      toast.error(t("detail.editList.requiredName"));
      return;
    }
    toast.success(t("detail.editList.saved"));
    setOpen(false);
  }

  if (!open) {
    return (
      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("detail.editList.title")}
            </h2>
            {lista.observation && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                {lista.observation}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleOpen}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3.5 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-card active:scale-95"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("detail.editList.open")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label
            htmlFor="edit-lista-name"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.editList.name")}
          </label>
          <input
            id="edit-lista-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        <div className="md:col-span-2">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("detail.editList.tipo")}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIPOS_EDIT.map((opt) => {
              const active = tipo === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTipo(opt)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-3.5 py-2 text-sm font-medium transition-all active:scale-95",
                    active
                      ? "border-transparent bg-brand-grad text-primary-foreground shadow-elevated"
                      : "border-border bg-card-elevated text-foreground/80 hover:text-foreground",
                  )}
                >
                  {t(`nova.fields.tipo.options.${opt}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="edit-lista-estimate"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.editList.estimate")}
          </label>
          <input
            id="edit-lista-estimate"
            type="text"
            inputMode="decimal"
            maxLength={12}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value.replace(/[^\d.,]/g, ""))}
            className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("detail.editList.estimateHint")}
          </p>
        </div>

        <div>
          <label
            htmlFor="edit-lista-observation"
            className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {t("detail.editList.observation")}
          </label>
          <input
            id="edit-lista-observation"
            type="text"
            maxLength={200}
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            placeholder={t("detail.editList.observationPlaceholder")}
            className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 md:col-span-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card active:scale-95"
          >
            <X className="h-4 w-4" />
            {t("detail.editList.cancel")}
          </button>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand-grad px-4 py-2 text-sm font-semibold text-primary-foreground shadow-elevated transition active:scale-95"
          >
            <Save className="h-4 w-4" />
            {t("detail.editList.save")}
          </button>
        </div>
      </form>
    </section>
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
      <BarcodeBlock onApply={(name) => setNome(name)} />
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
          <PrecoInsight nome={nome} precoUnitario={parseNumber(precoEstimado)} />
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

function BarcodeBlock({ onApply }: { onApply: (name: string) => void }) {
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
      if (err instanceof ProductLookupError) {
        if (err.code === "invalid" || err.code === "empty") {
          setError(t("detail.barcode.invalid"));
        } else {
          setError(t("detail.barcode.error"));
        }
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
    onApply(name);
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
          className="min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading || !code.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          <span>{loading ? t("detail.barcode.loading") : t("detail.barcode.search")}</span>
        </button>
      </div>

      <div className="mt-2">
        <BarcodeScannerButton
          onDetected={(code) => {
            setCode(code);
            setError(null);
            setResult(null);
          }}
        />
      </div>

      {error ? (
        <p className="mt-2 text-[12px] text-destructive">{error}</p>
      ) : null}

      {result && !result.found ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {t("detail.barcode.notFound")}
        </p>
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



function ItemRow({ item, listaId }: { item: ListaItem; listaId: string }) {
  const { t } = useTranslation("mercado");
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(item.nome);
  const [quantidade, setQuantidade] = useState(String(item.quantidade));
  const [unidade, setUnidade] = useState(item.unidade ?? "");
  const [precoEstimado, setPrecoEstimado] = useState(
    item.precoEstimado != null ? String(item.precoEstimado) : "",
  );
  const { pool } = useActiveCommunityPrices();
  const suggestions = useMemo(
    () => getSuggestionsFor(item.nome, pool),
    [item.nome, pool],
  );

  function applyCommunityPrice(price: number) {
    setPrecoEstimado(String(price));
    updateItemLista(listaId, item.id, { precoEstimado: price });
    toast.success(t("communityPrices.suggestions.applied"));
  }

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

  async function handleRemove() {
    const ok = await confirmAsync({ title: t("detail.item.confirmRemove"), destructive: true });
    if (!ok) return;
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
            <PrecoInsight
              nome={nome}
              codigoBarras={item.codigoBarras}
              precoUnitario={parseNumber(precoEstimado)}
            />
            <CommunityPriceSuggestion
              suggestions={suggestions}
              onUse={applyCommunityPrice}
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
        "rounded-3xl border border-border/60 bg-card p-3 shadow-card transition-colors md:p-4",
        item.comprado && "opacity-80",
      )}
    >
      <div className="flex items-center gap-3">
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
      </div>
      {!item.comprado && suggestions.length > 0 ? (
        <CommunityPriceSuggestion
          suggestions={suggestions}
          onUse={applyCommunityPrice}
        />
      ) : null}
    </article>
  );
}

function FinalizeCard({ lista }: { lista: MercadoLista }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const { can } = usePlan();
  const resumo = useMemo(() => computeResumo(lista), [lista]);
  const [mercadoNome, setMercadoNome] = useState("");
  const [marketDialogOpen, setMarketDialogOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  async function handleFinalize() {
    if (resumo.totalItens === 0) {
      toast.error(t("detail.finalize.emptyError"));
      return;
    }
    if (resumo.itensPendentes > 0) {
      const ok = await confirmAsync({ title: t("detail.finalize.confirmPending") });
      if (!ok) return;
    }
    setMarketDialogOpen(true);
  }

  async function confirmFinalizeWithMarket(market: string) {
    if (finalizing) return;
    setFinalizing(true);
    try {
      setMercadoNome(market);
      const result = finalizarListaCompra(lista.id, { mercadoNome: market });
      if (!result) {
        toast.error(t("detail.finalize.error"));
        return;
      }
      setMarketDialogOpen(false);
      const r = await submitHistoricoToCommunity(result, "store");
      if (r && (r.inserted > 0 || r.updated > 0)) {
        toast.success(t("carrinho.finalize.successCommunity"));
      } else {
        toast.success(t("detail.finalize.success"));
      }
      void navigate({ to: can("mercado_avancado") ? "/mercado/historico" : "/mercado/listas" });
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <section className="mt-5 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-elevated text-success ring-1 ring-border/60">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
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
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand-grad px-5 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98] sm:w-auto"
      >
        <CheckCircle2 className="h-4 w-4" />
        {t("detail.finalize.cta")}
      </button>
      <FinalizeMarketDialog
        open={marketDialogOpen}
        onOpenChange={setMarketDialogOpen}
        defaultMarketName={mercadoNome}
        onConfirm={confirmFinalizeWithMarket}
        submitting={finalizing}
      />
    </section>
  );
}

