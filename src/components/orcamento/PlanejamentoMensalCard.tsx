import { Wallet } from "lucide-react";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";

export type PlanejamentoEstado =
  | "sem_renda"
  | "sem_limites"
  | "com_sobra"
  | "tudo_distribuido"
  | "excesso";

export type PlanejamentoLabels = {
  title: string;
  description: string;
  income: string;
  distributed: string;
  unassigned: string;
  excess: string;
  categories: string;
  reserveGoals: string;
  free: string;
  noIncome: string;
  noLimits: string;
  allAssigned: string;
  withFree: string;
  withExcess: string;
  ofIncome: string;
};

type Props = {
  renda: number;
  distribuidoCategorias: number;
  distribuidoReserva: number;
  estado: PlanejamentoEstado;
  labels: PlanejamentoLabels;
};

export function PlanejamentoMensalCard({
  renda,
  distribuidoCategorias,
  distribuidoReserva,
  estado,
  labels,
}: Props) {
  const distribuido = distribuidoCategorias + distribuidoReserva;
  const livre = renda - distribuido;
  const excesso = distribuido - renda;
  const pct = renda > 0 ? Math.min(100, Math.round((distribuido / renda) * 100)) : 0;

  // segmentos para a barra (base = max(renda, distribuido) para casos de excesso)
  const base = Math.max(renda, distribuido, 1);
  const wCat = (distribuidoCategorias / base) * 100;
  const wRes = (distribuidoReserva / base) * 100;
  const wLivre = renda > 0 && livre > 0 ? (livre / base) * 100 : 0;
  const wExc = excesso > 0 ? (excesso / base) * 100 : 0;

  const tone =
    estado === "excesso"
      ? "destructive"
      : estado === "tudo_distribuido"
        ? "success"
        : estado === "com_sobra"
          ? "warning"
          : "muted";

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5",
        tone === "destructive" && "ring-1 ring-destructive/30",
        tone === "success" && "ring-1 ring-success/30",
        tone === "warning" && "ring-1 ring-warning/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <Wallet className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{labels.title}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {labels.description}
          </p>
        </div>
      </div>

      {/* Estados sem dados úteis */}
      {estado === "sem_renda" ? (
        <p className="mt-4 text-xs text-muted-foreground">{labels.noIncome}</p>
      ) : estado === "sem_limites" ? (
        <p className="mt-4 text-xs text-muted-foreground">{labels.noLimits}</p>
      ) : (
        <>
          {/* Números principais */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-card-elevated p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {labels.income}
              </p>
              <p className="num mt-0.5 text-sm font-bold">
                <Money value={renda} />
              </p>
            </div>
            <div className="rounded-xl bg-card-elevated p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {labels.distributed}
              </p>
              <p className="num mt-0.5 text-sm font-bold">
                <Money value={distribuido} />
              </p>
              {renda > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {pct}% {labels.ofIncome}
                </p>
              )}
            </div>
            <div className="rounded-xl bg-card-elevated p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {excesso > 0 ? labels.excess : labels.unassigned}
              </p>
              <p
                className={cn(
                  "num mt-0.5 text-sm font-bold",
                  excesso > 0 && "text-destructive",
                  excesso <= 0 && livre > 0 && "text-warning",
                  excesso <= 0 && livre <= 0 && renda > 0 && "text-success",
                )}
              >
                <Money value={excesso > 0 ? excesso : Math.max(0, livre)} />
              </p>
            </div>
          </div>

          {/* Barra segmentada */}
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-card-elevated">
            <div className="flex h-full w-full">
              {wCat > 0 && (
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${wCat}%` }}
                  aria-label={labels.categories}
                />
              )}
              {wRes > 0 && (
                <div
                  className="h-full bg-success transition-all"
                  style={{ width: `${wRes}%` }}
                  aria-label={labels.reserveGoals}
                />
              )}
              {wLivre > 0 && (
                <div
                  className="h-full bg-warning/70 transition-all"
                  style={{ width: `${wLivre}%` }}
                  aria-label={labels.free}
                />
              )}
              {wExc > 0 && (
                <div
                  className="h-full bg-destructive transition-all"
                  style={{ width: `${wExc}%` }}
                  aria-label={labels.excess}
                />
              )}
            </div>
          </div>

          {/* Legenda */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-brand" />
              {labels.categories}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              {labels.reserveGoals}
            </span>
            {livre > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-warning/70" />
                {labels.free}
              </span>
            )}
            {excesso > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                {labels.excess}
              </span>
            )}
          </div>

          {/* Mensagem narrativa */}
          <p
            className={cn(
              "mt-3 text-xs",
              estado === "excesso"
                ? "text-destructive"
                : estado === "tudo_distribuido"
                  ? "text-success"
                  : "text-muted-foreground",
            )}
          >
            {estado === "excesso" ? (
              <>
                {labels.withExcess}{" "}
                <Money value={excesso} className="num font-semibold" />
              </>
            ) : estado === "tudo_distribuido" ? (
              labels.allAssigned
            ) : (
              <>
                {labels.withFree}{" "}
                <Money value={Math.max(0, livre)} className="num font-semibold" />
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
