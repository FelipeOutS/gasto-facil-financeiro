import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import { getEconomicRadar } from "@/server/radar.functions";

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
}

interface RadarResult {
  indicators: Indicator[];
  status: Status;
  fetchedAt: string;
  message?: string;
}

const CURRENCY_LABEL: Record<string, string> = {
  USD_BRL: "Dólar",
  EUR_BRL: "Euro",
};

const CURRENCY_FLAG: Record<string, string> = {
  USD_BRL: "🇺🇸",
  EUR_BRL: "🇪🇺",
};

function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2).replace(".", ",")}%`;
}

function formatHora(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()) || d.getTime() === 0) return "—";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function mensagemImpacto(usd?: Indicator, eur?: Indicator): string {
  const u = usd?.variationPercent ?? 0;
  const e = eur?.variationPercent ?? 0;
  const sobeUsd = u > 0.2;
  const caiUsd = u < -0.2;
  if (sobeUsd) {
    return "O dólar subiu hoje. Compras internacionais e assinaturas em dólar podem pesar mais na fatura.";
  }
  if (caiUsd) {
    return "O dólar caiu hoje. Bom momento para acompanhar compras internacionais e assinaturas em dólar.";
  }
  if (e > 0.2) {
    return "O euro subiu hoje. Compras e viagens para a Europa podem ficar mais caras.";
  }
  if (e < -0.2) {
    return "O euro caiu hoje. Compras e viagens para a Europa podem ficar um pouco mais em conta.";
  }
  return "As cotações estão relativamente estáveis hoje. Sem grandes impactos em compras internacionais.";
}

function VariationBadge({ pct }: { pct: number | null }) {
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
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
      title={positivo ? "Variação positiva no dia" : "Variação negativa no dia"}
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
  const fetchRadar = useServerFn(getEconomicRadar);
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
            message:
              "Não conseguimos carregar as cotações agora. Tente novamente em instantes.",
          });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [fetchRadar]);

  const usd = data?.indicators.find((i) => i.key === "USD_BRL");
  const eur = data?.indicators.find((i) => i.key === "EUR_BRL");
  const stale = data?.status === "desatualizado";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group w-full overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring",
          className,
        )}
        aria-label="Abrir Radar Econômico"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
                <ArrowRightLeft className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold">Radar Econômico</h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cotações de referência do dia
            </p>
          </div>
          {stale && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              title="Não foi possível atualizar agora"
            >
              <AlertCircle className="h-3 w-3" /> desatualizado
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

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {loading
            ? "Carregando cotações…"
            : stale
              ? "Não conseguimos atualizar os indicadores agora. Exibindo a última cotação disponível."
              : mensagemImpacto(usd, eur)}
        </p>

        {!loading && data && data.indicators.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Atualizado em {formatHora(data.fetchedAt)} · toque para ver detalhes
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
  const label = CURRENCY_LABEL[ind?.key ?? fallbackKey] ?? fallbackKey;
  const flag = CURRENCY_FLAG[ind?.key ?? fallbackKey] ?? "💱";
  return (
    <div className="rounded-xl border bg-background/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {flag} {label}
        </span>
        <VariationBadge pct={ind?.variationPercent ?? null} />
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {ind ? formatBRL(ind.value) : "—"}
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
  const usd = data?.indicators.find((i) => i.key === "USD_BRL");
  const eur = data?.indicators.find((i) => i.key === "EUR_BRL");
  const stale = data?.status === "desatualizado";

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
      moeda: CURRENCY_LABEL[cotacaoAtual.key] ?? cotacaoAtual.key,
    });
  };

  // limpa resultado se troca de moeda ou valor
  useEffect(() => {
    setConvertido(null);
  }, [moeda, valor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Radar Econômico
          </DialogTitle>
          <DialogDescription>
            Cotações de referência para você acompanhar o impacto do câmbio.
          </DialogDescription>
        </DialogHeader>

        {stale && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
            Não conseguimos atualizar os indicadores agora. Mostrando a última
            cotação disponível.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <CotacaoDetalhe ind={usd} loading={loading} fallbackKey="USD_BRL" />
          <CotacaoDetalhe ind={eur} loading={loading} fallbackKey="EUR_BRL" />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data && data.indicators.length > 0
              ? `Atualizado em ${formatHora(data.fetchedAt)}`
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
            Atualizar
          </Button>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Conversor rápido</h4>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
            <div className="space-y-1">
              <Label className="text-xs">Moeda</Label>
              <Select value={moeda} onValueChange={(v) => setMoeda(v as typeof moeda)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD_BRL">🇺🇸 Dólar (USD)</SelectItem>
                  <SelectItem value="EUR_BRL">🇪🇺 Euro (EUR)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="radar-valor">
                Valor
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
                Converter
              </Button>
            </div>
          </div>

          {convertido && (
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Valor aproximado</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatBRL(convertido.brl)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cotação usada: {formatBRL(convertido.cotacao)} por 1{" "}
                {convertido.moeda} · {formatHora(convertido.quando)}
              </p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Este valor é uma estimativa. A cobrança final pode variar conforme
            IOF, spread, data da compra e cotação usada pelo cartão.
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
  const label = CURRENCY_LABEL[ind?.key ?? fallbackKey] ?? fallbackKey;
  const flag = CURRENCY_FLAG[ind?.key ?? fallbackKey] ?? "💱";
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
              {ind ? formatBRL(ind.value) : "—"}
            </p>
          )}
        </div>
        <VariationBadge pct={ind?.variationPercent ?? null} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-2 py-1">
          <p className="text-muted-foreground">Máx.</p>
          <p className="font-medium tabular-nums">
            {ind?.high != null ? formatBRL(ind.high) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1">
          <p className="text-muted-foreground">Mín.</p>
          <p className="font-medium tabular-nums">
            {ind?.low != null ? formatBRL(ind.low) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
