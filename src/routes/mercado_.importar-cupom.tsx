import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Home,
  Receipt,
  Info,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ClipboardPaste,
  Search,
  RefreshCw,
  ExternalLink,
  ListPlus,
  ListChecks,
  ShoppingCart,
  Sparkles,
  Lock,
  Plus,
  Trash2,
  ScanLine,
  Check,
} from "lucide-react";


import { useServerFn } from "@tanstack/react-start";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { QrCodeScannerButton } from "@/components/mercado/QrCodeScannerButton";
import { SavedMarketsChips } from "@/components/mercado/SavedMarketsChips";
import { MercadoBanner } from "@/components/mercado/shell/MercadoBanner";
import { SectionBlock } from "@/components/mercado/shell/SectionBlock";
import bannerOrcamento from "@/assets/mercado/banner-orcamento.jpg";
import bannerOrcamentoWebp from "@/assets/mercado/banner-orcamento.webp";
import {
  parseNfceQrContent,
  type ParsedNfceQrResult,
} from "@/lib/mercado/nfce-parser";
import {
  parseCupomItemsFromText,
  makeEmptyCupomItem,
  type CupomItemPreview,
  type CupomParseResult,
} from "@/lib/mercado/nfce-items-parser";
import {
  fetchNfceFromUrl,
  type NfceFetchResult,
} from "@/lib/mercado/nfce-fetch.functions";
import {
  useMercadoListas,
  addLista,
  addItensLista,
  registrarCompraFinalizadaDoCupom,
  type ListaTipo,
} from "@/lib/mercado/listas-store";

import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";






export const Route = createFileRoute("/mercado_/importar-cupom")({
  head: () => ({
    meta: [
      { title: i18n.t("mercado:meta.importarCupomTitle", { lng: i18n.language }) },
    ],
  }),
  component: ImportarCupomPage,
});

function ResultCard({ result }: { result: ParsedNfceQrResult }) {
  const { t } = useTranslation("mercado");

  const tone = useMemo(() => {
    switch (result.status) {
      case "valid_nfce_url":
        return {
          icon: CheckCircle2,
          ring: "ring-success/30",
          bg: "bg-success/10",
          color: "text-success",
        };
      case "possible_nfce_url":
        return {
          icon: AlertTriangle,
          ring: "ring-warning/30",
          bg: "bg-warning/10",
          color: "text-warning",
        };
      case "unsupported":
        return {
          icon: AlertTriangle,
          ring: "ring-warning/30",
          bg: "bg-warning/10",
          color: "text-warning",
        };
      case "invalid":
      default:
        return {
          icon: XCircle,
          ring: "ring-destructive/30",
          bg: "bg-destructive/10",
          color: "text-destructive",
        };
    }
  }, [result.status]);

  const Icon = tone.icon;
  const isInvalid = result.status === "invalid";

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
            tone.bg,
            tone.ring,
            tone.color,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t(`importarCupom.result.status.${result.status}`)}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t(`importarCupom.result.statusDesc.${result.status}`)}
          </p>
        </div>
      </div>

      {!isInvalid && (
        <dl className="mt-4 grid gap-3 text-sm">
          {result.url && (
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.result.link")}
              </dt>
              <dd className="mt-0.5 break-all text-[13px] text-foreground">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-start gap-1.5 text-primary hover:underline"
                >
                  <span className="break-all">{result.url}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                </a>
              </dd>
            </div>
          )}
          {result.host && (
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.result.host")}
              </dt>
              <dd className="mt-0.5 break-all text-[13px] text-foreground">{result.host}</dd>
            </div>
          )}
          {result.accessKey && (
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.result.accessKey")}
              </dt>
              <dd className="mt-0.5 break-all font-mono text-[12px] text-foreground">
                {result.accessKey}
              </dd>
            </div>
          )}
          {result.uf && (
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.result.uf")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-foreground">{result.uf}</dd>
            </div>
          )}
        </dl>
      )}

      <p className="mt-4 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
        {isInvalid
          ? t("importarCupom.result.invalidHint")
          : t("importarCupom.result.itemsLater")}
      </p>
    </section>
  );
}

