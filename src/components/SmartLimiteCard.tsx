import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  TrendingUp,
  Gauge,
  AlertTriangle,
  Wallet,
  ArrowRight,
  Pencil,
  Check,
  X,
  Target,
  Sliders,
} from "lucide-react";
import { Money } from "@/components/Money";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  useStore,
  contaPertenceAoMesRef,
  getContasAPagar,
  statusContaEfetivo,
  getLimite,
  setLimite,
  getGastos,
  mesEfetivoGasto,
} from "@/lib/store";
import { getRecorrencias } from "@/lib/recorrencias";

type Status = "saudavel" | "atencao" | "risco" | "meta_excedida" | "sem_dados";
type CalcMode = "variaveis" | "hoje" | "mes" | "fluxo";

const META_TIPO = "meta_gasto_mensal";
const MODE_KEY = "gf:limite-mode";

const MODE_KEYS: CalcMode[] = ["variaveis", "hoje", "mes", "fluxo"];

function loadMode(): CalcMode {
  if (typeof window === "undefined") return "variaveis";
  const v = window.localStorage.getItem(MODE_KEY);
  if (v === "variaveis" || v === "hoje" || v === "mes" || v === "fluxo") return v;
  return "variaveis";
}

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
  const { t } = useTranslation("dashboard");
  const tMode = (m: CalcMode) => ({
    label: t(`smartLimite.modes.${m}.label`),
    desc: t(`smartLimite.modes.${m}.desc`),
  });
  const contas = useStore(() => getContasAPagar());
  const recorrencias = useStore(() => getRecorrencias());
  const gastos = useStore(() => getGastos());
  const metaSalva = useStore(() => getLimite(META_TIPO, mes, ano)) ?? 0;

  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>(
    metaSalva > 0 ? String(metaSalva).replace(".", ",") : "",
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [mode, setMode] = useState<CalcMode>(() => loadMode());
  const [modeOpen, setModeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (!editing) {
      setInputValue(metaSalva > 0 ? String(metaSalva).replace(".", ",") : "");
    }
  }, [metaSalva, editing]);

  useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing]);

  const calc = useMemo(() => {
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === ano && today.getMonth() + 1 === mes;
    const fimMes = new Date(ano, mes, 0);
    const refDay = isCurrentMonth ? today : new Date(ano, mes - 1, 1);
    const refISO = refDay.toISOString().slice(0, 10);
    const hojeISO = today.toISOString().slice(0, 10);

    const diasNoMes = fimMes.getDate();
    const diasRestantes = isCurrentMonth ? Math.max(1, diasNoMes - today.getDate() + 1) : diasNoMes;

    // Gastos vinculados a contas (liquidação de obrigação) — não são "novos".
    const gastosLigadosAConta = new Set<string>();
    for (const c of contas) if (c.gastoId) gastosLigadosAConta.add(c.gastoId);

    let totalVariaveis = 0;
    let totalObrigacoes = 0;
    const gastosMes = gastos.filter((g) => {
      if (g.confirmado === false) return false;
      const eff = mesEfetivoGasto(g);
      return eff.mes === mes && eff.ano === ano;
    });
    for (const g of gastosMes) {
      const isObrigacao =
        gastosLigadosAConta.has(g.id) ||
        g.gastoFixo === true ||
        g.tipoGasto === "recorrente" ||
        g.formaPagamento === "credito";
      if (isObrigacao) totalObrigacoes += g.valor || 0;
      else totalVariaveis += g.valor || 0;
    }

    let contasPendentesFuturas = 0;
    let contasPendentesAposHoje = 0;
    for (const c of contas) {
      if (!contaPertenceAoMesRef(c, mes, ano)) continue;
      const s = statusContaEfetivo(c, refISO);
      if (s === "pago") continue;
      if (c.gastoId) continue;
      contasPendentesFuturas += c.valor || 0;
      if (c.dataVencimento >= hojeISO) contasPendentesAposHoje += c.valor || 0;
    }

    const fimMesISO = `${ano}-${String(mes).padStart(2, "0")}-${String(diasNoMes).padStart(2, "0")}`;
    const norm = (s: string) =>
      (s ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    let recorrenciasPrev = 0;
    for (const r of recorrencias) {
      if (r.status !== "ativa") continue;
      const prox = r.proximaCobranca;
      if (!prox) continue;
      if (prox < refISO || prox > fimMesISO) continue;
      const nomeR = norm(r.nome);
      const valorR = r.valor || 0;
      const dupConta = contas.some(
        (c) =>
          contaPertenceAoMesRef(c, mes, ano) &&
          statusContaEfetivo(c, refISO) !== "pago" &&
          norm(c.nome) === nomeR,
      );
      // Anti-duplicidade: se já existe gasto da recorrência neste mês de
      // referência (por id ou por nome+valor ±2%), ignora previsão.
      const dupGasto = gastosMes.some((g) => {
        if (g.recorrenciaId && r.id && g.recorrenciaId === r.id) return true;
        const nomeG = norm(g.descricao || g.estabelecimento || "");
        if (!nomeG || nomeG !== nomeR) return false;
        const tol = Math.max(0.01, valorR * 0.02);
        return Math.abs((g.valor || 0) - valorR) <= tol;
      });
      if (dupConta || dupGasto) continue;
      recorrenciasPrev += r.valor || 0;
    }

    let gastosElegiveis: number;
    switch (mode) {
      case "variaveis":
      case "hoje":
        gastosElegiveis = totalVariaveis;
        break;
      case "mes":
        gastosElegiveis = totalVariaveis + totalObrigacoes;
        break;
      case "fluxo":
        gastosElegiveis = totalGastos;
        break;
    }

    const temMeta = metaSalva > 0;
    const restanteMeta = temMeta ? metaSalva - gastosElegiveis : 0;

    const disponivelMes =
      totalEntradas - totalVariaveis - totalObrigacoes - contasPendentesAposHoje - recorrenciasPrev;

    const baseDisponivel = temMeta ? Math.min(restanteMeta, disponivelMes) : disponivelMes;
    const porDia = baseDisponivel / diasRestantes;

    const semDados = totalEntradas <= 0 && gastosElegiveis <= 0 && !temMeta && contas.length === 0;

    let status: Status = "saudavel";
    if (semDados) status = "sem_dados";
    else if (temMeta && restanteMeta < 0) status = "meta_excedida";
    else if (disponivelMes < 0) status = "risco";
    else if (temMeta && restanteMeta / Math.max(1, metaSalva) < 0.2) status = "atencao";
    else if (porDia < 20 || (totalEntradas > 0 && disponivelMes < totalEntradas * 0.1))
      status = "atencao";

    const baseRef = temMeta ? metaSalva : Math.max(1, totalEntradas);
    const totalCommit = temMeta
      ? gastosElegiveis
      : totalVariaveis + totalObrigacoes + contasPendentesAposHoje + recorrenciasPrev;
    const pctUsado = Math.min(100, Math.max(0, (totalCommit / baseRef) * 100));

    return {
      disponivelMes,
      porDia,
      diasRestantes,
      contasPendentes: contasPendentesAposHoje,
      contasPendentesFuturas,
      recorrenciasPrev,
      status,
      pctUsado,
      isCurrentMonth,
      temMeta,
      restanteMeta,
      gastosElegiveis,
      totalVariaveis,
      totalObrigacoes,
    };
  }, [contas, recorrencias, gastos, mes, ano, totalEntradas, totalGastos, metaSalva, mode]);

  const {
    porDia,
    diasRestantes,
    disponivelMes,
    status,
    pctUsado,
    contasPendentes,
    recorrenciasPrev,
    temMeta,
    restanteMeta,
    gastosElegiveis,
    totalObrigacoes,
  } = calc;

  const cfg = STATUS_CONFIG[status];

  const handleSave = () => {
    const normalized = inputValue.trim().replace(/\./g, "").replace(",", ".");
    const v = Number(normalized);
    if (!Number.isFinite(v) || v < 0) return;
    setLimite(META_TIPO, v, mes, ano);
    setEditing(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleClear = () => {
    setLimite(META_TIPO, 0, mes, ano);
    setInputValue("");
    setEditing(false);
  };

  return (
    <section
      className={cn(
        "relative w-full overflow-hidden rounded-3xl border p-4 sm:p-5 shadow-card animate-rise transition-colors",
        // dark
        "dark:bg-gradient-to-br",
        cfg.darkGradient,
        cfg.darkBorder,
        // light
        "bg-gradient-to-br",
        cfg.lightGradient,
        cfg.lightBorder,
      )}
    >
      {/* glow */}
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full blur-3xl opacity-20 dark:opacity-30",
          cfg.glow,
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full blur-3xl opacity-10 dark:opacity-20",
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
              <p className={cn("text-[11px] font-semibold uppercase tracking-widest", cfg.subText)}>
                {t("smartLimite.title")}
              </p>
            </div>
            <p className={cn("mt-2 max-w-md text-xs sm:text-[13px]", cfg.muted)}>
              {tMode(mode).desc}.
            </p>
            <div className="relative mt-2 inline-block">
              <button
                type="button"
                onClick={() => setModeOpen((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors",
                  cfg.btnSecondary,
                )}
              >
                <Sliders className="h-3 w-3" />
                {tMode(mode).label}
              </button>
              {modeOpen && (
                <div
                  className={cn(
                    "absolute z-20 mt-1 w-64 rounded-xl border p-1 shadow-lg backdrop-blur-md animate-fade-in",
                    "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10",
                  )}
                >
                  {MODE_KEYS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        setModeOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                        mode === m
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-slate-100 dark:hover:bg-white/5 text-foreground",
                      )}
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          mode === m ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold">{tMode(m).label}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {tMode(m).desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            {t(`smartLimite.tags.${status}`)}
          </span>
        </div>

        {/* Valor principal */}
        <div className="mt-3 flex items-end gap-2">
          {status === "sem_dados" ? (
            <p className={cn("text-2xl font-bold sm:text-3xl", cfg.valueText)}>—</p>
          ) : (
            <>
              <Money
                value={porDia}
                duration={900}
                className={cn(
                  "num text-3xl font-extrabold leading-none tracking-tight sm:text-4xl",
                  cfg.valueText,
                )}
              />
              <span className={cn("pb-0.5 text-xs font-medium", cfg.muted)}>
                {t("smartLimite.byDay")}
              </span>
              {savedFlash && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/30 animate-fade-in">
                  <Check className="h-3 w-3" /> {t("smartLimite.saved")}
                </span>
              )}
            </>
          )}
        </div>

        {/* Texto explicativo */}
        <p className={cn("mt-2 max-w-xl text-[12px] leading-relaxed", cfg.text)}>
          {getMensagem(
            t,
            status,
            porDia,
            disponivelMes,
            temMeta,
            restanteMeta,
            mode,
            totalObrigacoes,
          )}
        </p>

        {/* Meta mensal — edição inline */}
        <div
          className={cn(
            "mt-3 rounded-2xl p-2.5 ring-1 backdrop-blur-sm transition-all",
            cfg.metaBg,
            cfg.metaRing,
          )}
        >
          {!editing ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full ring-1",
                    cfg.iconBg,
                    cfg.iconRing,
                  )}
                >
                  <Target className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      cfg.subText,
                    )}
                  >
                    {t("smartLimite.metaTitle")}
                  </p>
                  <p className={cn("num truncate text-sm font-bold", cfg.valueText)}>
                    {temMeta ? formatBRL(metaSalva) : t("smartLimite.semMeta")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors",
                  cfg.btnSecondary,
                )}
              >
                <Pencil className="h-3 w-3" />
                {temMeta ? t("smartLimite.editar") : t("smartLimite.definir")}
              </button>
            </div>
          ) : (
            <div className="animate-fade-in">
              <label
                className={cn(
                  "block text-[10px] font-semibold uppercase tracking-wider",
                  cfg.subText,
                )}
              >
                {t("smartLimite.metaTitle")}
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className={cn(
                    "flex flex-1 items-center gap-1.5 rounded-xl px-3 py-2 ring-1 focus-within:ring-2 transition-all",
                    cfg.inputBg,
                    cfg.inputRing,
                  )}
                >
                  <span className={cn("text-xs font-semibold", cfg.muted)}>R$</span>
                  <input
                    ref={inputRef}
                    inputMode="decimal"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    placeholder="0,00"
                    className={cn(
                      "num w-full bg-transparent text-base font-bold outline-none placeholder:opacity-40",
                      cfg.valueText,
                    )}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  className={cn(
                    "inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-bold transition-colors",
                    cfg.btnPrimary,
                  )}
                >
                  <Check className="h-3.5 w-3.5" /> {t("smartLimite.salvar")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 transition-colors",
                    cfg.btnSecondary,
                  )}
                  aria-label={t("smartLimite.cancelar")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {temMeta && (
                <button
                  type="button"
                  onClick={handleClear}
                  className={cn("mt-2 text-[11px] underline-offset-2 hover:underline", cfg.muted)}
                >
                  {t("smartLimite.remover")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Barra de progresso */}
        {status !== "sem_dados" && (
          <div className="mt-3">
            <div
              className={cn(
                "flex items-center justify-between text-[10px] font-medium uppercase tracking-wider",
                cfg.subText,
              )}
            >
              <span>{temMeta ? t("smartLimite.daMetaUsado") : t("smartLimite.comprometido")}</span>
              <span className="num">{Math.round(pctUsado)}%</span>
            </div>
            <div className={cn("mt-1.5 h-2 w-full overflow-hidden rounded-full", cfg.barTrack)}>
              <div
                className={cn("h-full rounded-full transition-all duration-700 ease-out", cfg.bar)}
                style={{ width: `${pctUsado}%` }}
              />
            </div>
          </div>
        )}

        {/* Mini-stats */}
        {status !== "sem_dados" && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
            {temMeta ? (
              <>
                <MiniStat
                  cfg={cfg}
                  icon={<Target className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.meta")}
                  value={formatBRL(metaSalva)}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<Wallet className="h-3.5 w-3.5" />}
                  label={
                    mode === "variaveis"
                      ? t("smartLimite.stat.variaveis")
                      : t("smartLimite.stat.jaGasto")
                  }
                  value={formatBRL(gastosElegiveis)}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.restante")}
                  value={formatBRL(restanteMeta)}
                  tone={restanteMeta < 0 ? "neg" : "pos"}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<Gauge className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.diasRestantes")}
                  value={`${diasRestantes}`}
                />
              </>
            ) : (
              <>
                <MiniStat
                  cfg={cfg}
                  icon={<Wallet className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.disponivel")}
                  value={formatBRL(disponivelMes)}
                  tone={disponivelMes < 0 ? "neg" : "pos"}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<Gauge className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.diasRestantes")}
                  value={`${diasRestantes}`}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label={t("smartLimite.stat.aPagarMaisAssin")}
                  value={formatBRL(contasPendentes + recorrenciasPrev)}
                />
                <MiniStat
                  cfg={cfg}
                  icon={<Wallet className="h-3.5 w-3.5" />}
                  label={
                    mode === "variaveis"
                      ? t("smartLimite.stat.variaveis")
                      : t("smartLimite.stat.jaGasto")
                  }
                  value={formatBRL(gastosElegiveis)}
                />
              </>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            to="/gastos"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 backdrop-blur-sm transition-colors",
              cfg.btnSecondary,
            )}
          >
            {t("smartLimite.cta.revisar")}
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            to="/orcamento"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              cfg.muted,
              "hover:opacity-80",
            )}
          >
            {t("smartLimite.cta.ajustar")}
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
  cfg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "pos" | "neg";
  cfg: StatusCfg;
}) {
  return (
    <div className={cn("rounded-xl p-2.5 ring-1 backdrop-blur-sm", cfg.statBg, cfg.statRing)}>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide",
          cfg.subText,
        )}
      >
        <span>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          "num mt-1 truncate text-sm font-bold",
          tone === "neg" ? cfg.negText : cfg.valueText,
        )}
      >
        {value}
      </p>
    </div>
  );
}

