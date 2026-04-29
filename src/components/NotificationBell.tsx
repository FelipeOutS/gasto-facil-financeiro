import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  AlertTriangle,
  Clock,
  CalendarClock,
  CheckCircle2,
  PieChart as PieChartIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { Categoria, ContaAPagar, Gasto } from "@/lib/types";
import {
  buildResumoAlertas,
  textoSeveridade,
  type AlertaConta,
  type SeveridadeAlerta,
} from "@/lib/alertas-contas";
import {
  buildAlertasOrcamento,
  buildLinhasOrcamento,
  textoAlertaOrcamento,
  type AlertaOrcamento,
} from "@/lib/orcamento";

function formatDataCurta(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function severityMeta(sev: SeveridadeAlerta) {
  switch (sev) {
    case "atrasada":
      return {
        icon: AlertTriangle,
        toneText: "text-destructive",
        toneBg: "bg-destructive/10",
        badgeClass: "bg-destructive/15 text-destructive",
      };
    case "hoje":
      return {
        icon: Clock,
        toneText: "text-amber-600 dark:text-amber-400",
        toneBg: "bg-amber-500/10",
        badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    case "amanha":
      return {
        icon: Clock,
        toneText: "text-amber-600 dark:text-amber-400",
        toneBg: "bg-amber-500/10",
        badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    case "em7":
      return {
        icon: CalendarClock,
        toneText: "text-[hsl(var(--brand))]",
        toneBg: "bg-[hsl(var(--brand))]/10",
        badgeClass: "bg-[hsl(var(--brand))]/15 text-[hsl(var(--brand))]",
      };
  }
}

function alertaTexto(a: AlertaConta): string {
  switch (a.severidade) {
    case "atrasada":
      return `Venceu em ${formatDataCurta(a.conta.dataVencimento)}.`;
    case "hoje":
      return "Vence hoje. Melhor resolver agora.";
    case "amanha":
      return "Vence amanhã.";
    case "em7":
      return `Está chegando: vence em ${a.dias} dias.`;
  }
}

function orcamentoMeta(status: AlertaOrcamento["status"]) {
  if (status === "estouro") {
    return {
      toneText: "text-destructive",
      toneBg: "bg-destructive/10",
      badgeClass: "bg-destructive/15 text-destructive",
      label: "Estourou",
    };
  }
  return {
    toneText: "text-amber-600 dark:text-amber-400",
    toneBg: "bg-amber-500/10",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    label: "Atenção",
  };
}

export interface OrcamentoAlertSource {
  categorias: Categoria[];
  gastos: Gasto[];
  mes: number;
  ano: number;
  getLimite: (catId: string) => number | undefined;
}

export function NotificationBell({
  contas,
  orcamento,
}: {
  contas: ContaAPagar[];
  orcamento?: OrcamentoAlertSource;
}) {
  const [open, setOpen] = useState(false);
  const resumo = useMemo(() => buildResumoAlertas(contas), [contas]);
  const alertas = resumo.todos;

  const alertasOrcamento = useMemo<AlertaOrcamento[]>(() => {
    if (!orcamento) return [];
    const linhas = buildLinhasOrcamento(
      orcamento.categorias,
      orcamento.gastos,
      orcamento.mes,
      orcamento.ano,
      orcamento.getLimite,
    );
    return buildAlertasOrcamento(linhas);
  }, [orcamento]);

  const totalContas = resumo.totalRelevantes;
  const totalOrcamento = alertasOrcamento.length;
  const totalEstourosOrc = alertasOrcamento.filter((a) => a.status === "estouro").length;
  const count = totalContas + totalOrcamento;
  const hasUrgente = resumo.atrasadas.length > 0 || totalEstourosOrc > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `${count} alertas` : "Sem alertas"}
          className={cn(
            "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            "border border-border/60 bg-card/60 backdrop-blur transition-all",
            "hover:bg-accent hover:border-border",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Bell
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              count > 0 ? "text-foreground" : "text-muted-foreground",
              count > 0 && !open && "motion-safe:animate-[bell-shake_2.4s_ease-in-out_infinite]",
            )}
          />
          {count > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1",
                "text-[10px] font-bold leading-none text-white shadow-sm",
                "motion-safe:animate-[badge-pop_280ms_ease-out]",
                hasUrgente ? "bg-destructive" : "bg-amber-500",
              )}
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] p-0 overflow-hidden border-border/70 shadow-xl"
      >
        <div className="px-4 pt-4 pb-3 border-b border-border/60">
          <h3 className="text-base font-semibold leading-tight">Alertas</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Contas e orçamentos que merecem sua atenção.
          </p>
        </div>

        {count === 0 ? (
          <div className="px-6 py-8 text-center motion-safe:animate-fade-in">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-3 text-sm font-semibold">Nenhum alerta no momento.</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Pode respirar tranquilo. Nada urgente no radar.
            </p>
          </div>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto stagger">
            {alertas.map((a, i) => {
              const meta = severityMeta(a.severidade);
              const Icon = meta.icon;
              return (
                <li
                  key={`c-${a.id}`}
                  className={cn(
                    "flex gap-3 px-4 py-3 border-b border-border/40 last:border-b-0",
                    "motion-safe:animate-rise",
                  )}
                  style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      meta.toneBg,
                    )}
                  >
                    <Icon className={cn("h-4 w-4", meta.toneText)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{a.conta.nome}</p>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          meta.badgeClass,
                        )}
                      >
                        {textoSeveridade(a.severidade, a.dias)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{alertaTexto(a)}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-sm font-bold tabular-nums">
                        {formatBRL(a.conta.valor)}
                      </span>
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setOpen(false)}
                      >
                        <Link to="/contas-a-pagar">Ver conta</Link>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}

            {alertasOrcamento.map((a, i) => {
              const meta = orcamentoMeta(a.status);
              return (
                <li
                  key={`o-${a.catId}`}
                  className={cn(
                    "flex gap-3 px-4 py-3 border-b border-border/40 last:border-b-0",
                    "motion-safe:animate-rise",
                  )}
                  style={{ animationDelay: `${Math.min((alertas.length + i) * 50, 300)}ms` }}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      meta.toneBg,
                    )}
                  >
                    <PieChartIcon className={cn("h-4 w-4", meta.toneText)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">Orçamento de {a.nome}</p>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          meta.badgeClass,
                        )}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {textoAlertaOrcamento(a)}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-sm font-bold tabular-nums">
                        {formatBRL(a.realizado)}{" "}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          / {formatBRL(a.planejado)}
                        </span>
                      </span>
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setOpen(false)}
                      >
                        <Link to="/orcamento">Ver orçamento</Link>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {count > 0 && (
          <div className="border-t border-border/60 px-3 py-2 flex gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="flex-1 justify-center text-xs"
              onClick={() => setOpen(false)}
            >
              <Link to="/contas-a-pagar">Contas</Link>
            </Button>
            {totalOrcamento > 0 && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="flex-1 justify-center text-xs"
                onClick={() => setOpen(false)}
              >
                <Link to="/orcamento">Orçamento</Link>
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