function NextStepCard() {
  const { t } = useTranslation("mercado");
  const items: Array<{ key: string; icon: typeof Sparkles }> = [
    { key: "readItems", icon: Sparkles },
    { key: "reviewProducts", icon: ListChecks },
    { key: "chooseList", icon: ListPlus },
    { key: "enrichHistory", icon: Receipt },
  ];
  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("importarCupom.nextStep.title")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.nextStep.description")}
          </p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map(({ key, icon: Icon }) => (
          <li
            key={key}
            className="flex items-start gap-2.5 rounded-2xl border border-border/50 bg-card-elevated p-3"
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/60">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <p className="min-w-0 text-[12.5px] leading-snug text-foreground md:text-[13px]">
              {t(`importarCupom.nextStep.items.${key}`)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
        {t("importarCupom.nextStep.disclaimer")}
      </p>
    </section>
  );
}

function DestinationCard() {
  const { t } = useTranslation("mercado");
  const listas = useMercadoListas();
  const preview = listas.slice(0, 4);
  const extra = Math.max(0, listas.length - preview.length);

  const options: Array<{ key: "optionNewList" | "optionExistingList" | "optionCart"; icon: typeof ListPlus }> = [
    { key: "optionNewList", icon: ListPlus },
    { key: "optionExistingList", icon: ListChecks },
    { key: "optionCart", icon: ShoppingCart },
  ];

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ListPlus className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("importarCupom.destination.title")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.destination.description")}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {options.map(({ key, icon: Icon }) => (
          <div
            key={key}
            aria-disabled="true"
            className="relative cursor-not-allowed select-none rounded-2xl border border-dashed border-border/60 bg-card-elevated p-3 opacity-90"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/60">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {t(`importarCupom.destination.${key}.title`)}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                  {t(`importarCupom.destination.${key}.desc`)}
                </p>
              </div>
            </div>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground ring-1 ring-border/60">
              <Lock className="h-3 w-3" />
              {t("importarCupom.destination.soonBadge")}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-card-elevated p-3">
        <p className="text-[12px] font-semibold text-foreground md:text-[13px]">
          {t("importarCupom.destination.existingListsTitle")}
        </p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {t("importarCupom.destination.existingListsHint")}
        </p>
        {preview.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t("importarCupom.destination.noListsHint")}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.map((l) => (
              <span
                key={l.id}
                aria-disabled="true"
                className="inline-flex max-w-full cursor-not-allowed items-center gap-1 truncate rounded-full border border-border/60 bg-card px-2.5 py-1 text-[12px] text-foreground opacity-90"
                title={l.name}
              >
                <ListChecks className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{l.name}</span>
              </span>
            ))}
            {extra > 0 && (
              <span className="inline-flex items-center rounded-full border border-border/60 bg-card px-2.5 py-1 text-[12px] text-muted-foreground">
                {t("importarCupom.destination.moreListsCount", { count: extra })}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
        {t("importarCupom.destination.nextStepReady")}
      </p>
    </section>
  );
}

function ConfidenceBadge({ value }: { value: CupomItemPreview["confianca"] }) {
  const { t } = useTranslation("mercado");
  const map: Record<CupomItemPreview["confianca"], { label: string; cls: string }> = {
    alta: {
      label: t("importarCupom.itemsPreview.confidence.high"),
      cls: "bg-success/15 text-success ring-success/30",
    },
    media: {
      label: t("importarCupom.itemsPreview.confidence.medium"),
      cls: "bg-warning/15 text-warning ring-warning/30",
    },
    baixa: {
      label: t("importarCupom.itemsPreview.confidence.low"),
      cls: "bg-destructive/10 text-destructive ring-destructive/30",
    },
  };
  const v = map[value];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1",
        v.cls,
      )}
    >
      {v.label}
    </span>
  );
}

