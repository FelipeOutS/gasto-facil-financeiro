import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ArrowDown, ArrowUp, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { formatBRL, formatMonthYear, parseDateLocal, todayISO } from "@/lib/format";
import { getContasAPagar, statusContaEfetivo, useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { listarContasReceber, statusEfetivo as statusReceberEfetivo, type ContaReceber } from "@/lib/contas-receber";

type EventoTipo = "pagar" | "receber";

type EventoDia = {
  id: string;
  tipo: EventoTipo;
  titulo: string;
  valor: number;
  /** "pago" | "recebido" | "pendente" | "atrasado" | "parcial" | "cancelado" */
  status: string;
  href: string;
};

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function isoToKey(d: string): string {
  // Assume YYYY-MM-DD
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function buildGridDays(ano: number, mes: number): Date[] {
  // mes: 1..12
  const first = new Date(ano, mes - 1, 1);
  const startWeekday = first.getDay(); // 0..6 Sun..Sat
  const start = new Date(ano, mes - 1, 1 - startWeekday);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarioFinanceiro({
  ano,
  mes,
  onChangeMonth,
}: {
  ano: number;
  mes: number;
  onChangeMonth: (delta: number) => void;
}) {
  const { user } = useAuth();
  const contas = useStore(() => getContasAPagar());
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setReceber([]);
      return;
    }
    listarContasReceber(user.id)
      .then((rows) => {
        if (!cancelled) setReceber(rows);
      })
      .catch(() => {
        if (!cancelled) setReceber([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Mapa: ISO -> EventoDia[]
  const eventosPorDia = useMemo(() => {
    const map = new Map<string, EventoDia[]>();

    for (const c of contas) {
      const key = isoToKey(c.dataVencimento);
      const eff = statusContaEfetivo(c);
      const list = map.get(key) ?? [];
      list.push({
        id: `pagar-${c.id}`,
        tipo: "pagar",
        titulo: c.nome,
        valor: Number(c.valor) || 0,
        status: eff,
        href: "/contas-a-pagar",
      });
      map.set(key, list);
    }

    for (const r of receber) {
      if (r.status === "cancelado") continue;
      const key = isoToKey(r.data_prevista);
      const eff = statusReceberEfetivo(r);
      const list = map.get(key) ?? [];
      list.push({
        id: `receber-${r.id}`,
        tipo: "receber",
        titulo: r.titulo,
        valor: Number(r.valor_total) || 0,
        status: eff,
        href: "/contas-a-receber",
      });
      map.set(key, list);
    }

    return map;
  }, [contas, receber]);

  const days = useMemo(() => buildGridDays(ano, mes), [ano, mes]);
  const hojeISO = todayISO();

  function statusInfo(status: string, tipo: EventoTipo) {
    if (status === "pago" || status === "recebido") {
      return { dot: "bg-emerald-500", label: tipo === "pagar" ? "Paga" : "Recebida", tone: "text-emerald-400" };
    }
    if (status === "atrasado") {
      return { dot: "bg-rose-500", label: "Atrasada", tone: "text-rose-400" };
    }
    if (status === "parcial") {
      return { dot: "bg-amber-500", label: "Parcial", tone: "text-amber-400" };
    }
    return tipo === "pagar"
      ? { dot: "bg-amber-400", label: "A pagar", tone: "text-amber-300" }
      : { dot: "bg-sky-400", label: "A receber", tone: "text-sky-300" };
  }

  function resumoDia(eventos: EventoDia[]) {
    let pagar = 0;
    let receberV = 0;
    let temAtrasada = false;
    let temPaga = false;
    for (const ev of eventos) {
      if (ev.tipo === "pagar") pagar += ev.valor;
      else receberV += ev.valor;
      if (ev.status === "atrasado") temAtrasada = true;
      if (ev.status === "pago" || ev.status === "recebido") temPaga = true;
    }
    return { pagar, receber: receberV, temAtrasada, temPaga };
  }

  // Próximos vencimentos (mobile e fallback)
  const proximos = useMemo(() => {
    const eventos: Array<EventoDia & { iso: string }> = [];
    eventosPorDia.forEach((list, iso) => {
      if (iso < hojeISO) return;
      list.forEach((ev) => {
        if (ev.status === "pago" || ev.status === "recebido" || ev.status === "cancelado") return;
        eventos.push({ ...ev, iso });
      });
    });
    eventos.sort((a, b) => a.iso.localeCompare(b.iso));
    return eventos.slice(0, 8);
  }, [eventosPorDia, hojeISO]);

  // Resumo do mês visível
  const resumoMes = useMemo(() => {
    let pagar = 0;
    let receberV = 0;
    let atrasadas = 0;
    days.forEach((d) => {
      if (d.getMonth() !== mes - 1) return;
      const evs = eventosPorDia.get(dateToISO(d)) ?? [];
      evs.forEach((ev) => {
        if (ev.tipo === "pagar" && ev.status !== "pago") pagar += ev.valor;
        if (ev.tipo === "receber" && ev.status !== "recebido") receberV += ev.valor;
        if (ev.status === "atrasado") atrasadas++;
      });
    });
    return { pagar, receber: receberV, atrasadas };
  }, [days, eventosPorDia, mes]);

  const eventosDoDia = diaSelecionado ? (eventosPorDia.get(diaSelecionado) ?? []) : [];
  const dataSelecionadaLabel = diaSelecionado
    ? (parseDateLocal(diaSelecionado) ?? new Date()).toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })
    : "";

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-elevated lg:p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Calendário financeiro
          </p>
          <h2 className="mt-0.5 text-lg font-bold capitalize tracking-tight">
            {formatMonthYear(ano, mes)}
          </h2>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-background p-1">
          <button
            onClick={() => onChangeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onChangeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KPIs do mês */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">A pagar</p>
          <p className="mt-0.5 font-semibold text-amber-300">
            <Money value={resumoMes.pagar} />
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">A receber</p>
          <p className="mt-0.5 font-semibold text-sky-300">
            <Money value={resumoMes.receber} />
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Atrasadas</p>
          <p className={cn("mt-0.5 font-semibold", resumoMes.atrasadas > 0 ? "text-rose-400" : "text-muted-foreground")}>
            {resumoMes.atrasadas}
          </p>
        </div>
      </div>

      {/* Legenda */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> A pagar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-400" /> A receber
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> Atrasada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Paga / Recebida
        </span>
      </div>

      {/* Grid 7x6 — desktop / tablet */}
      <div className="mt-4 hidden md:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((d) => {
            const iso = dateToISO(d);
            const dim = d.getMonth() !== mes - 1;
            const isHoje = iso === hojeISO;
            const evs = eventosPorDia.get(iso) ?? [];
            const r = resumoDia(evs);
            const hasEvents = evs.length > 0;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDiaSelecionado(iso)}
                className={cn(
                  "group relative flex min-h-[68px] flex-col rounded-lg border p-1.5 text-left transition-colors",
                  dim
                    ? "border-transparent text-muted-foreground/50 hover:bg-accent/40"
                    : "border-border bg-background/30 hover:bg-accent/60",
                  isHoje && "ring-1 ring-primary/60",
                  hasEvents && !dim && "border-border/80",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold",
                    isHoje && "text-primary",
                  )}
                >
                  {d.getDate()}
                </span>

                {hasEvents && (
                  <div className="mt-auto flex flex-col gap-0.5">
                    {/* Indicadores resumidos */}
                    <div className="flex items-center gap-1">
                      {r.pagar > 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                      {r.receber > 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
                      )}
                      {r.temAtrasada && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
                      )}
                      {r.temPaga && !r.temAtrasada && r.pagar === 0 && r.receber === 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </div>
                    {!dim && (r.pagar > 0 || r.receber > 0) && (
                      <span className="truncate text-[10px] font-medium leading-tight text-muted-foreground">
                        {r.pagar > 0 && r.receber === 0 && `−${formatBRL(r.pagar)}`}
                        {r.receber > 0 && r.pagar === 0 && `+${formatBRL(r.receber)}`}
                        {r.pagar > 0 && r.receber > 0 && `${evs.length} itens`}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mini calendário (mobile) + lista próximos */}
      <div className="mt-4 md:hidden">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="mt-0.5 grid grid-cols-7 gap-0.5">
          {days.map((d) => {
            const iso = dateToISO(d);
            const dim = d.getMonth() !== mes - 1;
            const isHoje = iso === hojeISO;
            const evs = eventosPorDia.get(iso) ?? [];
            const r = resumoDia(evs);
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDiaSelecionado(iso)}
                className={cn(
                  "relative flex aspect-square items-center justify-center rounded-md text-xs",
                  dim ? "text-muted-foreground/40" : "text-foreground",
                  isHoje && "bg-primary/15 font-bold text-primary",
                  evs.length > 0 && !isHoje && !dim && "bg-accent/40",
                )}
              >
                <span>{d.getDate()}</span>
                {evs.length > 0 && (
                  <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-[2px]">
                    {r.pagar > 0 && <span className="h-1 w-1 rounded-full bg-amber-400" />}
                    {r.receber > 0 && <span className="h-1 w-1 rounded-full bg-sky-400" />}
                    {r.temAtrasada && <span className="h-1 w-1 rounded-full bg-rose-500" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Próximos vencimentos */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground">Próximos vencimentos</p>
          {proximos.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nenhum vencimento próximo. 🎉</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {proximos.map((ev) => {
                const info = statusInfo(ev.status, ev.tipo);
                const dataFmt = (parseDateLocal(ev.iso) ?? new Date()).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                });
                return (
                  <li key={ev.id}>
                    <Link
                      to={ev.href}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-2 text-xs transition-colors hover:bg-accent/60"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", info.dot)} />
                      <span className="min-w-0 flex-1 truncate font-medium">{ev.titulo}</span>
                      <span className="shrink-0 text-muted-foreground">{dataFmt}</span>
                      <span
                        className={cn(
                          "shrink-0 font-semibold",
                          ev.tipo === "pagar" ? "text-amber-300" : "text-sky-300",
                        )}
                      >
                        {ev.tipo === "pagar" ? "−" : "+"}
                        {formatBRL(ev.valor)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal do dia */}
      <Dialog open={!!diaSelecionado} onOpenChange={(o) => !o && setDiaSelecionado(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{dataSelecionadaLabel}</DialogTitle>
            <DialogDescription>
              {eventosDoDia.length === 0
                ? "Nenhum lançamento financeiro neste dia."
                : `${eventosDoDia.length} ${eventosDoDia.length === 1 ? "lançamento" : "lançamentos"}`}
            </DialogDescription>
          </DialogHeader>

          {eventosDoDia.length > 0 && (
            <ul className="space-y-2">
              {eventosDoDia.map((ev) => {
                const info = statusInfo(ev.status, ev.tipo);
                const Icon =
                  ev.status === "atrasado"
                    ? AlertTriangle
                    : ev.status === "pago" || ev.status === "recebido"
                      ? CheckCircle2
                      : ev.tipo === "pagar"
                        ? ArrowDown
                        : ArrowUp;
                return (
                  <li key={ev.id}>
                    <Link
                      to={ev.href}
                      onClick={() => setDiaSelecionado(null)}
                      className="flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3 transition-colors hover:bg-accent/60"
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                          ev.tipo === "pagar"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-sky-500/15 text-sky-300",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ev.titulo}</p>
                        <p className={cn("mt-0.5 text-xs", info.tone)}>{info.label}</p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-semibold",
                          ev.tipo === "pagar" ? "text-amber-300" : "text-sky-300",
                        )}
                      >
                        {ev.tipo === "pagar" ? "−" : "+"}
                        {formatBRL(ev.valor)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
