import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Percent, LineChart, Landmark, RefreshCw, AlertCircle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LoadErrorState } from "@/components/ui/load-error-state";
import {
  loadBcbRadar,
  type BcbIndicator,
  type BcbIndicatorKey,
  type BcbRadarResult,
} from "@/lib/economy/bcb";

interface UserContext {
  /** Saldo do mês (receitas - despesas). */
  saldo?: number;
  /** Receitas do mês. */
  receitas?: number;
  /** Despesas do mês. */
  despesas?: number;
}

/**
 * Radar Econômico Inteligente — indicadores do Banco Central (SGS).
 *
 * Mostra Selic, CDI e IPCA com leitura prática contextualizada (usando,
 * quando disponíveis, dados do mês do usuário — saldo/receitas/despesas).
 * Sem login, sem banco — dados puxados direto da API pública do BCB com
 * cache em localStorage (ver src/lib/economy/bcb.ts).
 */
export function RadarEconomicoInteligenteCard({
  className,
  userContext,
}: {
  className?: string;
  userContext?: UserContext;
}) {
  const { t } = useTranslation("common");
  const { t: tD } = useTranslation("dashboard");
  const [data, setData] = useState<BcbRadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const carregar = async (force = false) => {
    setLoading(true);
    setErrored(false);
    try {
      const r = await loadBcbRadar({ force });
      setData(r);
      if (r.failed) setErrored(true);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar(false);
  }, []);

  const get = (k: BcbIndicatorKey): BcbIndicator | undefined =>
    data?.indicators.find((i) => i.key === k);

  const selic = get("SELIC");
  const cdi = get("CDI");
  const ipca = get("IPCA");
  const stale = data?.partiallyStale ?? false;
  const leituraPratica =
    !loading && data?.indicators.length
      ? gerarLeituraPratica({ selic, cdi, ipca, userContext })
      : null;

  return (
    <section
      className={cn("flex h-full flex-col rounded-2xl border bg-card p-5 shadow-sm", className)}
      aria-label={tD("radarInteligente.aria")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
              <Landmark className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold">{tD("radarInteligente.title")}</h3>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{tD("radarInteligente.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void carregar(true)}
          disabled={loading}
          className="h-7 shrink-0 px-2 text-xs"
          aria-label={tD("radarInteligente.refreshAria")}
          title={tD("radarInteligente.refreshTitle")}
        >
          <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} />
          {tD("radarInteligente.refresh")}
        </Button>
      </header>

      {stale && !loading && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{tD("radarInteligente.stale")}</span>
        </div>
      )}

      {errored && !loading && !data?.indicators.length && (
        <div className="mt-3">
          <LoadErrorState
            variant="compact"
            description={t("loadError.bcbIndicators")}
            onRetry={() => carregar(true)}
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
        <IndicadorMini
          loading={loading}
          ind={selic}
          titulo="Selic"
          icone={<Percent className="h-3.5 w-3.5" />}
          unidade={tD("radarInteligente.units.perYear")}
          interpretacao={
            selic ? interpretarSelic(selic.value) : "Taxa básica de juros da economia."
          }
        />
        <IndicadorMini
          loading={loading}
          ind={cdi}
          titulo="CDI"
          icone={<LineChart className="h-3.5 w-3.5" />}
          unidade={tD("radarInteligente.units.perYear")}
          interpretacao={
            cdi ? interpretarCdi(cdi.value) : "Referência para investimentos conservadores."
          }
        />
        <IndicadorMini
          loading={loading}
          ind={ipca}
          titulo="IPCA"
          icone={<LineChart className="h-3.5 w-3.5" />}
          unidade={tD("radarInteligente.units.perMonth")}
          interpretacao={ipca ? interpretarIpca(ipca.value) : "Inflação oficial do consumidor."}
        />
      </div>

      {leituraPratica && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>{leituraPratica}</p>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {tD("radarInteligente.source")}
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

// ─────────────────────────────────────────────────────────────────────────
// Regras de interpretação (puras, sem efeitos colaterais).
// Valores em % a.a. para Selic/CDI, % no mês para IPCA.
// ─────────────────────────────────────────────────────────────────────────

function interpretarSelic(v: number): string {
  if (v >= 12)
    return "Selic alta: crédito e parcelamentos mais caros; renda fixa tende a render mais.";
  if (v >= 8) return "Selic moderada: equilíbrio entre crédito e investimentos conservadores.";
  return "Selic baixa: crédito tende a ficar mais acessível, mas renda fixa rende menos.";
}

function interpretarCdi(v: number): string {
  if (v >= 12) return "CDI alto: pode favorecer reserva em aplicações conservadoras.";
  if (v >= 8) return "CDI moderado: rendimento conservador segue atrativo.";
  return "CDI baixo: rendimento conservador pode perder força.";
}

function interpretarIpca(v: number): string {
  if (v >= 0.6) return "IPCA alto no mês: atenção ao custo de vida e gastos variáveis.";
  if (v >= 0.2) return "IPCA moderado: acompanhe gastos recorrentes e categorias variáveis.";
  if (v >= 0) return "Inflação mais controlada, mas ainda exige acompanhamento.";
  return "Deflação no mês: preços caíram em média.";
}

/**
 * Gera uma frase única em linguagem leiga combinando o cenário macro
 * com dados do mês do usuário (quando disponíveis). Conservadora — só
 * sugere ação quando há sinais claros.
 */
function gerarLeituraPratica(args: {
  selic?: BcbIndicator;
  cdi?: BcbIndicator;
  ipca?: BcbIndicator;
  userContext?: UserContext;
}): string {
  const { selic, cdi, ipca, userContext } = args;
  const jurosAltos = (selic?.value ?? 0) >= 12 || (cdi?.value ?? 0) >= 12;
  const jurosModerados = !jurosAltos && ((selic?.value ?? 0) >= 8 || (cdi?.value ?? 0) >= 8);
  const inflacaoAlta = (ipca?.value ?? 0) >= 0.6;
  const inflacaoModerada = !inflacaoAlta && (ipca?.value ?? 0) >= 0.2;

  const saldo = userContext?.saldo;
  const temSaldoPositivo = typeof saldo === "number" && saldo > 0;
  const temSaldoNegativo = typeof saldo === "number" && saldo < 0;

  // Combinações priorizadas: situação do usuário + cenário macro.
  if (temSaldoNegativo && jurosAltos) {
    return "Com saldo negativo no mês e juros altos, priorize quitar dívidas caras e evite novos parcelamentos longos.";
  }
  if (temSaldoNegativo) {
    return "Saldo negativo no mês: corte gastos não essenciais antes de assumir novas parcelas.";
  }
  if (temSaldoPositivo && jurosAltos) {
    return "Saldo positivo com juros altos: bom momento para reforçar a reserva em renda fixa conservadora.";
  }
  if (temSaldoPositivo && inflacaoAlta) {
    return "Sobra no mês, mas inflação alta: proteja o poder de compra evitando acumular dinheiro parado.";
  }
  if (temSaldoPositivo) {
    return "Saldo positivo: ótimo momento para reforçar reserva de emergência ou metas.";
  }

  // Sem contexto do usuário — só macro.
  if (jurosAltos && inflacaoAlta) {
    return "Juros e inflação altos: cuidado com parcelamentos e acompanhe gastos do dia a dia.";
  }
  if (jurosAltos) {
    return "Juros ainda altos: bom momento para quitar dívidas caras e evitar parcelamentos longos.";
  }
  if (inflacaoAlta) {
    return "Inflação mais alta: acompanhe mercado, contas recorrentes e gastos variáveis.";
  }
  if (jurosModerados && inflacaoModerada) {
    return "Cenário equilibrado: mantenha o orçamento em dia e revise gastos recorrentes.";
  }
  return "Cenário estável: bom momento para revisar metas e manter a reserva de emergência.";
}