function ItemsPreviewCard({
  initialText,
  items,
  setItems,
  result,
  setResult,
  onRetryFetch,
  retryLoading,
}: {
  initialText: string;
  items: CupomItemPreview[];
  setItems: React.Dispatch<React.SetStateAction<CupomItemPreview[]>>;
  result: CupomParseResult | null;
  setResult: React.Dispatch<React.SetStateAction<CupomParseResult | null>>;
  onRetryFetch?: () => void | Promise<void>;
  retryLoading?: boolean;
}) {
  const { t } = useTranslation("mercado");
  const [text, setText] = useState(initialText);

  function handleParse() {
    const r = parseCupomItemsFromText(text);
    setResult(r);
    setItems(r.items);
  }

  function updateItem(id: string, patch: Partial<CupomItemPreview>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function addManualItem() {
    const empty = makeEmptyCupomItem();
    setItems((prev) => [...prev, empty]);
    if (!result) setResult({ status: "parsed", items: [empty], warnings: [] });
  }


  function parseMaybeNumber(v: string): number | undefined {
    if (!v.trim()) return undefined;
    const n = Number.parseFloat(v.replace(",", "."));
    if (!Number.isFinite(n)) return undefined;
    return n;
  }

  const totalEstimado = useMemo(
    () =>
      items.reduce((acc, it) => {
        if (typeof it.valorTotal === "number" && Number.isFinite(it.valorTotal)) {
          return acc + it.valorTotal;
        }
        if (
          typeof it.valorUnitario === "number" &&
          Number.isFinite(it.valorUnitario)
        ) {
          return acc + it.valorUnitario * (it.quantidade || 1);
        }
        return acc;
      }, 0),
    [items],
  );
  const lowCount = useMemo(
    () => items.filter((it) => it.confianca === "baixa").length,
    [items],
  );

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ScanLine className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("importarCupom.itemsPreview.title")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.itemsPreview.description")}
          </p>
        </div>
      </div>

      <label className="mt-3 block text-[12px] font-medium text-foreground">
        {t("importarCupom.itemsPreview.textareaLabel")}
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("importarCupom.itemsPreview.textareaPlaceholder")}
        rows={5}
        className="mt-1.5 block w-full resize-y rounded-2xl border border-border bg-card-elevated px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={handleParse}
          disabled={!text.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ScanLine className="h-4 w-4" />
          {t("importarCupom.itemsPreview.parseButton")}
        </button>
        <button
          type="button"
          onClick={addManualItem}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98]"
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          {t("importarCupom.itemsPreview.addManualItem")}
        </button>
      </div>

      {result === null && (
        <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-card-elevated p-4 text-center">
          <p className="text-sm font-semibold text-foreground">
            {t("importarCupom.itemsPreview.emptyTitle")}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.itemsPreview.emptyDescription")}
          </p>
        </div>
      )}

      {result && result.status === "empty" && (
        <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-card-elevated p-4 text-center">
          <p className="text-sm font-semibold text-foreground">
            {t("importarCupom.itemsPreview.emptyTitle")}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.itemsPreview.emptyDescription")}
          </p>
        </div>
      )}

      {result && result.status === "no_items" && items.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-warning/40 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">
            {t("importarCupom.itemsPreview.noItemsTitle")}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.itemsPreview.noItemsDescription")}
          </p>
        </div>
      )}

      {result &&
        (result.status === "receipt_url_detected" ||
          result.status === "receipt_url_no_items") &&
        items.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-warning/40 bg-warning/5 p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("importarCupom.receiptUrl.title")}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
              {t("importarCupom.receiptUrl.description")}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={addManualItem}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                {t("importarCupom.receiptUrl.addManual")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onRetryFetch) void onRetryFetch();
                  else handleParse();
                }}
                disabled={retryLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4 text-muted-foreground", retryLoading && "animate-spin")} />
                {t("importarCupom.receiptUrl.retry")}
              </button>
            </div>
          </div>
        )}

      {items.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("importarCupom.itemsPreview.foundTitle")}
            </h3>
          </div>

          <ul className="mt-3 grid gap-3">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-2xl border border-border/60 bg-card-elevated p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <ConfidenceBadge value={it.confianca} />
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    aria-label={t("importarCupom.itemsPreview.removeItem")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground transition hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("importarCupom.itemsPreview.fields.name")}
                    </span>
                    <input
                      type="text"
                      value={it.nome}
                      onChange={(e) => updateItem(it.id, { nome: e.target.value })}
                      className="mt-1 block w-full min-w-0 truncate rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("importarCupom.itemsPreview.fields.quantity")}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={String(it.quantidade ?? "")}
                        onChange={(e) =>
                          updateItem(it.id, {
                            quantidade: parseMaybeNumber(e.target.value) ?? 1,
                          })
                        }
                        className="mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("importarCupom.itemsPreview.fields.unit")}
                      </span>
                      <input
                        type="text"
                        value={it.unidade ?? ""}
                        onChange={(e) =>
                          updateItem(it.id, {
                            unidade: e.target.value.trim() || undefined,
                          })
                        }
                        className="mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                      />
                    </label>
                  </div>

                  <label className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("importarCupom.itemsPreview.fields.unitPrice")}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={
                        typeof it.valorUnitario === "number" ? String(it.valorUnitario) : ""
                      }
                      onChange={(e) =>
                        updateItem(it.id, {
                          valorUnitario: parseMaybeNumber(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("importarCupom.itemsPreview.fields.totalPrice")}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={
                        typeof it.valorTotal === "number" ? String(it.valorTotal) : ""
                      }
                      onChange={(e) =>
                        updateItem(it.id, {
                          valorTotal: parseMaybeNumber(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>

                  <label className="min-w-0 md:col-span-2">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("importarCupom.itemsPreview.fields.barcode")}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={it.codigoBarras ?? ""}
                      onChange={(e) =>
                        updateItem(it.id, {
                          codigoBarras: e.target.value.replace(/\D/g, "") || undefined,
                        })
                      }
                      className="mt-1 block w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-2xl border border-border/60 bg-card-elevated p-3">
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("importarCupom.itemsPreview.summary.items")}
                </p>
                <p className="mt-0.5 text-base font-semibold text-foreground tabular-nums">
                  {items.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("importarCupom.itemsPreview.summary.total")}
                </p>
                <p className="mt-0.5 text-base font-semibold text-foreground tabular-nums">
                  {formatBRL(totalEstimado)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("importarCupom.itemsPreview.summary.lowConfidence")}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-base font-semibold tabular-nums",
                    lowCount > 0 ? "text-warning" : "text-foreground",
                  )}
                >
                  {lowCount}
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{t("importarCupom.itemsPreview.summary.reviewWarning")}</span>
            </p>
          </div>
        </>
      )}
    </section>
  );
}



const LISTA_TIPOS: ListaTipo[] = [
  "compraMes",
  "reposicao",
  "farmacia",
  "churrasco",
  "outros",
];