function getMensagem(
  t: (key: string, opts?: Record<string, unknown>) => string,
  status: Status,
  porDia: number,
  _disp: number,
  temMeta: boolean,
  restanteMeta: number,
  mode: CalcMode,
  totalObrigacoes: number,
): string {
  const notice =
    totalObrigacoes > 0 && (mode === "variaveis" || mode === "hoje")
      ? t("smartLimite.msg.noticeObrigacoes", { valor: formatBRL(totalObrigacoes) })
      : "";
  if (status === "sem_dados") return t("smartLimite.msg.semDados");
  if (mode === "fluxo") return t("smartLimite.msg.fluxo");
  if (status === "meta_excedida") {
    if (mode === "variaveis")
      return t("smartLimite.msg.metaExcedidaVar", {
        valor: formatBRL(Math.abs(restanteMeta)),
        notice,
      });
    return t("smartLimite.msg.metaExcedida", { valor: formatBRL(Math.abs(restanteMeta)) });
  }
  if (status === "risco") return t("smartLimite.msg.risco", { notice });
  if (status === "atencao") {
    if (temMeta) return t("smartLimite.msg.atencaoMeta", { porDia: formatBRL(porDia), notice });
    return t("smartLimite.msg.atencao", { porDia: formatBRL(porDia) });
  }
  if (temMeta) return t("smartLimite.msg.saudavelMeta", { porDia: formatBRL(porDia), notice });
  return t("smartLimite.msg.saudavel", { porDia: formatBRL(porDia), notice });
}

