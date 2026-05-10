import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Lock,
  Sparkles,
  Loader2,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { usePlan } from "@/lib/use-plan";
import { findPremiumRule, premiumDescription } from "@/lib/premium-routes";
import { getMonthForecast } from "@/lib/finance-ai.functions";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Forecast = Awaited<ReturnType<typeof getMonthForecast>>;

type Props = {
  mes: number;
  ano: number;
  className?: string;
};

const STATUS_STYLES = {
  positivo: {
    label: "Saldo positivo",
    bg: "from-emerald-500/10 via-card to-card",
    ring: "ring-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    icon: TrendingUp,
  },
  atencao: {
    label: "Atenção",
    bg: "from-amber-500/10 via-card to-card",
    ring: "ring-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  negativo: {
    label: "Saldo negativo",
    bg: "from-rose-500/10 via-card to-card",
    ring: "ring-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    icon: TrendingDown,
  },
} as const;

export function MonthForecastCard({ mes, ano, className }: Props) {
  const plan = usePlan();
  const fetchForecast = useServerFn(getMonthForecast);
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const allowed = !plan.loading && plan.can("gasto_ai");
  const rule = findPremiumRule("/gasto-ai");

  useEffect(() => {
    if (!allowed) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    fetchForecast({ data: { mes, ano } })
      .then((r) => {
        if (!cancel) setData(r as Forecast);
      })
      .catch((e: any) => {
        if (!cancel) setError(typeof e?.message === "string" ? e.message : "Não consegui calcular a previsão.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [allowed, mes, ano, fetchForecast]);

  // Bloqueio premium
  if (!plan.loading && !allowed) {
    return (
      <>
        <section
          className={cn(
            "relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-amber-100/10 p-4 shadow-card sm:p-5",
            className,
          )}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400/30 to-primary/30 ring-1 ring-primary/20">
              <Lock className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">Premium</p>
              <h2 className="mt-0.5 text-base font-bold tracking-tight sm:text-lg">Previsão de fechamento</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Veja se você vai fechar o mês positivo ou negativo. Disponível nos planos
                <strong> Pessoa Física Premium</strong>, <strong>MEI Inteligente</strong> e <strong>Empresa</strong>.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setLockOpen(true)}
            className="mt-3 w-full rounded-2xl bg-brand-grad sm:w-auto"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Desbloquear recurso
          </Button>
        </section>
        {rule && (
          <PremiumLockModal
            open={lockOpen}
            onOpenChange={setLockOpen}
            title={rule.title}
            description={premiumDescription(rule)}
          />
        )}
      </>
    );
  }

  const status = data?.status ?? "atencao";
  const cfg = STATUS_STYLES[status];
  const Icon = cfg.icon;

  return (
    <>
      <section
        className={cn(
          "relative overflow-hidden rounded-3xl border bg-gradient-to-br p-4 shadow-card transition sm:p-5",
          cfg.bg,
          "ring-1",
          cfg.ring,
          "hover:shadow-elevated",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-background/70 ring-1", cfg.ring)}>
              <Icon className={cn("h-5 w-5", cfg.text)} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Previsão de fechamento
              </p>
              <h2 className="mt-0.5 truncate text-base font-bold tracking-tight sm:text-lg">
                {data?.label ?? "Carregando…"}
              </h2>
            </div>
          </div>
          {data && (
            <span className={cn("rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-semibold ring-1", cfg.ring, cfg.text)}>
              {cfg.label}
            </span>
          )}
        </div>

        {loading && !data ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando previsão…
          </div>
        ) : error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : !data?.temDados ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Ainda não tenho dados suficientes para projetar este mês. Cadastre suas receitas, contas a pagar e faturas para ver a previsão.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Resultado previsto</span>
              <span className={cn("text-2xl font-bold tracking-tight sm:text-3xl", cfg.text)}>
                {formatBRL(data.resultadoPrevisto)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
              <Pill
                icon={<ArrowUp className="h-3.5 w-3.5" />}
                label="Entradas previstas"
                value={data.entradasConfirmadas + data.entradasPrevistas}
                tone="up"
                sub={`Já recebido: ${formatBRL(data.entradasConfirmadas)}`}
              />
              <Pill
                icon={<ArrowDown className="h-3.5 w-3.5" />}
                label="Saídas previstas"
                value={data.saidasConfirmadas + data.saidasPendentes}
                tone="down"
                sub={`Ainda a pagar: ${formatBRL(data.saidasPendentes)}`}
              />
            </div>

            {data.impactos.length > 0 && (
              <div className="mt-3 rounded-2xl border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Maiores impactos pendentes
                </p>
                <ul className="mt-1.5 space-y-1">
                  {data.impactos.slice(0, 3).map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-foreground/90">{it.nome}</span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">
                        {formatBRL(it.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 text-sm leading-relaxed text-foreground/85">
              {humanMessage(data)}
            </p>

            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="mt-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-semibold text-foreground/90 hover:bg-accent"
            >
              Ver detalhes da previsão
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </section>

      {data && (
        <ForecastDetailDialog open={detailOpen} onOpenChange={setDetailOpen} data={data} />
      )}
    </>
  );
}

function Pill({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  tone: "up" | "down";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full",
            tone === "up" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400",
          )}
        >
          {icon}
        </span>
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 truncate text-base font-bold tabular-nums sm:text-lg">{formatBRL(value)}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function humanMessage(d: Forecast): string {
  const valor = formatBRL(Math.abs(d.resultadoPrevisto));
  const mesNome = d.label.split(" de ")[0];
  const principal = d.impactos[0]?.nome;
  const compl = principal ? ` O maior impacto previsto vem de **${principal}**.` : "";
  if (d.status === "positivo") {
    return `Se nada mudar até o fim do mês, sua previsão é fechar ${mesNome} com saldo positivo de ${valor}.${compl}`;
  }
  if (d.status === "negativo") {
    return `Atenção: a previsão é fechar ${mesNome} com saldo negativo de ${valor}.${compl} Vale revisar gastos e priorizar pagamentos.`;
  }
  return `Seu mês está bem apertado. A previsão é fechar ${mesNome} perto do zero (${formatBRL(d.resultadoPrevisto)}).${compl}`;
}

function ForecastDetailDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: Forecast;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Previsão de {data.label}</DialogTitle>
          <DialogDescription>
            Mês de referência: {data.label}. Hoje: {data.hoje}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Block title="Entradas">
            <Row label="Confirmadas (já recebidas)" value={data.entradasConfirmadas} />
            <Row label="Previstas (a receber)" value={data.entradasPrevistas} muted />
            <Row label="Total previsto" value={data.entradasConfirmadas + data.entradasPrevistas} strong />
          </Block>

          <Block title="Saídas">
            <Row label="Confirmadas (já pagas/registradas)" value={data.saidasConfirmadas} />
            <Row label="Pendentes (a pagar)" value={data.saidasPendentes} muted />
            <Row label="Total previsto" value={data.saidasConfirmadas + data.saidasPendentes} strong />
          </Block>

          <Block title="Resultado">
            <Row label="Atual (entradas conf. − saídas conf.)" value={data.resultadoAtual} />
            <Row label="Previsto de fechamento" value={data.resultadoPrevisto} strong />
          </Block>

          {data.faturasDetalhe.length > 0 && (
            <Block title="Faturas de cartão">
              {data.faturasDetalhe.map((f, i) => (
                <div key={i} className="rounded-xl bg-muted/40 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.cartao}</span>
                    <span className="tabular-nums">{formatBRL(f.total)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Pago: {formatBRL(f.pago)}</span>
                    <span>Pendente: {formatBRL(f.pendente)}</span>
                  </div>
                </div>
              ))}
            </Block>
          )}

          {data.impactos.length > 0 && (
            <Block title="Itens pendentes que mais pesam">
              {data.impactos.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{it.nome}</div>
                    {it.detalhe && <div className="text-xs text-muted-foreground">{it.detalhe}</div>}
                  </div>
                  <span className="shrink-0 tabular-nums font-medium">{formatBRL(it.valor)}</span>
                </div>
              ))}
            </Block>
          )}

          {data.receitas.length > 0 && (
            <Block title="Recebimentos previstos">
              {data.receitas.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.nome}</div>
                    {r.detalhe && <div className="text-xs text-muted-foreground">{r.detalhe}</div>}
                  </div>
                  <span className="shrink-0 tabular-nums font-medium">{formatBRL(r.valor)}</span>
                </div>
              ))}
            </Block>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: number; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn(muted && "text-muted-foreground", strong && "font-semibold")}>{label}</span>
      <span className={cn("shrink-0 tabular-nums", strong && "font-bold")}>{formatBRL(value)}</span>
    </div>
  );
}