function sanitizeItemsForImport(items: CupomItemPreview[]): Array<{
  nome: string;
  quantidade: number;
  unidade?: string;
  precoEstimado?: number;
  codigoBarras?: string;
}> {
  return items
    .map((it) => {
      const nome = (it.nome ?? "").trim();
      if (!nome) return null;
      const q =
        typeof it.quantidade === "number" &&
        Number.isFinite(it.quantidade) &&
        it.quantidade > 0
          ? it.quantidade
          : 1;
      const preco =
        typeof it.valorUnitario === "number" &&
        Number.isFinite(it.valorUnitario) &&
        it.valorUnitario > 0
          ? it.valorUnitario
          : undefined;
      const barcode =
        typeof it.codigoBarras === "string"
          ? it.codigoBarras.replace(/\D/g, "")
          : "";
      return {
        nome,
        quantidade: q,
        unidade: it.unidade?.trim() || undefined,
        precoEstimado: preco,
        codigoBarras: barcode || undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// E34: Local timezone "YYYY-MM-DD" (avoid UTC drift in pre-filled date input).
function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ImportActionsCard({ items }: { items: CupomItemPreview[] }) {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const listas = useMercadoListas();

  type Mode = "none" | "new" | "existing" | "cart" | "finish";
  type CartSub = "none" | "quick" | "existing";

  const [mode, setMode] = useState<Mode>("none");
  const [cartSub, setCartSub] = useState<CartSub>("none");
  const [listName, setListName] = useState("");
  const [tipo, setTipo] = useState<ListaTipo>("compraMes");
  const [estimateText, setEstimateText] = useState("");
  const [observation, setObservation] = useState("");
  const [selectedListaId, setSelectedListaId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // E34 finish-purchase form state
  const [finishName, setFinishName] = useState("");
  const [finishMarket, setFinishMarket] = useState("");
  const [finishDate, setFinishDate] = useState(() => todayLocalISODate());
  const [finishObs, setFinishObs] = useState("");


  const validItems = useMemo(() => sanitizeItemsForImport(items), [items]);
  const hasValid = validItems.length > 0;

  function resetForm() {
    setMode("none");
    setCartSub("none");
    setListName("");
    setTipo("compraMes");
    setEstimateText("");
    setObservation("");
    setSelectedListaId(null);
    setFinishName("");
    setFinishMarket("");
    setFinishDate(todayLocalISODate());
    setFinishObs("");
  }


  function openNew() {
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    setMode("new");
    setListName(t("importarCupom.importActions.defaultListName"));
  }

  function openExisting() {
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    setMode("existing");
    setSelectedListaId(null);
  }

  function openCart() {
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    setMode("cart");
    setCartSub("none");
    setListName(t("importarCupom.importActions.defaultCartListName"));
    setSelectedListaId(null);
  }

  function parseEstimate(): number | undefined {
    const v = estimateText.trim();
    if (!v) return undefined;
    const n = Number.parseFloat(v.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  }

  function confirmCreate() {
    if (submitting) return;
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    const name = listName.trim() || t("importarCupom.importActions.defaultListName");
    setSubmitting(true);
    try {
      const lista = addLista({
        name,
        tipo,
        estimate: parseEstimate(),
        observation: observation.trim() || undefined,
      });
      addItensLista(
        lista.id,
        validItems.map((it) => ({ ...it, origem: "cupom" as const })),
      );
      toast.success(t("importarCupom.importActions.createdSuccess"));
      resetForm();
      void navigate({ to: "/mercado/listas/$id", params: { id: lista.id } });
    } finally {
      setSubmitting(false);
    }
  }

  function confirmExisting() {
    if (submitting) return;
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    if (!selectedListaId) return;
    setSubmitting(true);
    try {
      addItensLista(
        selectedListaId,
        validItems.map((it) => ({ ...it, origem: "cupom" as const })),
      );
      toast.success(t("importarCupom.importActions.importedSuccess"));
      const id = selectedListaId;
      resetForm();
      void navigate({ to: "/mercado/listas/$id", params: { id } });
    } finally {
      setSubmitting(false);
    }
  }

  function confirmCreateCart() {
    if (submitting) return;
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    const name = listName.trim() || t("importarCupom.importActions.defaultCartListName");
    setSubmitting(true);
    try {
      const lista = addLista({
        name,
        tipo,
        estimate: parseEstimate(),
        observation: observation.trim() || undefined,
      });
      addItensLista(
        lista.id,
        validItems.map((it) => ({ ...it, origem: "cupom" as const })),
      );
      toast.success(t("importarCupom.importActions.cartCreatedSuccess"));
      const id = lista.id;
      resetForm();
      void navigate({ to: "/mercado/carrinho", search: { lista: id } });
    } finally {
      setSubmitting(false);
    }
  }

  function confirmExistingCart() {
    if (submitting) return;
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    if (!selectedListaId) return;
    setSubmitting(true);
    try {
      addItensLista(
        selectedListaId,
        validItems.map((it) => ({ ...it, origem: "cupom" as const })),
      );
      toast.success(t("importarCupom.importActions.cartImportedSuccess"));
      const id = selectedListaId;
      resetForm();
      void navigate({ to: "/mercado/carrinho", search: { lista: id } });
    } finally {
      setSubmitting(false);
    }
  }


  function openFinish() {
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    setMode("finish");
    setFinishName(t("importarCupom.importActions.finishPurchase.defaultPurchaseName"));
    setFinishMarket("");
    setFinishDate(todayLocalISODate());
    setFinishObs("");
  }

  function confirmFinish() {
    if (submitting) return;
    if (!hasValid) {
      toast.error(t("importarCupom.importActions.noValidItems"));
      return;
    }
    setSubmitting(true);
    try {
      const concluidaEm = (() => {
        const d = finishDate.trim();
        if (!d) return new Date().toISOString();
        const parsed = new Date(`${d}T12:00:00`);
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
      })();
      const entry = registrarCompraFinalizadaDoCupom({
        nome:
          finishName.trim() ||
          t("importarCupom.importActions.finishPurchase.defaultPurchaseName"),
        mercadoNome: finishMarket.trim() || undefined,
        concluidaEm,
        observacao: finishObs.trim() || undefined,
        itens: validItems.map((it) => ({ ...it, origem: "cupom" as const })),
      });
      if (!entry) {
        toast.error(t("importarCupom.importActions.noValidItems"));
        return;
      }
      toast.success(t("importarCupom.importActions.finishPurchase.success"));
      resetForm();
      void navigate({ to: "/mercado/historico" });
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <ListPlus className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("importarCupom.importActions.title")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.importActions.description")}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">

        <button
          type="button"
          onClick={openNew}
          disabled={!hasValid}
          className={cn(
            "group flex min-h-11 items-start gap-2.5 rounded-2xl border p-3 text-left transition active:scale-[0.99]",
            mode === "new"
              ? "border-primary bg-primary/5"
              : "border-border/60 bg-card-elevated hover:bg-card",
            !hasValid && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-brand ring-1 ring-border/60">
            <ListPlus className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {t("importarCupom.importActions.createNewList")}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              {t("importarCupom.importActions.createNewListDesc")}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={openExisting}
          disabled={!hasValid}
          className={cn(
            "group flex min-h-11 items-start gap-2.5 rounded-2xl border p-3 text-left transition active:scale-[0.99]",
            mode === "existing"
              ? "border-primary bg-primary/5"
              : "border-border/60 bg-card-elevated hover:bg-card",
            !hasValid && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-brand ring-1 ring-border/60">
            <ListChecks className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {t("importarCupom.importActions.addToExistingList")}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              {t("importarCupom.importActions.addToExistingListDesc")}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={openCart}
          disabled={!hasValid}
          className={cn(
            "group flex min-h-11 items-start gap-2.5 rounded-2xl border p-3 text-left transition active:scale-[0.99]",
            mode === "cart"
              ? "border-primary bg-primary/5"
              : "border-border/60 bg-card-elevated hover:bg-card",
            !hasValid && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-brand ring-1 ring-border/60">
            <ShoppingCart className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {t("importarCupom.importActions.cartTitle")}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              {t("importarCupom.importActions.cartCardDesc")}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={openFinish}
          disabled={!hasValid}
          className={cn(
            "group flex min-h-11 items-start gap-2.5 rounded-2xl border p-3 text-left transition active:scale-[0.99]",
            mode === "finish"
              ? "border-primary bg-primary/5"
              : "border-border/60 bg-card-elevated hover:bg-card",
            !hasValid && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-brand ring-1 ring-border/60">
            <Receipt className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {t("importarCupom.importActions.finishPurchase.cardTitle")}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              {t("importarCupom.importActions.finishPurchase.cardDesc")}
            </span>
          </span>
        </button>
      </div>



      {!hasValid && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{t("importarCupom.importActions.noValidItemsHint")}</span>
        </p>
      )}

      {mode === "new" && hasValid && (
        <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3 md:p-4">
          <label className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("importarCupom.importActions.listName")}
            </span>
            <input
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder={t("importarCupom.importActions.listNamePlaceholder")}
              className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.importActions.tipo")}
              </span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as ListaTipo)}
                className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {LISTA_TIPOS.map((tp) => (
                  <option key={tp} value={tp}>
                    {t(`importarCupom.importActions.tipoOptions.${tp}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.importActions.estimate")}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={estimateText}
                onChange={(e) => setEstimateText(e.target.value)}
                placeholder={t("importarCupom.importActions.estimatePlaceholder")}
                className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          </div>

          <label className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("importarCupom.importActions.observation")}
            </span>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder={t("importarCupom.importActions.observationPlaceholder")}
              rows={2}
              className="mt-1 block w-full min-w-0 resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <p className="text-[12px] text-muted-foreground">
            {t("importarCupom.importActions.itemsCount", { count: validItems.length })}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={confirmCreate}
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {t("importarCupom.importActions.confirmCreate")}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
            >
              {t("importarCupom.importActions.cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "existing" && hasValid && (
        <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3 md:p-4">
          {listas.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {t("importarCupom.importActions.noLists")}
            </p>
          ) : (
            <>
              <p className="text-[12px] font-semibold text-foreground">
                {t("importarCupom.importActions.chooseList")}
              </p>
              <ul className="grid gap-2 md:grid-cols-2">
                {listas.map((l) => {
                  const sel = selectedListaId === l.id;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedListaId(l.id)}
                        className={cn(
                          "flex w-full min-h-11 items-start gap-2 rounded-xl border p-3 text-left transition",
                          sel
                            ? "border-primary bg-primary/5"
                            : "border-border/60 bg-card hover:bg-card-elevated",
                        )}
                      >
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-card-elevated text-muted-foreground ring-1 ring-border/60">
                          <ListChecks className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {l.name || t("importarCupom.importActions.unnamedList")}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                            {t(`importarCupom.importActions.tipoOptions.${l.tipo}`)}
                            {" · "}
                            {t("importarCupom.importActions.itemsCount", {
                              count: l.entries.length,
                            })}
                            {typeof l.estimate === "number" && (
                              <>
                                {" · "}
                                <span className="tabular-nums">{formatBRL(l.estimate)}</span>
                              </>
                            )}
                          </span>
                        </span>
                        {sel && (
                          <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {selectedListaId && (
                <p className="text-[12px] text-muted-foreground">
                  {t("importarCupom.importActions.itemsCount", { count: validItems.length })}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={confirmExisting}
                  disabled={submitting || !selectedListaId}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {t("importarCupom.importActions.confirmExisting")}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
                >
                  {t("importarCupom.importActions.cancel")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "cart" && hasValid && (
        <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3 md:p-4">
          <div>
            <p className="text-[12px] font-semibold text-foreground">
              {t("importarCupom.importActions.cartChooseOption")}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t("importarCupom.importActions.cartHint")}
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setCartSub("quick")}
              className={cn(
                "flex min-h-11 items-start gap-2.5 rounded-xl border p-3 text-left transition active:scale-[0.99]",
                cartSub === "quick"
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-card hover:bg-card-elevated",
              )}
            >
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card-elevated text-brand ring-1 ring-border/60">
                <ShoppingCart className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {t("importarCupom.importActions.cartOptionQuickTitle")}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                  {t("importarCupom.importActions.cartOptionQuickDesc")}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCartSub("existing")}
              className={cn(
                "flex min-h-11 items-start gap-2.5 rounded-xl border p-3 text-left transition active:scale-[0.99]",
                cartSub === "existing"
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-card hover:bg-card-elevated",
              )}
            >
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card-elevated text-brand ring-1 ring-border/60">
                <ListChecks className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {t("importarCupom.importActions.cartOptionExistingTitle")}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                  {t("importarCupom.importActions.cartOptionExistingDesc")}
                </span>
              </span>
            </button>
          </div>

          {cartSub === "quick" && (
            <div className="grid gap-3 rounded-xl border border-border/60 bg-card p-3 md:p-4">
              <label className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("importarCupom.importActions.listName")}
                </span>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder={t("importarCupom.importActions.listNamePlaceholder")}
                  className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("importarCupom.importActions.tipo")}
                  </span>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as ListaTipo)}
                    className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    {LISTA_TIPOS.map((tp) => (
                      <option key={tp} value={tp}>
                        {t(`importarCupom.importActions.tipoOptions.${tp}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("importarCupom.importActions.estimate")}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={estimateText}
                    onChange={(e) => setEstimateText(e.target.value)}
                    placeholder={t("importarCupom.importActions.estimatePlaceholder")}
                    className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </label>
              </div>

              <label className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("importarCupom.importActions.observation")}
                </span>
                <textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder={t("importarCupom.importActions.observationPlaceholder")}
                  rows={2}
                  className="mt-1 block w-full min-w-0 resize-y rounded-xl border border-border bg-card-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>

              <p className="text-[12px] text-muted-foreground">
                {t("importarCupom.importActions.itemsCount", { count: validItems.length })}
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={confirmCreateCart}
                  disabled={submitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {t("importarCupom.importActions.confirmCreateCart")}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
                >
                  {t("importarCupom.importActions.cancel")}
                </button>
              </div>
            </div>
          )}

          {cartSub === "existing" && (
            <div className="grid gap-3 rounded-xl border border-border/60 bg-card p-3 md:p-4">
              {listas.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  {t("importarCupom.importActions.cartNoListsHint")}
                </p>
              ) : (
                <>
                  <p className="text-[12px] font-semibold text-foreground">
                    {t("importarCupom.importActions.chooseList")}
                  </p>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {listas.map((l) => {
                      const sel = selectedListaId === l.id;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedListaId(l.id)}
                            className={cn(
                              "flex w-full min-h-11 items-start gap-2 rounded-xl border p-3 text-left transition",
                              sel
                                ? "border-primary bg-primary/5"
                                : "border-border/60 bg-card-elevated hover:bg-card",
                            )}
                          >
                            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/60">
                              <ListChecks className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-foreground">
                                {l.name || t("importarCupom.importActions.unnamedList")}
                              </span>
                              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                                {t(`importarCupom.importActions.tipoOptions.${l.tipo}`)}
                                {" · "}
                                {t("importarCupom.importActions.itemsCount", {
                                  count: l.entries.length,
                                })}
                                {typeof l.estimate === "number" && (
                                  <>
                                    {" · "}
                                    <span className="tabular-nums">{formatBRL(l.estimate)}</span>
                                  </>
                                )}
                              </span>
                            </span>
                            {sel && (
                              <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {selectedListaId && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("importarCupom.importActions.itemsCount", { count: validItems.length })}
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={confirmExistingCart}
                      disabled={submitting || !selectedListaId}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {t("importarCupom.importActions.confirmExistingCart")}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
                    >
                      {t("importarCupom.importActions.cancel")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "finish" && hasValid && (
        <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-card-elevated p-3 md:p-4">
          <div>
            <p className="text-[12px] font-semibold text-foreground">
              {t("importarCupom.importActions.finishPurchase.formTitle")}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t("importarCupom.importActions.finishPurchase.noExpenseNotice")}
            </p>
          </div>

          <label className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("importarCupom.importActions.finishPurchase.purchaseName")}
            </span>
            <input
              type="text"
              value={finishName}
              onChange={(e) => setFinishName(e.target.value)}
              placeholder={t("importarCupom.importActions.finishPurchase.purchaseNamePlaceholder")}
              className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.importActions.finishPurchase.market")}
              </span>
              <input
                type="text"
                value={finishMarket}
                onChange={(e) => setFinishMarket(e.target.value)}
                placeholder={t("importarCupom.importActions.finishPurchase.marketPlaceholder")}
                className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              <SavedMarketsChips
                label={t("importarCupom.importActions.finishPurchase.market")}
                emptyHint={t("importarCupom.importActions.finishPurchase.marketPlaceholder")}
                selected={finishMarket}
                onSelect={(nome) => setFinishMarket(nome)}
              />
            </label>

            <label className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("importarCupom.importActions.finishPurchase.date")}
              </span>
              <input
                type="date"
                value={finishDate}
                onChange={(e) => setFinishDate(e.target.value)}
                className="mt-1 block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          </div>

          <label className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("importarCupom.importActions.finishPurchase.observation")}
            </span>
            <textarea
              value={finishObs}
              onChange={(e) => setFinishObs(e.target.value)}
              placeholder={t("importarCupom.importActions.finishPurchase.observationPlaceholder")}
              rows={2}
              className="mt-1 block w-full min-w-0 resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <p className="text-[12px] text-muted-foreground">
            {t("importarCupom.importActions.itemsCount", { count: validItems.length })}
            {" · "}
            <span className="tabular-nums">
              {formatBRL(
                validItems.reduce(
                  (acc, it) => acc + (it.precoEstimado ?? 0) * (it.quantidade || 1),
                  0,
                ),
              )}
            </span>
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={confirmFinish}
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Receipt className="h-4 w-4" />
              {t("importarCupom.importActions.finishPurchase.confirm")}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
            >
              {t("importarCupom.importActions.finishPurchase.cancel")}
            </button>
          </div>
        </div>
      )}


      <p className="mt-3 flex items-start gap-2 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <span>{t("importarCupom.importActions.reviewWarning")}</span>
      </p>
    </section>
  );
}



function NfceFetchCard({
  loading,
  result,
  onFetch,
}: {
  loading: boolean;
  result: NfceFetchResult | null;
  onFetch: () => void | Promise<void>;
}) {
  const { t } = useTranslation("mercado");

  return (
    <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground md:text-base">
            {t("importarCupom.nfceFetch.title")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
            {t("importarCupom.nfceFetch.description")}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void onFetch()}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("importarCupom.nfceFetch.loading")}
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              {result ? t("importarCupom.nfceFetch.retry") : t("importarCupom.nfceFetch.primary")}
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="mt-3 grid gap-2 rounded-2xl border border-border/60 bg-card-elevated p-3">
          <p className="text-[12.5px] text-foreground md:text-[13px]">
            {t(`importarCupom.nfceFetch.status.${result.status}`)}
          </p>
          {(result.marketName || result.cnpj || result.dateISO) && (
            <dl className="grid gap-1 text-[12px] text-muted-foreground">
              {result.marketName && (
                <div className="truncate">
                  <span className="font-semibold text-foreground">
                    {t("importarCupom.nfceFetch.market")}:{" "}
                  </span>
                  {result.marketName}
                </div>
              )}
              {result.cnpj && (
                <div className="truncate">
                  <span className="font-semibold text-foreground">
                    {t("importarCupom.nfceFetch.cnpj")}:{" "}
                  </span>
                  {result.cnpj}
                </div>
              )}
              {result.dateISO && (
                <div>
                  <span className="font-semibold text-foreground">
                    {t("importarCupom.nfceFetch.date")}:{" "}
                  </span>
                  {result.dateISO}
                </div>
              )}
            </dl>
          )}
          {typeof result.totalDeclared === "number" && (
            <div className="text-[12.5px] text-foreground">
              <span className="font-semibold">
                {t("importarCupom.nfceFetch.totalDeclared")}:{" "}
              </span>
              <span className="tabular-nums">{formatBRL(result.totalDeclared)}</span>
            </div>
          )}
          {result.items.length > 0 && (
            <div className="text-[12.5px] text-foreground">
              <span className="font-semibold">
                {t("importarCupom.nfceFetch.itemsRead")}:{" "}
              </span>
              {result.items.length}
            </div>
          )}
          {result.warnings.includes("total_mismatch") && (
            <p className="flex items-start gap-2 text-[12px] text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("importarCupom.nfceFetch.totalMismatch")}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}




function ImportarCupomPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const [manual, setManual] = useState("");
  const [parsed, setParsed] = useState<ParsedNfceQrResult | null>(null);
  const [previewResult, setPreviewResult] = useState<CupomParseResult | null>(null);
  const [previewItems, setPreviewItems] = useState<CupomItemPreview[]>([]);
  const [nfceLoading, setNfceLoading] = useState(false);
  const [nfceResult, setNfceResult] = useState<NfceFetchResult | null>(null);
  const fetchNfce = useServerFn(fetchNfceFromUrl);

  function handleBack() {
    void navigate({ to: "/mercado", replace: true });
  }

  function handleDetected(content: string) {
    setManual(content);
    setParsed(parseNfceQrContent(content));
  }

  function handleManualParse() {
    if (!manual.trim()) return;
    setParsed(parseNfceQrContent(manual));
  }

  function handleReset() {
    setManual("");
    setParsed(null);
    setPreviewResult(null);
    setPreviewItems([]);
    setNfceResult(null);
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setManual(text);
        setParsed(parseNfceQrContent(text));
      }
    } catch {
      /* permissão negada — ignore */
    }
  }

  function handleNfceFetched(r: NfceFetchResult) {
    if (r.items.length > 0) {
      setPreviewItems(r.items);
      setPreviewResult({
        status: "parsed",
        items: r.items,
        warnings: r.warnings,
      });
    } else if (r.status === "total_only" || r.status === "link_no_items" || r.status === "protected") {
      setPreviewResult({
        status: "receipt_url_no_items",
        items: [],
        warnings: r.warnings,
      });
    }
  }

  async function handleFetchReceipt() {
    if (!parsed?.url || nfceLoading) return;
    setNfceLoading(true);
    try {
      const r = await fetchNfce({ data: { url: parsed.url } });
      setNfceResult(r);
      handleNfceFetched(r);
      if (r.status === "items_found") {
        toast.success(t("importarCupom.nfceFetch.toast.imported", { count: r.items.length }));
      } else if (r.status === "total_only") {
        toast.message(t("importarCupom.nfceFetch.toast.totalOnly"));
      } else if (r.status === "protected") {
        toast.error(t("importarCupom.nfceFetch.toast.protected"));
      } else if (r.status === "invalid_url") {
        toast.error(t("importarCupom.nfceFetch.toast.invalidUrl"));
      } else if (r.status === "timeout" || r.status === "network_error") {
        toast.error(t("importarCupom.nfceFetch.toast.network"));
      } else if (r.status === "http_error") {
        toast.error(t("importarCupom.nfceFetch.toast.httpError", { status: r.httpStatus ?? "?" }));
      } else {
        toast.message(t("importarCupom.nfceFetch.toast.noItems"));
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[nfce-fetch] client error", err);
      toast.error(t("importarCupom.nfceFetch.toast.fail"));
    } finally {
      setNfceLoading(false);
    }
  }




  return (
    <MobileShell wide>
      <header className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-3 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-card-elevated"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t("importarCupom.back")}</span>
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/app" })}
          className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-3 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-card-elevated"
        >
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">{t("importarCupom.home")}</span>
        </button>
      </header>

      <div className="mt-4">
        <MercadoBanner
          title={t("receiptImportV2.banner.title")}
          subtitle={t("receiptImportV2.banner.subtitle")}
          imageSrc={bannerOrcamento}
          imageSrcWebp={bannerOrcamentoWebp}
          tone="community"
        />
      </div>

      <SectionBlock title={t("receiptImportV2.steps.title")} className="mt-5">
        <ol className="grid gap-2 md:grid-cols-3">
          {(["scan", "review", "save"] as const).map((step, idx) => (
            <li
              key={step}
              className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card md:p-4"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-sm font-bold text-brand ring-1 ring-border/60">
                {idx + 1}
              </span>
              <p className="text-[13px] leading-snug text-foreground md:text-sm">
                {t(`receiptImportV2.steps.${step}`)}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-card-elevated p-3 text-[12px] leading-snug text-muted-foreground md:text-[13px]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>{t("receiptImportV2.disclaimer")}</span>
        </p>
      </SectionBlock>


      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card-elevated text-brand ring-1 ring-border/60">
            <Info className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm leading-snug text-foreground md:text-[15px]">
              {t("importarCupom.preparingNotice")}
            </p>
            <p className="text-[12px] text-muted-foreground md:text-xs">
              {t("importarCupom.futureNote")}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <h2 className="text-sm font-semibold text-foreground md:text-base">
          {t("importarCupom.scanner.title")}
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
          {t("importarCupom.scanner.description")}
        </p>
        <div className="mt-3">
          <QrCodeScannerButton onDetected={handleDetected} />
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-card md:p-5">
        <h2 className="text-sm font-semibold text-foreground md:text-base">
          {t("importarCupom.manual.title")}
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground md:text-[13px]">
          {t("importarCupom.manual.description")}
        </p>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={t("importarCupom.manual.placeholder")}
          rows={3}
          className="mt-3 block w-full resize-y rounded-2xl border border-border bg-card-elevated px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={handleManualParse}
            disabled={!manual.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {t("importarCupom.manual.analyze")}
          </button>
          <button
            type="button"
            onClick={() => void handlePasteFromClipboard()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98]"
          >
            <ClipboardPaste className="h-4 w-4 text-muted-foreground" />
            {t("importarCupom.manual.paste")}
          </button>
          {(manual || parsed) && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" />
              {t("importarCupom.manual.reset")}
            </button>
          )}
        </div>
      </section>

      {parsed && <ResultCard result={parsed} />}

      {parsed?.url &&
        (parsed.status === "valid_nfce_url" ||
          parsed.status === "possible_nfce_url") && (
          <NfceFetchCard
            loading={nfceLoading}
            result={nfceResult}
            onFetch={handleFetchReceipt}
          />
        )}


      {(parsed || manual.trim().length > 0) && (
        <ItemsPreviewCard
          initialText={manual}
          items={previewItems}
          setItems={setPreviewItems}
          result={previewResult}
          setResult={setPreviewResult}
          onRetryFetch={parsed?.url ? handleFetchReceipt : undefined}
          retryLoading={nfceLoading}
        />
      )}

      {parsed &&
        (parsed.status === "valid_nfce_url" ||
          parsed.status === "possible_nfce_url") && (
          <>
            <NextStepCard />
            {previewItems.length > 0 ? (
              <ImportActionsCard items={previewItems} />
            ) : (
              <DestinationCard />
            )}
          </>
        )}


      <section className="mt-4 rounded-3xl border border-border/60 bg-card-elevated p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-border/60">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {t("importarCupom.privacy.title")}
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-muted-foreground md:text-[13px]">
              <li>{t("importarCupom.privacy.local")}</li>
              <li>{t("importarCupom.privacy.nothingSaved")}</li>
              <li>{t("importarCupom.privacy.reviewLater")}</li>
            </ul>
          </div>
        </div>
      </section>
    </MobileShell>
  );
}

