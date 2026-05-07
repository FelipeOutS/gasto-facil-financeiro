import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  TrendingUp,
  Gauge,
  AlertTriangle,
  Wallet,
  ArrowRight,
} from "lucide-react";
import { Money } from "@/components/Money";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStore, getContasAPagar, statusContaEfetivo } from "@/lib/store";
import { getRecorrencias } from "@/lib/recorrencias";

type Status = "saudavel" | "atencao" | "risco" | "sem_dados";

export function SmartLimiteCard({
  mes,
  ano,
  totalEntradas,
  totalGastos,
}: {
  mes: number;
  ano: number;
  totalEntradas: number;
  totalGastos: number;
}) {
  const contas = useStore(() => getContasAPagar());
  // re-render quando recorrências mudam (memRec é compartilhado)
  const recorrencias = useStore(() => getRecorrencias());

  const calc = useMemo(() => {
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === ano && today.getMonth() + 1 === mes;
    const fimMes = new Date(ano, mes, 0); // último dia
    const refDay = isCurrentMonth ? today : new Date(ano, mes - 1, 1);
    const refISO = refDay.toISOString().slice(0, 10);

    const diasNoMes = fimMes.getDate();
    const diasRestantes = isCurrentMonth
      ? Math.max(1, diasNoMes - today.getDate() + 1)
      : diasNoMes;

    // Contas a pagar pendentes até o fim do mês (não pagas)
    let contasPendentes = 0;
    for (const c of contas) {
      if (c.mes !== mes || c.ano !== ano) continue;
      const s = statusContaEfetivo(c, refISO);
      if (s === "pago") continue;
      // ignora se já vencida E já contada como gasto (gastoId presente já cobre)
      if (c.gastoId) continue;
      contasPendentes += c.valor || 0;
    }

    // Assinaturas/recorrências ativas previstas até fim do mês
    const fimMesISO = `${ano}-${String(mes).padStart(2, "0")}-${String(diasNoMes).padStart(2, "0")}`;
    let recorrenciasPrev = 0;
    for (const r of recorrencias) {
      if (r.status !== "ativa") continue;
      const prox = r.proximaCobranca;
      if (!prox) continue;
      if (prox < refISO || prox > fimMesISO) continue;
      // evita duplicar com conta a pagar pendente do mesmo nome
      const dup = contas.some(
        (c) =>
          c.mes === mes &&
          c.ano === ano &&
          statusContaEfetivo(c, refISO) !== "pago" &&
          c.nome.trim().toLowerCase() === r.nome.trim().toLowerCase(),
      );
      if (dup) continue;
      recorrenciasPrev += r.valor || 0;
    }

    const disponivelMes =
      totalEntradas - totalGastos - contasPendentes - recorrenciasPrev;
    const porDia = disponivelMes / diasRestantes;

    const semDados = totalEntradas <= 0 && totalGastos <= 0;

    let status: Status = "saudavel";
    if (semDados) status = "sem_dados";
    else if (disponivelMes < 0) status = "risco";
    else if (porDia < 20 || disponivelMes < totalEntradas * 0.1)
      status = "atencao";

    const pctUsado =
      totalEntradas > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((totalGastos + contasPendentes + recorrenciasPrev) /
                totalEntradas) *
                100,
            ),
          )
        : 0;

    return {
      disponivelMes,
      porDia,
      diasRestantes,
      contasPendentes,
      recorrenciasPrev,
      status,
      pctUsado,
      isCurrentMonth,
    };
  }, [contas, recorrencias, mes, ano, totalEntradas, totalGastos]);

  const {
    porDia,
    diasRestantes,
    disponivelMes,
    status,
    pctUsado,
    contasPendentes,
    recorrenciasPrev,
  } = calc;

  const cfg = STATUS_CONFIG[status];

  return (
    <section
      className={cn(
        "relative w-full overflow-hidden rounded-3xl border p-5 sm:p-6 shadow-card animate-rise",
        "bg-gradient-to-br",
        cfg.gradient,
        cfg.border,
      )}
    >
      {/* glow */}
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full blur-3xl opacity-30",
          cfg.glow,
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full blur-3xl opacity-20",
          cfg.glow,
        )}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full ring-1",
                  cfg.iconBg,
                  cfg.iconRing,
                )}
              >
                <Sparkles className="h-4 w-4" />
              </span>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/80">
                Seu limite inteligente
              </p>
            </div>
            <p className="mt-2 max-w-md text-xs text-white/70 sm:text-[13px]">
              Veja quanto você ainda pode gastar por dia sem comprometer o mês.
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 backdrop-blur-sm animate-fade-in",
              cfg.tagBg,
              cfg.tagRing,
              cfg.tagText,
            )}
          >
            <cfg.TagIcon className="h-3 w-3" />
            {cfg.tagLabel}
          </span>
        </div>

        {/* Valor principal */}
        <div className="mt-5 flex items-end gap-3">
          {status === "sem_dados" ? (
            <p className="text-3xl font-bold text-white/90 sm:text-4xl">
              —
            </p>
          ) : (
            <>
              <Money
                value={Math.max(porDia, status === "risco" ? porDia : 0)}
                duration={900}
                className={cn(
                  "num text-4xl font-extrabold leading-none tracking-tight sm:text-5xl",
                  cfg.valueText,
                )}
              />
              <span className="pb-1 text-sm font-medium text-white/70">
                / dia
              </span>
            </>
          )}
        </div>

        {/* Texto explicativo */}
        <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/80">
          {getMensagem(status, porDia, disponivelMes)}
        </p>

        {/* Barra de progresso */}
        {status !== "sem_dados" && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-white/60">
              <span>Comprometido do mês</span>
              <span className="num">{Math.round(pctUsado)}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  cfg.bar,
                )}
                style={{ width: `${pctUsado}%` }}
              />
            </div>
          </div>
        )}

        {/* Mini-stats */}
        {status !== "sem_dados" && (
          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
            <MiniStat
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Disponível"
              value={formatBRL(disponivelMes)}
              tone={disponivelMes < 0 ? "neg" : "pos"}
            />
            <MiniStat
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Dias restantes"
              value={`${diasRestantes}`}
            />
            <MiniStat
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="A pagar + assinaturas"
              value={formatBRL(contasPendentes + recorrenciasPrev)}
            />
          </div>
        )}

        {/* CTA */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            to="/gastos"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            Revisar gastos
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            to="/orcamento"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:text-white"
          >
            Ajustar orçamento
          </Link>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-xl bg-white/8 p-2.5 ring-1 ring-white/10 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/60">
        <span className="text-white/70">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          "num mt-1 truncate text-sm font-bold",
          tone === "neg" ? "text-rose-200" : "text-white",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function getMensagem(status: Status, porDia: number, disp: number): string {
  if (status === "sem_dados")
    return "Adicione sua renda e suas contas para liberar uma análise inteligente do seu mês.";
  if (status === "risco")
    return "No ritmo atual, seu mês pode terminar no vermelho. É hora de reduzir os gastos para recuperar o controle.";
  if (status === "atencao")
    return `Seu limite diário está mais apertado. Tente manter os gastos abaixo de ${formatBRL(porDia)} por dia.`;
  return `Você pode gastar até ${formatBRL(porDia)} por dia e ainda fechar o mês com tranquilidade.`;
}

const STATUS_CONFIG: Record<
  Status,
  {
    gradient: string;
    border: string;
    glow: string;
    bar: string;
    valueText: string;
    iconBg: string;
    iconRing: string;
    tagBg: string;
    tagRing: string;
    tagText: string;
    tagLabel: string;
    TagIcon: React.ComponentType<{ className?: string }>;
  }
> = {
  saudavel: {
    gradient: "from-emerald-900 via-emerald-950 to-slate-950",
    border: "border-emerald-500/30",
    glow: "bg-emerald-400",
    bar: "bg-gradient-to-r from-emerald-300 to-emerald-500",
    valueText: "text-emerald-100",
    iconBg: "bg-emerald-400/20 text-emerald-200",
    iconRing: "ring-emerald-400/30",
    tagBg: "bg-emerald-400/20",
    tagRing: "ring-emerald-300/40",
    tagText: "text-emerald-100",
    tagLabel: "Tudo sob controle",
    TagIcon: Sparkles,
  },
  atencao: {
    gradient: "from-amber-900 via-slate-950 to-slate-950",
    border: "border-amber-400/30",
    glow: "bg-amber-400",
    bar: "bg-gradient-to-r from-amber-300 to-orange-500",
    valueText: "text-amber-100",
    iconBg: "bg-amber-400/20 text-amber-200",
    iconRing: "ring-amber-300/30",
    tagBg: "bg-amber-400/20",
    tagRing: "ring-amber-300/40",
    tagText: "text-amber-100",
    tagLabel: "Atenção ao ritmo",
    TagIcon: Gauge,
  },
  risco: {
    gradient: "from-rose-900 via-slate-950 to-slate-950",
    border: "border-rose-500/30",
    glow: "bg-rose-500",
    bar: "bg-gradient-to-r from-rose-400 to-red-600",
    valueText: "text-rose-100",
    iconBg: "bg-rose-500/20 text-rose-200",
    iconRing: "ring-rose-400/30",
    tagBg: "bg-rose-500/25",
    tagRing: "ring-rose-300/40",
    tagText: "text-rose-100",
    tagLabel: "Alerta financeiro",
    TagIcon: AlertTriangle,
  },
  sem_dados: {
    gradient: "from-slate-800 via-slate-900 to-slate-950",
    border: "border-white/10",
    glow: "bg-slate-400",
    bar: "bg-white/30",
    valueText: "text-white/80",
    iconBg: "bg-white/10 text-white/80",
    iconRing: "ring-white/20",
    tagBg: "bg-white/10",
    tagRing: "ring-white/20",
    tagText: "text-white/80",
    tagLabel: "Sem dados",
    TagIcon: Sparkles,
  },
};
