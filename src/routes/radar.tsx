import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation, Trans } from "react-i18next";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertCircle,
  DollarSign,
  Euro,
  Percent,
  LineChart,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { RadarDetalhesDialog } from "@/components/RadarEconomicoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { getEconomicRadar } from "@/lib/radar.functions";
import i18n from "@/i18n";

export const Route = createFileRoute("/radar")({
  head: () => {
    const t = i18n.getFixedT(i18n.language, "misc");
    return {
      meta: [
        { title: t("radar.metaTitle") },
        { name: "description", content: t("radar.metaDesc") },
        { property: "og:title", content: t("radar.ogTitle") },
        { property: "og:description", content: t("radar.ogDesc") },
      ],
    };
  },
  component: RadarPage,
});

type Status = "atualizado" | "cache" | "desatualizado";

interface Indicator {
  key: string;
  name: string;
  value: number;
  currency: string | null;
  source: string;
  variationPercent: number | null;
  high: number | null;
  low: number | null;
  fetchedAt: string;
  status: Status;
  referenceDate?: string | null;
  unit?: string | null;
}

interface RadarResult {
  indicators: Indicator[];
  status: Status;
  fetchedAt: string;
  message?: string;
}

function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits).replace(".", ",")}%`;
}

function formatHora(iso: string, lang: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()) || d.getTime() === 0) return "—";
    return d.toLocaleString(lang === "en" ? "en-US" : "pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatMesRef(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleDateString(lang === "en" ? "en-US" : "pt-BR", { month: "long", year: "numeric" });
  } catch {
    return null;
  }
}

function RadarPage() {
  const { t } = useTranslation("misc");
  const fetchRadar = useServerFn(getEconomicRadar);
  const [data, setData] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await fetchRadar();
      setData(r as RadarResult);
    } catch {
      setData({
        indicators: [],
        status: "desatualizado",
        fetchedAt: new Date(0).toISOString(),
        message: t("radar.errorMessage"),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byKey = (k: string) => data?.indicators.find((i) => i.key === k);
  const usd = byKey("USD_BRL");
  const eur = byKey("EUR_BRL");
  const selic = byKey("SELIC");
  const ipca = byKey("IPCA");
  const stale = data?.status === "desatualizado";

  return (
    <MobileShell>
      <header className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t("radar.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("radar.subtitle")}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void carregar()}
            disabled={loading}
            className="h-8 px-2 text-xs"
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} />
            {t("radar.refresh")}
          </Button>
        </div>
        {stale && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{data?.message ?? t("radar.staleFallback")}</span>
          </div>
        )}
      </header>

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <IndicadorCard
          loading={loading}
          ind={selic}
          titulo={t("radar.selic.title")}
          icone={<Percent className="h-4 w-4" />}
          formato="percent-anual"
          referencia={t("radar.selic.ref")}
          mensagem={t("radar.selic.msg")}
          variationLabel={t("radar.selic.varLabel")}
        />
        <IndicadorCard
          loading={loading}
          ind={ipca}
          titulo={t("radar.ipca.title")}
          icone={<LineChart className="h-4 w-4" />}
          formato="percent-mensal"
          referencia={t("radar.ipca.ref")}
          mensagem={t("radar.ipca.msg")}
          variationLabel={t("radar.ipca.varLabel")}
        />
        <IndicadorCard
          loading={loading}
          ind={usd}
          titulo={t("radar.usd.title")}
          icone={<DollarSign className="h-4 w-4" />}
          formato="brl"
          referencia={t("radar.usd.ref")}
          mensagem={t("radar.usd.msg")}
          onClick={() => setOpen(true)}
          actionLabel={t("radar.openConverter")}
        />
        <IndicadorCard
          loading={loading}
          ind={eur}
          titulo={t("radar.eur.title")}
          icone={<Euro className="h-4 w-4" />}
          formato="brl"
          referencia={t("radar.eur.ref")}
          mensagem={t("radar.eur.msg")}
          onClick={() => setOpen(true)}
          actionLabel={t("radar.openConverter")}
        />
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("radar.explainTitle")}</h2>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li><Trans i18nKey="radar.explainSelic" ns="misc" components={{ bold: <span className="font-medium text-foreground" /> }} /></li>
          <li><Trans i18nKey="radar.explainIpca" ns="misc" components={{ bold: <span className="font-medium text-foreground" /> }} /></li>
          <li><Trans i18nKey="radar.explainCurr" ns="misc" components={{ bold: <span className="font-medium text-foreground" /> }} /></li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t("radar.disclaimer")}</p>
      </section>

      <section className="mt-6 rounded-2xl border border-dashed bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">{t("radar.soonTitle")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {(t("radar.soon", { returnObjects: true }) as string[]).map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>

      <RadarDetalhesDialog
        open={open}
        onOpenChange={setOpen}
        data={data}
        loading={loading}
        onRefresh={() => void carregar()}
      />
    </MobileShell>
  );
}

interface IndicadorCardProps {
  loading: boolean;
  ind: Indicator | undefined;
  titulo: string;
  icone: React.ReactNode;
  formato: "brl" | "percent-anual" | "percent-mensal";
  referencia: string;
  mensagem: string;
  variationLabel?: string;
  onClick?: () => void;
  actionLabel?: string;
}

function IndicadorCard(props: IndicadorCardProps) {
  const { t, i18n: i18nInst } = useTranslation("misc");
  const {
    loading,
    ind,
    titulo,
    icone,
    formato,
    referencia,
    mensagem,
    variationLabel,
    onClick,
    actionLabel,
  } = props;

  const stale = ind?.status === "desatualizado";
  const valorTexto = ind
    ? formato === "brl"
      ? formatBRL(ind.value)
      : formato === "percent-anual"
        ? `${ind.value.toFixed(2).replace(".", ",")}${t("radar.perYear")}`
        : `${ind.value.toFixed(2).replace(".", ",")}${t("radar.perMonth")}`
    : "—";

  const mesRef = formatMesRef(ind?.referenceDate ?? null, i18nInst.language);

  const Wrapper: React.ElementType = onClick ? "button" : "div";

  return (
    <Wrapper
      {...(onClick
        ? { type: "button", onClick, "aria-label": t("radar.openDetails", { title: titulo }) }
        : {})}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all",
        onClick && "hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-primary/10 p-1.5 text-primary">{icone}</span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">{titulo}</h3>
            <p className="text-[11px] text-muted-foreground">{referencia}</p>
          </div>
        </div>
        {stale && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            title={t("radar.notUpdated")}
          >
            <AlertCircle className="h-3 w-3" />
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <span className="text-2xl font-semibold tabular-nums">{valorTexto}</span>
        )}
        <VariationPill pct={ind?.variationPercent ?? null} formato={formato} label={variationLabel} />
      </div>

      {mesRef && (
        <p className="text-[11px] text-muted-foreground">{t("radar.reference", { when: mesRef })}</p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">{mensagem}</p>

      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{ind ? t("radar.updatedAt", { when: formatHora(ind.fetchedAt, i18nInst.language) }) : "—"}</span>
        {onClick && actionLabel && (
          <span className="font-medium text-primary group-hover:underline">{actionLabel} →</span>
        )}
      </div>
    </Wrapper>
  );
}

function VariationPill({
  pct,
  formato,
  label,
}: {
  pct: number | null;
  formato: "brl" | "percent-anual" | "percent-mensal";
  label?: string;
}) {
  const { t } = useTranslation("misc");
  if (pct === null || !Number.isFinite(pct)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />—
      </span>
    );
  }
  const positivo = pct >= 0;
  const isMoeda = formato === "brl";
  const cor = isMoeda
    ? positivo
      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : positivo
      ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

  const texto =
    formato === "brl"
      ? formatPct(pct)
      : `${pct > 0 ? "+" : ""}${pct.toFixed(2).replace(".", ",")} pp`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        cor,
      )}
      title={label ?? (positivo ? t("radar.varPositive") : t("radar.varNegative"))}
    >
      {positivo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {texto}
    </span>
  );
}
