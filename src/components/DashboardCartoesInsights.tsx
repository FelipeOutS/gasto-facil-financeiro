/**
 * DashboardCartoesInsights — seções inteligentes do dashboard inicial.
 *
 * Reaproveita 100% das estruturas existentes (store, BrandLogo,
 * TransactionAvatar, CategoryIcon, getCategoriaById, statusEfetivoFatura,
 * gastosDaFatura, cicloFatura, getCartoes). Não refaz nada de cartão/fatura
 * nem do sistema de logos.
 *
 * Inclui:
 *   1) Cartões com maior uso no mês (top 3)
 *   2) Próximos vencimentos de fatura (≤ 10 dias, exceto pagas)
 *   3) Maiores gastos do mês (top 5)
 *   4) Insight do mês + comparação com mês anterior
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  CreditCard,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  Flame,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import {
  getCartoes,
  getCategoriaById,
  cicloFatura,
  gastosDaFatura,
  statusEfetivoFatura,
  faturaCorrente,
  useStore,
} from "@/lib/store";
import { formatBRL, parseDateLocal } from "@/lib/format";
import type { Gasto, StatusFatura } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  mes: number;
  ano: number;
  /** Gastos do mês corrente (já filtrados/confirmados) — vindos do dashboard. */
  gastosMes: Gasto[];
  /** Total de despesas do mês corrente. */
  totalMes: number;
  /** Total de despesas do mês anterior — para comparação. */
  totalMesAnterior: number;
  /** Maior categoria do mês (já calculada no dashboard). */
  maiorCategoria?: { nome: string; valor: number; pct: number } | null;
  /** Abre o detalhe da fatura no Drawer existente em /cartoes. */
  onAbrirFatura?: (cartaoId: string, mes: number, ano: number) => void;
  className?: string;
  /**
   * Permite renderizar somente um subconjunto dos cards, para que o dashboard
   * monte uma grade de 12 colunas distribuindo Insight + Cartões em uma
   * coluna lateral e Próximos vencimentos + Maiores gastos em uma linha
   * inferior. `undefined` = comportamento legado (renderiza tudo).
   */
  slot?: "insights" | "lists";
};

const STATUS_TONE: Record<StatusFatura, string> = {
  aberta: "bg-brand-soft text-brand-on-soft",
  fechada: "bg-warning/15 text-warning",
  vencida: "bg-destructive/15 text-destructive",
  paga: "bg-success/15 text-success",
};

