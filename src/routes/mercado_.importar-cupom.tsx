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