type StatusCfg = {
  // dark
  darkGradient: string;
  darkBorder: string;
  // light
  lightGradient: string;
  lightBorder: string;
  // shared
  glow: string;
  bar: string;
  barTrack: string;
  valueText: string;
  text: string;
  subText: string;
  muted: string;
  negText: string;
  iconBg: string;
  iconRing: string;
  tagBg: string;
  tagRing: string;
  tagText: string;
  tagLabel: string;
  TagIcon: React.ComponentType<{ className?: string }>;
  metaBg: string;
  metaRing: string;
  inputBg: string;
  inputRing: string;
  statBg: string;
  statRing: string;
  btnPrimary: string;
  btnSecondary: string;
};

const STATUS_CONFIG: Record<Status, StatusCfg> = {
  saudavel: {
    darkGradient: "dark:from-emerald-900 dark:via-emerald-950 dark:to-slate-950",
    darkBorder: "dark:border-emerald-500/30",
    lightGradient: "from-emerald-50 via-white to-teal-50",
    lightBorder: "border-emerald-200/70",
    glow: "bg-emerald-400",
    bar: "bg-gradient-to-r from-emerald-400 to-emerald-600 dark:from-emerald-300 dark:to-emerald-500",
    barTrack: "bg-emerald-100 dark:bg-white/10",
    valueText: "text-emerald-900 dark:text-emerald-100",
    text: "text-emerald-900/80 dark:text-white/80",
    subText: "text-emerald-700/80 dark:text-white/80",
    muted: "text-emerald-700/70 dark:text-white/70",
    negText: "text-rose-600 dark:text-rose-200",
    iconBg: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200",
    iconRing: "ring-emerald-500/30 dark:ring-emerald-400/30",
    tagBg: "bg-emerald-500/15 dark:bg-emerald-400/20",
    tagRing: "ring-emerald-500/30 dark:ring-emerald-300/40",
    tagText: "text-emerald-800 dark:text-emerald-100",
    tagLabel: "Tudo sob controle",
    TagIcon: Sparkles,
    metaBg: "bg-white/60 dark:bg-white/5",
    metaRing: "ring-emerald-200/60 dark:ring-white/10",
    inputBg: "bg-white dark:bg-white/10",
    inputRing:
      "ring-emerald-300/60 focus-within:ring-emerald-500/60 dark:ring-white/15 dark:focus-within:ring-emerald-300/60",
    statBg: "bg-white/70 dark:bg-white/8",
    statRing: "ring-emerald-200/60 dark:ring-white/10",
    btnPrimary:
      "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300",
    btnSecondary:
      "bg-white/70 text-emerald-800 ring-emerald-200/70 hover:bg-white dark:bg-white/15 dark:text-white dark:ring-white/20 dark:hover:bg-white/25",
  },
  atencao: {
    darkGradient: "dark:from-amber-900 dark:via-slate-950 dark:to-slate-950",
    darkBorder: "dark:border-amber-400/30",
    lightGradient: "from-amber-50 via-white to-orange-50",
    lightBorder: "border-amber-200/70",
    glow: "bg-amber-400",
    bar: "bg-gradient-to-r from-amber-400 to-orange-500 dark:from-amber-300 dark:to-orange-500",
    barTrack: "bg-amber-100 dark:bg-white/10",
    valueText: "text-amber-900 dark:text-amber-100",
    text: "text-amber-900/80 dark:text-white/80",
    subText: "text-amber-700/80 dark:text-white/80",
    muted: "text-amber-700/70 dark:text-white/70",
    negText: "text-rose-600 dark:text-rose-200",
    iconBg: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/20 dark:text-amber-200",
    iconRing: "ring-amber-500/30 dark:ring-amber-300/30",
    tagBg: "bg-amber-500/15 dark:bg-amber-400/20",
    tagRing: "ring-amber-500/30 dark:ring-amber-300/40",
    tagText: "text-amber-800 dark:text-amber-100",
    tagLabel: "Atenção ao ritmo",
    TagIcon: Gauge,
    metaBg: "bg-white/60 dark:bg-white/5",
    metaRing: "ring-amber-200/60 dark:ring-white/10",
    inputBg: "bg-white dark:bg-white/10",
    inputRing:
      "ring-amber-300/60 focus-within:ring-amber-500/60 dark:ring-white/15 dark:focus-within:ring-amber-300/60",
    statBg: "bg-white/70 dark:bg-white/8",
    statRing: "ring-amber-200/60 dark:ring-white/10",
    btnPrimary:
      "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300",
    btnSecondary:
      "bg-white/70 text-amber-800 ring-amber-200/70 hover:bg-white dark:bg-white/15 dark:text-white dark:ring-white/20 dark:hover:bg-white/25",
  },
  risco: {
    darkGradient: "dark:from-rose-900 dark:via-slate-950 dark:to-slate-950",
    darkBorder: "dark:border-rose-500/30",
    lightGradient: "from-rose-50 via-white to-red-50",
    lightBorder: "border-rose-200/70",
    glow: "bg-rose-500",
    bar: "bg-gradient-to-r from-rose-500 to-red-600 dark:from-rose-400 dark:to-red-600",
    barTrack: "bg-rose-100 dark:bg-white/10",
    valueText: "text-rose-900 dark:text-rose-100",
    text: "text-rose-900/80 dark:text-white/80",
    subText: "text-rose-700/80 dark:text-white/80",
    muted: "text-rose-700/70 dark:text-white/70",
    negText: "text-rose-700 dark:text-rose-200",
    iconBg: "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
    iconRing: "ring-rose-500/30 dark:ring-rose-400/30",
    tagBg: "bg-rose-500/15 dark:bg-rose-500/25",
    tagRing: "ring-rose-500/30 dark:ring-rose-300/40",
    tagText: "text-rose-800 dark:text-rose-100",
    tagLabel: "Alerta financeiro",
    TagIcon: AlertTriangle,
    metaBg: "bg-white/60 dark:bg-white/5",
    metaRing: "ring-rose-200/60 dark:ring-white/10",
    inputBg: "bg-white dark:bg-white/10",
    inputRing:
      "ring-rose-300/60 focus-within:ring-rose-500/60 dark:ring-white/15 dark:focus-within:ring-rose-300/60",
    statBg: "bg-white/70 dark:bg-white/8",
    statRing: "ring-rose-200/60 dark:ring-white/10",
    btnPrimary:
      "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-400 dark:text-rose-950 dark:hover:bg-rose-300",
    btnSecondary:
      "bg-white/70 text-rose-800 ring-rose-200/70 hover:bg-white dark:bg-white/15 dark:text-white dark:ring-white/20 dark:hover:bg-white/25",
  },
  meta_excedida: {
    darkGradient: "dark:from-rose-900 dark:via-slate-950 dark:to-slate-950",
    darkBorder: "dark:border-rose-500/40",
    lightGradient: "from-rose-50 via-white to-orange-50",
    lightBorder: "border-rose-300/70",
    glow: "bg-rose-500",
    bar: "bg-gradient-to-r from-rose-500 to-red-600 dark:from-rose-400 dark:to-red-600",
    barTrack: "bg-rose-100 dark:bg-white/10",
    valueText: "text-rose-900 dark:text-rose-100",
    text: "text-rose-900/80 dark:text-white/80",
    subText: "text-rose-700/80 dark:text-white/80",
    muted: "text-rose-700/70 dark:text-white/70",
    negText: "text-rose-700 dark:text-rose-200",
    iconBg: "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
    iconRing: "ring-rose-500/30 dark:ring-rose-400/30",
    tagBg: "bg-rose-500/15 dark:bg-rose-500/25",
    tagRing: "ring-rose-500/30 dark:ring-rose-300/40",
    tagText: "text-rose-800 dark:text-rose-100",
    tagLabel: "Meta excedida",
    TagIcon: AlertTriangle,
    metaBg: "bg-white/60 dark:bg-white/5",
    metaRing: "ring-rose-200/60 dark:ring-white/10",
    inputBg: "bg-white dark:bg-white/10",
    inputRing:
      "ring-rose-300/60 focus-within:ring-rose-500/60 dark:ring-white/15 dark:focus-within:ring-rose-300/60",
    statBg: "bg-white/70 dark:bg-white/8",
    statRing: "ring-rose-200/60 dark:ring-white/10",
    btnPrimary:
      "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-400 dark:text-rose-950 dark:hover:bg-rose-300",
    btnSecondary:
      "bg-white/70 text-rose-800 ring-rose-200/70 hover:bg-white dark:bg-white/15 dark:text-white dark:ring-white/20 dark:hover:bg-white/25",
  },
  sem_dados: {
    darkGradient: "dark:from-slate-800 dark:via-slate-900 dark:to-slate-950",
    darkBorder: "dark:border-white/10",
    lightGradient: "from-slate-50 via-white to-slate-100",
    lightBorder: "border-slate-200",
    glow: "bg-slate-400",
    bar: "bg-slate-400 dark:bg-white/30",
    barTrack: "bg-slate-100 dark:bg-white/10",
    valueText: "text-slate-700 dark:text-white/80",
    text: "text-slate-700 dark:text-white/80",
    subText: "text-slate-500 dark:text-white/70",
    muted: "text-slate-500 dark:text-white/70",
    negText: "text-rose-600 dark:text-rose-200",
    iconBg: "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-white/80",
    iconRing: "ring-slate-300 dark:ring-white/20",
    tagBg: "bg-slate-200 dark:bg-white/10",
    tagRing: "ring-slate-300 dark:ring-white/20",
    tagText: "text-slate-700 dark:text-white/80",
    tagLabel: "Sem dados",
    TagIcon: Sparkles,
    metaBg: "bg-white/70 dark:bg-white/5",
    metaRing: "ring-slate-200 dark:ring-white/10",
    inputBg: "bg-white dark:bg-white/10",
    inputRing: "ring-slate-300 focus-within:ring-primary/60 dark:ring-white/15",
    statBg: "bg-white/70 dark:bg-white/8",
    statRing: "ring-slate-200 dark:ring-white/10",
    btnPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
    btnSecondary:
      "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50 dark:bg-white/15 dark:text-white dark:ring-white/20 dark:hover:bg-white/25",
  },
};
