import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, CalendarClock, Wallet, PiggyBank, Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatBRL, formatBRLCompact, formatMonthYear } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  ano: number;
  mes: number;
  saldo: number;
  receitas: number;
  despesas: number;
  guardado: number;
  aPagar: number;
  atrasadasCount: number;
  pendentesCount: number;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Bloco de resumo financeiro pensado para a home mobile.
 * Aparece apenas em telas <lg via `lg:hidden` no parent.
 */
export function MobileMonthSummary({
  ano,
  mes,
  saldo,
  receitas,
  despesas,
  guardado,
  aPagar,
  atrasadasCount,
  pendentesCount,
  onPrev,
  onNext,
}: Props) {
  const { t } = useTranslation("dashboard");
  const [hidden, setHidden] = useState(false);

  return (
    <section aria-label={t("sections.visao")} className="mt-3 animate-rise">
      {/* Cabeçalho — "resumo de {mês}" + switcher */}
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold capitalize tracking-tight">
          <span className="text-muted-foreground font-normal">{t("mobileSummary.eyebrow")}</span>
          <span>{formatMonthYear(ano, mes)}</span>
        </h2>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={onPrev}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground active:scale-95"
            aria-label={t("monthSwitcher.prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground active:scale-95"
            aria-label={t("monthSwitcher.next")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Card grande de saldo */}
      <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
              <PiggyBank className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {t("kpi.saldo")}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-xl font-bold tabular-nums leading-tight",
                  saldo < 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {hidden ? "••••••" : formatBRL(saldo)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHidden((v) => !v)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted active:scale-95"
            aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
          >
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Grid 2x2 de KPIs principais */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5">
        <KpiTile
          label={t("kpi.receitas")}
          value={hidden ? "••••" : formatBRLCompact(receitas)}
          tone="success"
          icon={<ArrowUp className="h-3.5 w-3.5" />}
        />
        <KpiTile
          label={t("kpi.despesas")}
          value={hidden ? "••••" : formatBRLCompact(despesas)}
          tone="destructive"
          icon={<ArrowDown className="h-3.5 w-3.5" />}
        />
        <KpiTile
          label={t("kpi.aPagar")}
          value={hidden ? "••••" : formatBRLCompact(aPagar)}
          tone={atrasadasCount > 0 ? "destructive" : pendentesCount > 0 ? "warning" : "success"}
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          hint={
            atrasadasCount > 0
              ? `${atrasadasCount} ${t("kpi.atrasada")}`
              : pendentesCount > 0
                ? `${pendentesCount} ${t("kpi.pendente")}`
                : t("kpi.tudoEmDia")
          }
        />
        <KpiTile
          label="Guardado"
          value={hidden ? "••••" : formatBRLCompact(guardado)}
          tone="muted"
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: string;
  tone: "success" | "destructive" | "warning" | "muted";
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-md",
            tone === "success" && "bg-success/12 text-success",
            tone === "destructive" && "bg-destructive/12 text-destructive",
            tone === "warning" && "bg-warning/15 text-warning",
            tone === "muted" && "bg-muted text-foreground",
          )}
        >
          {icon}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="mt-1.5 truncate text-base font-bold tabular-nums leading-tight">{value}</p>
      {hint && (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
