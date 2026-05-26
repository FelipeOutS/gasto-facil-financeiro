import { useEffect, useState } from "react";
import { Percent, LineChart, Landmark, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  loadBcbRadar,
  type BcbIndicator,
  type BcbIndicatorKey,
  type BcbRadarResult,
} from "@/lib/economy/bcb";

/**
 * Radar Econômico Inteligente — indicadores do Banco Central (SGS).
 *
 * Mostra Selic, CDI e IPCA com explicação curta e interpretação prática.
 * Sem login, sem banco — dados puxados direto da API pública do BCB com
 * cache em localStorage (ver src/lib/economy/bcb.ts).
 */
export function RadarEconomicoInteligenteCard({ className }: { className?: string }) {
  const [data, setData] = useState<BcbRadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const carregar = async () => {
    setLoading(true);
    setErrored(false);
    try {
      const r = await loadBcbRadar();
      setData(r);
      if (r.failed) setErrored(true);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const get = (k: BcbIndicatorKey): BcbIndicator | undefined =>
    data?.indicators.find((i) => i.key === k);

  const selic = get("SELIC");
  const cdi = get("CDI");
  const ipca = get("IPCA");
  const stale = data?.partiallyStale ?? false;

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-sm",
        className,
      )}
      aria-label="Indicadores econômicos do Banco Central"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
              <Landmark className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold">Indicadores do Banco Central</h3>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Selic, CDI e IPCA com leitura prática para o seu bolso.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void carregar()}
          disabled={loading}
          className="h-7 px-2 text-xs"
          aria-label="Atualizar indicadores"
        >
          <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} />
          Atualizar
        </Button>
      </header>

      {stale && !loading && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Mostrando últimos dados conhecidos — a fonte pode estar instável.</span>
        </div>
      )}

      {errored && !loading && !data?.indicators.length && (
        <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          Não foi possível atualizar os indicadores agora. Tente novamente em instantes.
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <IndicadorMini
          loading={loading}
          ind={selic}
          titulo="Selic"
          icone={<Percent className="h-3.5 w-3.5" />}
          unidade="% a.a."
          interpretacao={
            selic ? interpretarSelic(selic.value) : "Taxa básica de juros da economia."
          }
        />
        <IndicadorMini
          loading={loading}
          ind={cdi}
          titulo="CDI"
          icone={<LineChart className="h-3.5 w-3.5" />}
          unidade="% a.a."
          interpretacao={
            cdi ? interpretarCdi(cdi.value) : "Referência para investimentos conservadores."
          }
        />
        <IndicadorMini
          loading={loading}
          ind={ipca}
          titulo="IPCA"
          icone={<LineChart className="h-3.5 w-3.5" />}
          unidade="% no mês"
          interpretacao={
            ipca ? interpretarIpca(ipca.value) : "Inflação oficial do consumidor."
          }
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Fonte: Banco Central do Brasil (SGS). Dados públicos atualizados a cada poucas horas.
      </p>
    </section>
  );
}

function IndicadorMini({
  loading,
  ind,
  titulo,
  icone,
  unidade,
  interpretacao,
}: {
  loading: boolean;
  ind: BcbIndicator | undefined;
  titulo: string;
  icone: React.ReactNode;
  unidade: string;
  interpretacao: string;
}) {
  return (
    <div className="rounded-xl border bg-background/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="text-primary">{icone}</span>
        {titulo}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : ind ? (
          <>
            <span className="text-lg font-semibold tabular-nums">
              {ind.value.toFixed(2).replace(".", ",")}
            </span>
            <span className="text-[10px] text-muted-foreground">{unidade}</span>
          </>
        ) : (
          <span className="text-lg font-semibold text-muted-foreground">—</span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground line-clamp-3">
        {interpretacao}
      </p>
    </div>
  );
}

function interpretarSelic(v: number): string {
  if (v >= 12) return "Juros altos: crédito caro, renda fixa rende mais.";
  if (v >= 8) return "Juros moderados: bom para renda fixa, atenção ao crédito.";
  return "Juros baixos: crédito mais barato, renda fixa rende menos.";
}

function interpretarCdi(v: number): string {
  if (v >= 12) return "CDI alto: ótimo para CDB, LCI e fundos DI.";
  if (v >= 8) return "CDI moderado: bom retorno em renda fixa pós-fixada.";
  return "CDI baixo: rendimentos conservadores mais modestos.";
}

function interpretarIpca(v: number): string {
  if (v >= 0.6) return "Inflação alta no mês: cuidado redobrado com o orçamento.";
  if (v >= 0.2) return "Inflação moderada: revise gastos sensíveis a preço.";
  if (v >= 0) return "Inflação baixa no mês: alívio leve no custo de vida.";
  return "Deflação: preços caíram em média no mês.";
}
