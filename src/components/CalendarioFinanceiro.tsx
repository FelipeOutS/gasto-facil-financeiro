import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
} from "lucide-react";
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
import {
  listarContasReceber,
  statusEfetivo as statusReceberEfetivo,
  type ContaReceber,
} from "@/lib/contas-receber";

type EventoTipo = "pagar" | "receber";

type EventoDia = {
  id: string;
  tipo: EventoTipo;
  titulo: string;
  valor: number;
  status: string;
  href: string;
};

const WEEKDAYS_FALLBACK = ["D", "S", "T", "Q", "Q", "S", "S"];

function isoToKey(d: string): string {
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function buildGridDays(ano: number, mes: number): Date[] {
  const first = new Date(ano, mes - 1, 1);
  const startWeekday = first.getDay();
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
  /** Modo compacto para uso lado a lado com outros cards (Dashboard 60/40). */
  compact = false,
}: {
  ano: number;
  mes: number;
  onChangeMonth: (delta: number) => void;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const weekdaysRaw = t("calendario.weekdays", { returnObjects: true }) as unknown;
  const WEEKDAYS: string[] =
    Array.isArray(weekdaysRaw) && weekdaysRaw.length === 7
      ? (weekdaysRaw as string[])
      : WEEKDAYS_FALLBACK;
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
      return {
        dot: "bg-emerald-500",
        label: tipo === "pagar" ? t("calendario.paga") : t("calendario.recebida"),
        tone: "text-emerald-400",
      };
    }
    if (status === "atrasado") {
      return { dot: "bg-rose-500", label: t("calendario.atrasada"), tone: "text-rose-400" };
    }
    if (status === "parcial") {
      return { dot: "bg-amber-500", label: t("calendario.parcial"), tone: "text-amber-400" };
    }
    return tipo === "pagar"
      ? { dot: "bg-amber-400", label: t("calendario.aPagar"), tone: "text-amber-300" }
      : { dot: "bg-sky-400", label: t("calendario.aReceber"), tone: "text-sky-300" };
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
  const localeBcp = i18n.language?.toLowerCase().startsWith("en") ? "en-US" : "pt-BR";
  const dataSelecionadaLabel = diaSelecionado
    ? (parseDateLocal(diaSelecionado) ?? new Date()).toLocaleDateString(localeBcp, {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })
    : "";

  // Em modo compact reduzimos altura mínima das células e escondemos legenda repetida.
  const cellMinH = compact ? "min-h-[52px]" : "min-h-[68px]";

  return (
    <section
      className={cn(
        "relative flex w-full flex-col overflow-hidden rounded-3xl border border-border/80 p-4 shadow-elevated lg:p-5",
        // Fundo premium com leve gradiente
        "bg-gradient-to-br from-card via-card to-card-elevated/60",
      )}
    >
      {/* Glow decorativo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-brand/10 blur-3xl"
      />

      {/* Header */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-on-soft shadow-sm">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {t("calendario.eyebrow")}
            </p>
            <h2 className="mt-0.5 truncate text-base font-bold capitalize tracking-tight lg:text-lg">
              {formatMonthYear(ano, mes)}
            </h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/60 p-1 backdrop-blur">
          <button
            onClick={() => onChangeMonth(-1)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
            aria-label={t("calendario.prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onChangeMonth(1)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
            aria-label={t("calendario.nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KPIs do mês */}
      <div className="relative mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("calendario.aPagar")}
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-amber-300">
            <Money value={resumoMes.pagar} />
          </p>
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("calendario.aReceber")}
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-sky-300">
            <Money value={resumoMes.receber} />
          </p>
        </div>
        <div
          className={cn(
            "rounded-xl border px-2.5 py-2",
            resumoMes.atrasadas > 0
              ? "border-rose-500/30 bg-rose-500/5"
              : "border-border bg-background/40",
          )}
        >
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("calendario.atrasadas")}
          </p>
          <p
            className={cn(
              "mt-0.5 text-sm font-bold",
              resumoMes.atrasadas > 0 ? "text-rose-400" : "text-muted-foreground",
            )}
          >
            {resumoMes.atrasadas}
          </p>
        </div>
      </div>

      {/* Grid 7x6 — desktop / tablet */}
      <div className="relative mt-4 hidden md:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            const valorLiquido = r.receber - r.pagar;

            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDiaSelecionado(iso)}
                className={cn(
                  "group relative flex flex-col rounded-xl border p-1.5 text-left transition-all duration-200",
                  cellMinH,
                  dim
                    ? "border-transparent text-muted-foreground/40 hover:bg-accent/30"
                    : "border-border/60 bg-background/40 hover:-translate-y-0.5 hover:border-brand/50 hover:bg-card-elevated hover:shadow-md",
                  isHoje && !dim && "border-brand/60 bg-brand/5 ring-1 ring-brand/40",
                  hasEvents && !dim && "border-border",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs font-bold leading-none",
                      isHoje && !dim
                        ? "grid h-5 w-5 place-items-center rounded-full bg-brand text-primary-foreground"
                        : "px-0.5",
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {hasEvents && !dim && (
                    <span className="text-[9px] font-medium text-muted-foreground">
                      {evs.length}
                    </span>
                  )}
                </div>

                {hasEvents && !dim && (
                  <div className="mt-auto flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      {r.pagar > 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_4px] shadow-amber-400/50" />
                      )}
                      {r.receber > 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_4px] shadow-sky-400/50" />
                      )}
                      {r.temAtrasada && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_4px] shadow-rose-500/60" />
                      )}
                      {r.temPaga && !r.temAtrasada && r.pagar === 0 && r.receber === 0 && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </div>
                    {(r.pagar > 0 || r.receber > 0) && !compact && (
                      <span
                        className={cn(
                          "truncate text-[10px] font-semibold leading-tight",
                          valorLiquido > 0
                            ? "text-sky-300"
                            : valorLiquido < 0
                              ? "text-amber-300"
                              : "text-muted-foreground",
                        )}
                      >
                        {r.pagar > 0 && r.receber === 0 && `−${formatBRL(r.pagar)}`}
                        {r.receber > 0 && r.pagar === 0 && `+${formatBRL(r.receber)}`}
                        {r.pagar > 0 &&
                          r.receber > 0 &&
                          t("calendario.itens", { count: evs.length })}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legenda — escondida em compact para economizar espaço */}
        {!compact && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> {t("calendario.aPagar")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> {t("calendario.aReceber")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> {t("calendario.atrasada")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />{" "}
              {t("calendario.pagaRecebida")}
            </span>
          </div>
        )}
      </div>

      {/* Mini calendário (mobile) + lista próximos */}
      <div className="relative mt-4 md:hidden">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                  "relative flex aspect-square items-center justify-center rounded-lg text-xs transition-all",
                  dim ? "text-muted-foreground/40" : "text-foreground",
                  isHoje && !dim && "bg-brand text-primary-foreground font-bold shadow-md",
                  evs.length > 0 && !isHoje && !dim && "bg-accent/40 font-semibold",
                )}
              >
                <span>{d.getDate()}</span>
                {evs.length > 0 && !isHoje && (
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
          <p className="text-xs font-semibold text-muted-foreground">
            {t("calendario.proximosVencimentos")}
          </p>
          {proximos.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("calendario.nenhumProximo")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {proximos.map((ev) => {
                const info = statusInfo(ev.status, ev.tipo);
                const dataFmt = (parseDateLocal(ev.iso) ?? new Date()).toLocaleDateString(
                  localeBcp,
                  {
                    day: "2-digit",
                    month: "short",
                  },
                );
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
                ? t("calendario.semLancamentos")
                : eventosDoDia.length === 1
                  ? t("calendario.lancamentoSing", { count: 1 })
                  : t("calendario.lancamentoPlur", { count: eventosDoDia.length })}
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
