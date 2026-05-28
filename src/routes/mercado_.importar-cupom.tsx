import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { QrCodeScannerButton } from "@/components/mercado/QrCodeScannerButton";
import {
  parseNfceQrContent,
  type ParsedNfceQrResult,
} from "@/lib/mercado/nfce-parser";
import { useMercadoListas } from "@/lib/mercado/listas-store";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/mercado_/importar-cupom")({
  head: () => ({
    meta: [
      { title: i18n.t("mercado:meta.importarCupomTitle", { lng: i18n.language }) },
    ],
  }),
  component: ImportarCupomPage,
});

function ImportarCupomPage() {
  const { t } = useTranslation("mercado");
  const navigate = useNavigate();
  const [manual, setManual] = useState("");
  const [parsed, setParsed] = useState<ParsedNfceQrResult | null>(null);

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/mercado" });
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

      <section className="mt-5 flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-border/60">
          <Receipt className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {t("importarCupom.title")}
          </h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground md:text-base">
            {t("importarCupom.subtitle")}
          </p>
        </div>
      </section>

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

      {parsed &&
        (parsed.status === "valid_nfce_url" ||
          parsed.status === "possible_nfce_url") && (
          <>
            <NextStepCard />
            <DestinationCard />
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
    </section>
  );
}
