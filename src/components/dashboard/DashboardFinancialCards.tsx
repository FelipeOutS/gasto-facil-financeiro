import { BrandMascot } from "../BrandMascot";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Wallet,
  Plus,
  ArrowUp,
  Receipt as ReceiptIcon,
  Sparkles,
  PieChart as PieChartIcon,
  AlertTriangle,
} from "lucide-react";
import { Money } from "@/components/Money";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { getCategoriaById } from "@/lib/store";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SaldoHeroCard({
  saldo,
  entradas,
  despesas,
}: {
  saldo: number;
  entradas: number;
  despesas: number;
}) {
  const { t } = useTranslation("dashboard");
  const negativo = saldo < 0;
  const pctReceita =
    entradas > 0 ? Math.min(100, Math.max(0, ((entradas - despesas) / entradas) * 100)) : 0;
  return (
    <div className="premium-balance relative overflow-hidden rounded-2xl border border-border bg-card p-3.5 shadow-elevated sm:p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_75%_at_0%_0%,var(--brand-soft),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-brand/20 blur-3xl"
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Resultado do mês
          </p>
          <Money
            value={saldo}
            className={cn(
              "num mt-1.5 block [overflow-wrap:anywhere] text-[28px] font-bold leading-none tracking-tight sm:text-[32px]",
              negativo ? "text-destructive" : "text-foreground",
            )}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("kpi.saldoNoMes")}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
          <Wallet className="h-5 w-5" />
        </span>
      </div>

      {/* Mini-barra entradas vs saídas */}
      <div className="relative mt-4">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-card-elevated">
          <div
            className="h-full bg-success transition-all"
            style={{
              width: `${entradas + despesas === 0 ? 0 : (entradas / (entradas + despesas)) * 100}%`,
            }}
          />
          <div
            className="h-full bg-destructive/80 transition-all"
            style={{
              width: `${entradas + despesas === 0 ? 0 : (despesas / (entradas + despesas)) * 100}%`,
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="num font-semibold text-foreground">{formatBRLCompact(entradas)}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="num font-semibold text-foreground">{formatBRLCompact(despesas)}</span>
            <span className="h-2 w-2 rounded-full bg-destructive/80" />
          </span>
        </div>
      </div>

      {entradas > 0 && !negativo && (
        <p className="num relative mt-3 text-[11px] text-muted-foreground">
          {t("kpi.receitaPreservada", { pct: Math.round(pctReceita) })}
        </p>
      )}
    </div>
  );
}

export function QuickActionsBar() {
  const { t } = useTranslation("dashboard");
  const items: Array<{
    to: string;
    label: string;
    icon: React.ReactNode;
    tone: "primary" | "success" | "warning" | "brand";
  }> = [
    {
      to: "/adicionar",
      label: t("quickActions.novoGasto"),
      icon: <Plus className="h-4 w-4" />,
      tone: "primary",
    },
    {
      to: "/renda/nova",
      label: t("quickActions.novaReceita"),
      icon: <ArrowUp className="h-4 w-4" />,
      tone: "success",
    },
    {
      to: "/cartoes",
      label: t("quickActions.importar"),
      icon: <ReceiptIcon className="h-4 w-4" />,
      tone: "warning",
    },
    {
      to: "/gasto-ai",
      label: t("quickActions.ia"),
      icon: <Sparkles className="h-4 w-4" />,
      tone: "brand",
    },
  ];
  const toneRing: Record<string, string> = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    brand: "bg-brand-soft text-brand-on-soft",
  };
  return (
    <nav
      aria-label={t("quickActions.title")}
      className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4 sm:gap-2.5 xl:grid-cols-2 2xl:grid-cols-4"
    >
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className={cn(
            "card-press hover-lift group flex min-h-[56px] items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-card transition-colors hover:border-brand/50 hover:bg-card-elevated",
            (it.to === "/adicionar" || it.to === "/renda/nova") && "hidden lg:flex",
          )}
        >
          <span
            className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", toneRing[it.tone])}
          >
            {it.icon}
          </span>
          <span className="truncate text-[12px] font-semibold leading-tight text-foreground">
            {it.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}

export function KpiCard({
  label,
  valueNum,
  icon,
  tone = "brand",
  hint,
}: {
  label: string;
  valueNum: number;
  icon: React.ReactNode;
  tone?: "brand" | "success" | "destructive" | "warning";
  hint?: string;
}) {
  const toneRing = {
    brand: "bg-brand-soft text-brand-on-soft",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/15 text-destructive",
    warning: "bg-warning/15 text-warning",
  }[tone];
  const toneBar = {
    brand: "bg-brand",
    success: "bg-success",
    destructive: "bg-destructive",
    warning: "bg-warning",
  }[tone];
  return (
    <div className="premium-kpi group relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-card transition-colors sm:p-3.5">
      <span aria-hidden className={cn("absolute left-0 top-0 h-full w-[3px]", toneBar)} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-lg", toneRing)}>{icon}</span>
      </div>
      <Money
        value={valueNum}
        className="num mt-2 block [overflow-wrap:anywhere] text-[18px] font-bold leading-tight tracking-tight sm:text-[19px]"
      />
      {hint && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LimiteMensalCard({
  total,
  limiteTotal,
  usoLimite,
  passouLimite,
  proximoLimite,
  className,
}: {
  total: number;
  limiteTotal: number;
  usoLimite: number;
  passouLimite: boolean;
  proximoLimite: boolean;
  className?: string;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <section
      className={cn("w-full rounded-2xl border border-border bg-card p-4 shadow-card", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("limiteMensal.eyebrow")}
          </p>
          <p className="num mt-1 text-sm font-semibold">
            {formatBRL(total)}{" "}
            <span className="font-normal text-muted-foreground">/ {formatBRL(limiteTotal)}</span>
          </p>
        </div>
        <Link
          to="/orcamento"
          aria-label="Abrir orçamento"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border"
        >
          <PieChartIcon className="h-4 w-4 shrink-0 text-brand" />
        </Link>
      </div>
      <div
        role="progressbar"
        aria-label="Uso do limite mensal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.max(0, usoLimite))}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-card-elevated"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all animate-fill",
            passouLimite ? "bg-destructive" : proximoLimite ? "bg-warning" : "bg-brand",
          )}
          style={{ width: `${Math.min(100, usoLimite)}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {limiteTotal > 0 ? "Disponível no limite:" : "Defina seu limite em Orçamento."}{" "}
        {limiteTotal > 0 && (
          <strong className="text-foreground">{formatBRL(Math.max(0, limiteTotal - total))}</strong>
        )}
      </p>
      {passouLimite ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("limiteMensal.ultrapassado", { valor: formatBRL(total - limiteTotal) })}
        </p>
      ) : proximoLimite ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("limiteMensal.quase", {
            pct: Math.round(limiteTotal > 0 ? (total / limiteTotal) * 100 : 0),
          })}
        </p>
      ) : (
        <p className="num mt-2 text-[11px] text-muted-foreground">
          {limiteTotal > 0 ? t("limiteMensal.usado", { pct: Math.round((total / limiteTotal) * 100) }) : "Limite não configurado"}
        </p>
      )}
    </section>
  );
}

export function RecentTransactionsCard({ ultimos }: { ultimos: import("@/lib/types").Gasto[] }) {
  const { t, i18n } = useTranslation("dashboard");
  const dateLocale = i18n.language === "en" ? "en-US" : "pt-BR";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(ultimos.map((g) => g.categoriaId))];
  const filtered = ultimos.filter(
    (g) =>
      (!category || g.categoriaId === category) &&
      `${g.estabelecimento ?? ""} ${g.descricao ?? ""} ${getCategoriaById(g.categoriaId)?.nome ?? ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="flex w-full flex-col rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("atividade.eyebrow")}
          </p>
          <h2 className="mt-0.5 text-base font-semibold sm:text-lg">Últimas movimentações</h2>
        </div>
        <Link
          to="/gastos"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("atividade.verTudo")}
        </Link>
      </div>
      <div className="premium-transactions-tools">
        <input
          aria-label="Buscar nas movimentações recentes"
          placeholder="Buscar movimentações recentes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filtrar categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {categories.map((id) => (
            <option key={id} value={id}>
              {getCategoriaById(id)?.nome ?? "Outros"}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center animate-fade-in">
            <BrandMascot pose="analitico" className="gi-mascot-empty" />
            <p className="mt-2 text-xs text-muted-foreground">
              {query || category
                ? "Nenhuma movimentação encontrada nesta lista."
                : t("atividade.vazio")}
            </p>
            {query || category ? (
              <button
                type="button"
                className="mt-2 min-h-11 text-sm underline"
                onClick={() => {
                  setQuery("");
                  setCategory("");
                }}
              >
                Limpar busca
              </button>
            ) : (
              <Link
                to="/adicionar"
                className="mt-2 text-xs font-medium underline hover:text-foreground transition-colors"
              >
                {t("atividade.primeiro")}
              </Link>
            )}
          </div>
        ) : (
          <>
            <table className="premium-transactions-table hidden lg:table">
              <caption className="sr-only">Movimentações recentes</caption>
              <thead>
                <tr>
                  <th scope="col">Descrição</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Data</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 5).map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link to="/gastos" className="font-medium underline-offset-4 hover:underline">
                        <span className="inline-flex items-center gap-2">
                          <TransactionAvatar
                            size="sm"
                            estabelecimento={g.estabelecimento}
                            categoria={getCategoriaById(g.categoriaId)}
                          />
                          {g.estabelecimento || g.descricao}
                        </span>
                      </Link>
                    </td>
                    <td>{getCategoriaById(g.categoriaId)?.nome ?? t("atividade.outros")}</td>
                    <td className="whitespace-nowrap">
                      {new Date(g.data + "T00:00:00").toLocaleDateString(dateLocale)}
                    </td>
                    <td className="num text-destructive">-{formatBRL(g.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="space-y-2 lg:hidden">
              {filtered.slice(0, 5).map((g) => {
                const cat = getCategoriaById(g.categoriaId);
                return (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 rounded-2xl bg-card-elevated/60 p-2.5 hover-lift hover:bg-card-elevated"
                  >
                    <TransactionAvatar estabelecimento={g.estabelecimento} categoria={cat} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {g.estabelecimento || g.descricao}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {cat?.nome ?? t("atividade.outros")} ·{" "}
                        {new Date(g.data + "T00:00:00").toLocaleDateString(dateLocale)}
                      </p>
                    </div>
                    <p className="num shrink-0 text-sm font-semibold text-destructive">
                      -{formatBRL(g.valor)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