function diffDays(target: Date, hoje: Date): number {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const b = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

export function DashboardCartoesInsights({
  mes,
  ano,
  gastosMes,
  totalMes,
  totalMesAnterior,
  maiorCategoria,
  onAbrirFatura,
  className,
  slot,
}: Props) {
  const { t, i18n } = useTranslation("dashboard");
  const locale = i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "pt-BR";
  // Re-renderiza quando store de cartões/faturas mudar.
  useStore(() => getCartoes().length);
  const cartoes = useStore(() => getCartoes());

  const hoje = useMemo(() => new Date(), []);

  /* -------------------- Cartões com maior uso -------------------- */
  const usoCartoes = useMemo(() => {
    return cartoes
      .map((c) => {
        // Usa o ciclo corrente do cartão (não o mês de calendário do dashboard).
        const { mes: mesCorr, ano: anoCorr } = faturaCorrente(c, hoje);
        const gastos = gastosDaFatura(c.id, mesCorr, anoCorr);
        const usado = gastos.reduce((s, g) => s + g.valor, 0);
        const limite = c.limiteTotal || 0;
        const pct = limite > 0 ? Math.min(150, (usado / limite) * 100) : 0;
        const status = statusEfetivoFatura(c, mesCorr, anoCorr, hoje);
        return {
          cartao: c,
          usado,
          limite,
          pct,
          qtd: gastos.length,
          status,
          mes: mesCorr,
          ano: anoCorr,
        };
      })
      .filter((u) => u.qtd > 0 || u.usado > 0)
      .sort((a, b) => b.usado - a.usado)
      .slice(0, 3);
  }, [cartoes, hoje]);

  /* -------------------- Próximos vencimentos de fatura -------------------- */
  const proximosVencimentos = useMemo(() => {
    const items: Array<{
      cartaoId: string;
      cartaoNome: string;
      banco: string;
      cor: string;
      mes: number;
      ano: number;
      dataVencimento: Date;
      diasRestantes: number;
      total: number;
      status: StatusFatura;
    }> = [];

    for (const c of cartoes) {
      // Fatura corrente do cartão (próximo vencimento real, não mês de calendário).
      const { mes: mesCorr, ano: anoCorr } = faturaCorrente(c, hoje);
      const status = statusEfetivoFatura(c, mesCorr, anoCorr, hoje);
      if (status === "paga") continue;
      // Não anuncia vencimento enquanto a fatura ainda está ABERTA — o
      // vencimento real é da fatura aberta (depois do próximo fechamento).
      if (status === "aberta") continue;
      const diaVenc = c.diaVencimento ?? 10;
      const diaFech = c.diaFechamento ?? 1;
      // mes/ano = mês de referência (compras). Vencimento ocorre no mês
      // seguinte (ou no próprio mês de fechamento se diaVenc>=diaFech).
      let dataVenc = new Date(anoCorr, mesCorr, diaVenc);
      const dataFech = new Date(anoCorr, mesCorr, diaFech);
      if (dataVenc.getTime() < dataFech.getTime()) {
        dataVenc = new Date(anoCorr, mesCorr + 1, diaVenc);
      }
      const dias = diffDays(dataVenc, hoje);
      // Mostra somente o que vence em <=10 dias OU já está vencida.
      if (dias > 10 && status !== "vencida") continue;
      const gastos = gastosDaFatura(c.id, mesCorr, anoCorr);
      const total = gastos.reduce((s, g) => s + g.valor, 0);
      items.push({
        cartaoId: c.id,
        cartaoNome: c.nome,
        banco: c.banco,
        cor: c.cor,
        mes: mesCorr,
        ano: anoCorr,
        dataVencimento: dataVenc,
        diasRestantes: dias,
        total,
        status,
      });
    }
    return items
      .sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime())
      .slice(0, 4);
  }, [cartoes, hoje]);

  /* -------------------- Maiores gastos do mês -------------------- */
  const maioresGastos = useMemo(() => {
    return [...gastosMes].sort((a, b) => b.valor - a.valor).slice(0, 5);
  }, [gastosMes]);

  /* -------------------- Insight + comparação -------------------- */
  const comparacao = useMemo(() => {
    if (totalMesAnterior <= 0 && totalMes <= 0) return null;
    const diff = totalMes - totalMesAnterior;
    const pct = totalMesAnterior > 0 ? (diff / totalMesAnterior) * 100 : null;
    return { diff, pct };
  }, [totalMes, totalMesAnterior]);

  const insight = useMemo(() => {
    // Prioridades de insight, em ordem.
    const vencidas = proximosVencimentos.filter((p) => p.status === "vencida");
    if (vencidas.length > 0) {
      const v = vencidas[0];
      return {
        tone: "destructive" as const,
        text: t("cartoesInsights.faturaVencida", { cartao: v.cartaoNome }),
      };
    }
    const proximaQueVence = proximosVencimentos.find(
      (p) => p.status !== "paga" && p.diasRestantes >= 0 && p.diasRestantes <= 5,
    );
    if (proximaQueVence) {
      const unit =
        proximaQueVence.diasRestantes === 1
          ? t("cartoesInsights.diaSing")
          : t("cartoesInsights.diaPlur");
      return {
        tone: "warning" as const,
        text: t("cartoesInsights.venceEmDias", {
          cartao: proximaQueVence.cartaoNome,
          dias: proximaQueVence.diasRestantes,
          unit,
        }),
      };
    }
    const cartaoEstourando = usoCartoes.find((u) => u.limite > 0 && u.pct >= 80);
    if (cartaoEstourando) {
      return {
        tone: "warning" as const,
        text: t("cartoesInsights.limitePct", {
          pct: Math.round(cartaoEstourando.pct),
          cartao: cartaoEstourando.cartao.nome,
        }),
      };
    }
    if (maiorCategoria && maiorCategoria.pct >= 30) {
      return {
        tone: "info" as const,
        text: t("cartoesInsights.maiorGastoCat", {
          cat: maiorCategoria.nome,
          pct: Math.round(maiorCategoria.pct),
        }),
      };
    }
    if (gastosMes.length === 0) {
      return {
        tone: "info" as const,
        text: t("cartoesInsights.addMais"),
      };
    }
    return {
      tone: "success" as const,
      text: t("cartoesInsights.tudoCerto"),
    };
  }, [proximosVencimentos, usoCartoes, maiorCategoria, gastosMes.length, t]);

  const temAlgumaSecao =
    usoCartoes.length > 0 || proximosVencimentos.length > 0 || maioresGastos.length > 0;

  if (!temAlgumaSecao && !comparacao) return null;

  const showInsight = slot !== "lists";
  const showCartoes = slot !== "lists";
  const showVenc = slot !== "insights";
  const showMaiores = slot !== "insights";

  // Quando o dashboard pede só um slot, evita renderizar um wrapper vazio.
  if (slot === "lists" && proximosVencimentos.length === 0 && maioresGastos.length === 0)
    return null;
  if (slot === "insights" && usoCartoes.length === 0 && !comparacao) return null;

  const containerCls =
    slot === "insights"
      ? "flex h-full flex-col gap-3.5 sm:gap-4 [&>section:last-child]:flex-1"
      : slot === "lists"
        ? "grid grid-cols-1 gap-3.5 lg:grid-cols-2 lg:gap-4 [&>*:only-child]:lg:col-span-2"
        : "grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4";

  return (
    <div className={cn(containerCls, className)}>
      {/* Insight + comparação */}
      {showInsight && (
        <section className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4 ">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                insight.tone === "destructive" && "bg-destructive/15 text-destructive",
                insight.tone === "warning" && "bg-warning/15 text-warning",
                insight.tone === "info" && "bg-brand-soft text-brand-on-soft",
                insight.tone === "success" && "bg-success/15 text-success",
              )}
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("cartoesInsights.insightLabel")}
              </p>
              <p className="mt-1 text-sm font-medium leading-relaxed">{insight.text}</p>
              {comparacao && (
                <ComparacaoMesAnterior
                  diff={comparacao.diff}
                  pct={comparacao.pct}
                  totalMes={totalMes}
                  totalMesAnterior={totalMesAnterior}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Cartões com maior uso */}
      {showCartoes && usoCartoes.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4 ">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("cartoesInsights.maiorUso")}</h2>
            </div>
            <Link
              to="/cartoes"
              search={{ abrir: undefined }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cartoesInsights.verTodos")}
            </Link>
          </div>
          <ul className="mt-3 space-y-2.5">
            {usoCartoes.map((u) => {
              const passou = u.limite > 0 && u.usado > u.limite;
              const proximo = u.limite > 0 && u.pct >= 80 && !passou;
              const barColor = passou ? "bg-destructive" : proximo ? "bg-warning" : "bg-brand";
              return (
                <li
                  key={u.cartao.id}
                  className="card-press rounded-2xl border border-border bg-card-elevated/40 p-3 transition-colors hover:bg-card-elevated"
                  onClick={() => onAbrirFatura?.(u.cartao.id, u.mes, u.ano)}
                  role={onAbrirFatura ? "button" : undefined}
                  tabIndex={onAbrirFatura ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (!onAbrirFatura) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onAbrirFatura(u.cartao.id, u.mes, u.ano);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl"
                      style={{ background: u.cartao.cor }}
                    >
                      <BrandLogo
                        name={u.cartao.banco}
                        variant="bank"
                        onDark
                        className="h-6 w-12"
                        imgClassName="object-left"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{u.cartao.nome}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {u.qtd}{" "}
                        {u.qtd === 1
                          ? t("cartoesInsights.compraSing")
                          : t("cartoesInsights.compraPlur")}{" "}
                        ·{" "}
                        {u.limite > 0
                          ? t("cartoesInsights.usadoDe", {
                              usado: formatBRL(u.usado),
                              limite: formatBRL(u.limite),
                            })
                          : formatBRL(u.usado)}
                      </p>
                    </div>
                    {u.limite > 0 && (
                      <p
                        className={cn(
                          "num shrink-0 text-xs font-semibold",
                          passou
                            ? "text-destructive"
                            : proximo
                              ? "text-warning"
                              : "text-muted-foreground",
                        )}
                      >
                        {Math.round(u.pct)}%
                      </p>
                    )}
                  </div>
                  {u.limite > 0 && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card-elevated">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.min(100, u.pct)}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Próximos vencimentos de fatura */}
      {showVenc && proximosVencimentos.length > 0 && (
        <section
          className={cn(
            "rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4",
            slot !== "lists" && "sm:col-span-2",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("cartoesInsights.proxVenc")}</h2>
            </div>
            <Link
              to="/cartoes"
              search={{ abrir: undefined }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cartoesInsights.irCartoes")}
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {proximosVencimentos.map((p) => {
              const dias = p.diasRestantes;
              const absDias = Math.abs(dias);
              const unit =
                absDias === 1 ? t("cartoesInsights.diaSing") : t("cartoesInsights.diaPlur");
              const labelDias =
                p.status === "vencida"
                  ? t("cartoesInsights.vencidaHa", { dias: absDias, unit })
                  : dias === 0
                    ? t("cartoesInsights.venceHoje")
                    : dias === 1
                      ? t("cartoesInsights.venceAmanha")
                      : t("cartoesInsights.faltamDias", { dias });
              return (
                <li key={`${p.cartaoId}-${p.mes}-${p.ano}`}>
                  <button
                    type="button"
                    onClick={() => onAbrirFatura?.(p.cartaoId, p.mes, p.ano)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card-elevated/40 p-3 text-left transition-colors hover:bg-card-elevated"
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl"
                      style={{ background: p.cor }}
                    >
                      <BrandLogo
                        name={p.banco}
                        variant="bank"
                        onDark
                        className="h-6 w-12"
                        imgClassName="object-left"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{p.cartaoNome}</p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            STATUS_TONE[p.status],
                          )}
                        >
                          {t(`cartoesInsights.status.${p.status}`)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {t("cartoesInsights.venceDia", {
                          dia: p.dataVencimento.getDate().toString().padStart(2, "0"),
                        })}{" "}
                        ·{" "}
                        <span
                          className={cn(
                            p.status === "vencida"
                              ? "text-destructive"
                              : dias <= 3
                                ? "text-warning"
                                : "text-muted-foreground",
                          )}
                        >
                          {labelDias}
                        </span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-sm font-semibold">{formatBRL(p.total)}</p>
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Maiores gastos do mês */}
      {showMaiores && maioresGastos.length > 0 && (
        <section
          className={cn(
            "rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4",
            slot !== "lists" && "sm:col-span-2",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("cartoesInsights.maioresGastos")}</h2>
            </div>
            <Link
              to="/gastos"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cartoesInsights.verTudo")}
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {maioresGastos.map((g) => {
              const cat = getCategoriaById(g.categoriaId);
              const d = parseDateLocal(g.data);
              const dataLabel = d
                ? d.toLocaleDateString(locale, { day: "2-digit", month: "short" })
                : "";
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card-elevated/40 p-3"
                >
                  <TransactionAvatar estabelecimento={g.estabelecimento} categoria={cat} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.estabelecimento || g.descricao}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {cat?.nome ?? t("cartoesInsights.outros")}
                      {dataLabel ? ` · ${dataLabel}` : ""}
                    </p>
                  </div>
                  <p className="num shrink-0 text-sm font-semibold">{formatBRL(g.valor)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function ComparacaoMesAnterior({
  diff,
  pct,
  totalMes,
  totalMesAnterior,
}: {
  diff: number;
  pct: number | null;
  totalMes: number;
  totalMesAnterior: number;
}) {
  const { t } = useTranslation("dashboard");
  if (totalMes === 0 && totalMesAnterior === 0) return null;
  if (totalMesAnterior === 0) {
    return <p className="mt-2 text-[11px] text-muted-foreground">{t("cartoesInsights.compAdd")}</p>;
  }
  const subiu = diff > 0;
  const igual = Math.abs(diff) < 0.5;
  if (igual) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {t("cartoesInsights.compIgual")}
      </p>
    );
  }
  const Icon = subiu ? TrendingUp : TrendingDown;
  const direcao = subiu ? t("cartoesInsights.amais") : t("cartoesInsights.amenos");
  return (
    <p
      className={cn(
        "mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium",
        subiu ? "text-destructive" : "text-success",
      )}
    >
      <Icon className="h-3 w-3" />
      {t("cartoesInsights.compDiff", { valor: formatBRL(Math.abs(diff)), direcao })}
      {pct !== null && Math.abs(pct) >= 1 ? ` (${subiu ? "+" : ""}${Math.round(pct)}%)` : ""}.
    </p>
  );
}

// re-export for type-only consumers (not strictly needed)
export type { StatusFatura };
// Suppress unused import warnings for icons that may not be used in some branches
void AlertTriangle;
