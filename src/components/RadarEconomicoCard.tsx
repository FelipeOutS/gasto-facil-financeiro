import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRightLeft,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { getEconomicRadar } from "@/lib/radar.functions";

type Status = "atualizado" | "cache" | "desatualizado";

interface Indicator {
  key: string;
  name: string;
  value: number;
  valueBRL?: number;
  currency: string | null;
  source: string;
  variationPercent: number | null;
  high: number | null;
  low: number | null;
  fetchedAt: string;
  updatedAt?: string;
  status: Status;
}

interface RadarResult {
  indicators: Indicator[];
  status: Status;
  fetchedAt: string;
  updatedAt?: string;
  message?: string;
}

const CURRENCY_FLAG: Record<string, string> = {
  USD_BRL: "🇺🇸",
  EUR_BRL: "🇪🇺",
};

function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2).replace(".", ",")}%`;
}

function useFormatHora() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "pt-BR";
  return (iso: string): string => {
    try {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime()) || d.getTime() === 0) return "—";
      return d.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };
}

function VariationBadge({ pct }: { pct: number | null }) {
  const { t } = useTranslation("dashboard");
  if (pct === null || !Number.isFinite(pct)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />—
      </span>
    );
  }
  const positivo = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        positivo
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive",
      )}
      title={positivo ? t("radarCard.variation.up") : t("radarCard.variation.down")}
    >
      {positivo ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {formatPct(pct)}
    </span>
  );
}

/**
 * Card do Radar Econômico para o dashboard. Mostra USD e EUR com variação
 * do dia e abre um modal com detalhes + conversor rápido.
 */
export function RadarEconomicoCard({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const fetchRadar = useServerFn(getEconomicRadar);
  const formatHora = useFormatHora();
  const [data, setData] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchRadar()
      .then((r) => {
        if (mounted) setData(r as RadarResult);
      })
      .catch(() => {
        if (mounted)
          setData({
            indicators: [],
            status: "desatualizado",
            fetchedAt: new Date(0).toISOString(),
            message: t("radarCard.loadError"),
          });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [fetchRadar, t]);

  const usd = data?.indicators.find((i) => i.key === "USD_BRL");
  const eur = data?.indicators.find((i) => i.key === "EUR_BRL");
  const usdValue = usd?.valueBRL ?? usd?.value;
  const eurValue = eur?.valueBRL ?? eur?.value;
  const hasCurrencyValues =
    Number.isFinite(usdValue) && Number.isFinite(eurValue);
  const stale =
    !loading && (!hasCurrencyValues || usd?.status === "desatualizado" || eur?.status === "desatualizado");

  const impactoMsg = (): string => {
    const u = usd?.variationPercent ?? 0;
    const e = eur?.variationPercent ?? 0;
    if (u > 0.2) return t("radarCard.msg.usdUp");
    if (u < -0.2) return t("radarCard.msg.usdDown");
    if (e > 0.2) return t("radarCard.msg.eurUp");
    if (e < -0.2) return t("radarCard.msg.eurDown");
    return t("radarCard.msg.stable");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring",
          className,
        )}
        aria-label={t("radarCard.aria")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
                <ArrowRightLeft className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold">{t("radarCard.title")}</h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("radarCard.subtitle")}
            </p>
          </div>
          {stale && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
            title={t("radarCard.outdatedTitle")}
          >
            <AlertCircle className="h-3 w-3" /> {t("radarCard.outdated")}
          </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          {loading ? (
            <>
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </>
          ) : (
            <>
              <CotacaoMini ind={usd} fallbackKey="USD_BRL" />
              <CotacaoMini ind={eur} fallbackKey="EUR_BRL" />
            </>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground sm:mt-auto sm:pt-3">
          {loading
            ? t("radarCard.loading")
            : stale
              ? t("radarCard.outdatedDesc")
              : impactoMsg()}
        </p>

        {!loading && data && data.indicators.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("radarCard.updatedAt", { quando: formatHora(data.fetchedAt) })}
          </p>
        )}
      </button>

      <RadarDetalhesDialog
        open={open}
        onOpenChange={setOpen}
        data={data}
        loading={loading}
        onRefresh={async () => {
          setLoading(true);
          try {
            const r = await fetchRadar();
            setData(r as RadarResult);
          } finally {
            setLoading(false);
          }
        }}
      />
    </>
  );
}

function CotacaoMini({
  ind,
  fallbackKey,
}: {
  ind: Indicator | undefined;
  fallbackKey: string;
}) {
  const { t } = useTranslation("dashboard");
  const key = ind?.key ?? fallbackKey;
  const label = t(`radarCard.label.${key}`, { defaultValue: key });
  const flag = CURRENCY_FLAG[key] ?? "💱";
  const value = ind?.valueBRL ?? ind?.value;
  return (
    <div className="rounded-xl border bg-background/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {flag} {label}
        </span>
        <VariationBadge pct={ind?.variationPercent ?? null} />
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value !== undefined && Number.isFinite(value) ? formatBRL(value) : "—"}
      </div>
    </div>
  );
}

/** Modal de detalhes do Radar com conversor rápido. */
export function RadarDetalhesDialog({
  open,
  onOpenChange,
  data,
  loading,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: RadarResult | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation("dashboard");
  const formatHora = useFormatHora();
  const usd = data?.indicators.find((i) => i.key === "USD_BRL");
  const eur = data?.indicators.find((i) => i.key === "EUR_BRL");
  const usdValue = usd?.valueBRL ?? usd?.value;
  const eurValue = eur?.valueBRL ?? eur?.value;
  const stale =
    !loading &&
    (!Number.isFinite(usdValue) ||
      !Number.isFinite(eurValue) ||
      usd?.status === "desatualizado" ||
      eur?.status === "desatualizado");

  const [moeda, setMoeda] = useState<"USD_BRL" | "EUR_BRL">("USD_BRL");
  const [valor, setValor] = useState<string>("100");
  const [convertido, setConvertido] = useState<{
    brl: number;
    cotacao: number;
    quando: string;
    moeda: string;
  } | null>(null);

  const cotacaoAtual = moeda === "USD_BRL" ? usd : eur;

  const handleConverter = () => {
    if (!cotacaoAtual) return;
    const n = parseBRLInput(valor);
    if (!Number.isFinite(n) || n <= 0) return;
    setConvertido({
      brl: n * cotacaoAtual.value,
      cotacao: cotacaoAtual.value,
      quando: cotacaoAtual.fetchedAt,
      moeda: t(`radarCard.label.${cotacaoAtual.key}`, { defaultValue: cotacaoAtual.key }),
    });
  };

  useEffect(() => {
    setConvertido(null);
  }, [moeda, valor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            {t("radarCard.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("radarCard.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        {stale && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            {t("radarCard.dialog.outdated")}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <CotacaoDetalhe ind={usd} loading={loading} fallbackKey="USD_BRL" />
          <CotacaoDetalhe ind={eur} loading={loading} fallbackKey="EUR_BRL" />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data && data.indicators.length > 0
              ? t("radarCard.dialog.updatedAt", { quando: formatHora(data.fetchedAt) })
              : "—"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} />
            {t("radarCard.dialog.refresh")}
          </Button>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">{t("radarCard.dialog.converter")}</h4>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
            <div className="space-y-1">
              <Label className="text-xs">{t("radarCard.dialog.currency")}</Label>
              <Select value={moeda} onValueChange={(v) => setMoeda(v as typeof moeda)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD_BRL">{t("radarCard.dialog.usdItem")}</SelectItem>
                  <SelectItem value="EUR_BRL">{t("radarCard.dialog.eurItem")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="radar-valor">
                {t("radarCard.dialog.value")}
              </Label>
              <Input
                id="radar-valor"
                inputMode="decimal"
                placeholder="100"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={handleConverter}
                disabled={!cotacaoAtual || loading}
                className="h-9 w-full sm:w-auto"
              >
                {t("radarCard.dialog.convert")}
              </Button>
            </div>
          </div>

          {convertido && (
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">{t("radarCard.dialog.approxValue")}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatBRL(convertido.brl)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("radarCard.dialog.rateUsed", {
                  cotacao: formatBRL(convertido.cotacao),
                  moeda: convertido.moeda,
                  quando: formatHora(convertido.quando),
                })}
              </p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("radarCard.dialog.estimateNote")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CotacaoDetalhe({
  ind,
  loading,
  fallbackKey,
}: {
  ind: Indicator | undefined;
  loading: boolean;
  fallbackKey: string;
}) {
  const { t } = useTranslation("dashboard");
  const key = ind?.key ?? fallbackKey;
  const label = t(`radarCard.label.${key}`, { defaultValue: key });
  const flag = CURRENCY_FLAG[key] ?? "💱";
  const value = ind?.valueBRL ?? ind?.value;
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {flag} {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums">
              {value !== undefined && Number.isFinite(value) ? formatBRL(value) : "—"}
            </p>
          )}
        </div>
        <VariationBadge pct={ind?.variationPercent ?? null} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-2 py-1">
          <p className="text-muted-foreground">{t("radarCard.dialog.high")}</p>
          <p className="font-medium tabular-nums">
            {ind?.high != null ? formatBRL(ind.high) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1">
          <p className="text-muted-foreground">{t("radarCard.dialog.low")}</p>
          <p className="font-medium tabular-nums">
            {ind?.low != null ? formatBRL(ind.low) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
