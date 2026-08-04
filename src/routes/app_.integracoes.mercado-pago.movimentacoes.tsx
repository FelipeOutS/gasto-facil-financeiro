import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Undo2,
  Search,
  RefreshCw,
  ChevronDown,
  Banknote,
  CreditCard,
  Smartphone,
  Coins,
  ReceiptText,
  SlidersHorizontal,
  X,
  TrendingUp,
  CalendarRange,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  type: string | null;
  title: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  payment_method: string | null;
  status: string | null;
  occurred_at: string | null;
  provider_transaction_id: string | null;
};

type IntegrationMeta = { last_sync_at: string | null } | null;

export const Route = createFileRoute("/app_/integracoes/mercado-pago/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações Mercado Pago — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Transações importadas automaticamente da sua conta Mercado Pago, organizadas por data.",
      },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <MovimentacoesPage />
    </AdminMasterGate>
  ),
});

// ---------- normalizer ----------

type Direction = "income" | "expense" | "neutral";
type NormalizedType =
  | "pix"
  | "account_money"
  | "credit_card"
  | "debit_card"
  | "boleto"
  | "cashback"
  | "rendimento"
  | "assinatura"
  | "fee"
  | "refund"
  | "other";

type Normalized = {
  title: string;
  description: string;
  direction: Direction;
  type: NormalizedType;
  statusLabel: string;
  statusTone: "ok" | "warn" | "bad" | "neutral";
  statusKey: "approved" | "pending" | "rejected" | "refunded" | "cancelled" | "other";
  displayAmount: string;
  signedAmount: number;
  dateLabel: string;
  timeLabel: string;
  methodLabel: string;
};

function detectType(row: Row): NormalizedType {
  const m = (row.payment_method ?? "").toLowerCase();
  const t = (row.type ?? "").toLowerCase();
  const text = `${row.title ?? ""} ${row.description ?? ""}`.toLowerCase();
  if (t === "estorno" || /refund|estorno|charged_back/.test(text)) return "refund";
  if (/fee|tarifa|taxa/.test(text) || t === "taxa") return "fee";
  if (m.includes("pix") || /pix/.test(text)) return "pix";
  if (m.includes("cashback") || /cashback/.test(text)) return "cashback";
  if (/earn|rendimento|yield|investimento/.test(text)) return "rendimento";
  if (/assinatura|subscription|recurring/.test(text)) return "assinatura";
  if (m.includes("credit")) return "credit_card";
  if (m.includes("debit")) return "debit_card";
  if (m.includes("boleto")) return "boleto";
  if (m.includes("account_money") || /saldo/.test(text)) return "account_money";
  return "other";
}

function typeLabel(t: NormalizedType): string {
  return {
    pix: "Pix",
    account_money: "Saldo em conta",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    boleto: "Boleto",
    cashback: "Cashback",
    rendimento: "Rendimento",
    assinatura: "Assinatura",
    fee: "Taxa",
    refund: "Estorno",
    other: "Outros",
  }[t];
}

function statusInfo(status: string | null): {
  label: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  key: Normalized["statusKey"];
} {
  const s = (status ?? "").toLowerCase();
  if (["approved", "paid", "aprovado", "completed", "authorized"].includes(s))
    return { label: "Aprovado", tone: "ok", key: "approved" };
  if (["pending", "in_process", "in_mediation", "pendente"].includes(s))
    return { label: "Pendente", tone: "warn", key: "pending" };
  if (["refunded", "estornado"].includes(s))
    return { label: "Estornado", tone: "bad", key: "refunded" };
  if (["rejected", "rejeitado"].includes(s))
    return { label: "Rejeitado", tone: "bad", key: "rejected" };
  if (["cancelled", "canceled", "cancelado"].includes(s))
    return { label: "Cancelado", tone: "bad", key: "cancelled" };
  return { label: status ?? "—", tone: "neutral", key: "other" };
}

function friendlyTitle(row: Row, type: NormalizedType, direction: Direction): string {
  const raw = (row.title ?? "").trim();
  const desc = (row.description ?? "").trim();
  // Generic Mercado Pago #123 -> friendly label
  const generic = !raw || /^Mercado Pago #\d+/i.test(raw) || /^[A-Z][A-Z0-9_]{4,}$/.test(raw);
  if (!generic) return raw;
  if (type === "pix") return direction === "expense" ? "Pix enviado" : "Pix recebido";
  if (type === "cashback") return "Cashback";
  if (type === "rendimento") return "Rendimento";
  if (type === "assinatura") return "Assinatura";
  if (type === "fee") return "Taxa Mercado Pago";
  if (type === "refund") return "Estorno";
  if (type === "account_money")
    return direction === "expense" ? "Saída — Saldo em conta" : "Entrada — Saldo em conta";
  if (type === "credit_card")
    return direction === "expense"
      ? "Compra no cartão de crédito"
      : "Recebimento via cartão de crédito";
  if (type === "debit_card")
    return direction === "expense"
      ? "Compra no cartão de débito"
      : "Recebimento via cartão de débito";
  if (type === "boleto") return direction === "expense" ? "Pagamento de boleto" : "Boleto recebido";
  return desc || "Movimentação Mercado Pago";
}

function normalize(row: Row): Normalized {
  const amountRaw = Number(row.amount ?? 0);
  const t = (row.type ?? "").toLowerCase();
  const type = detectType(row);

  let direction: Direction = "neutral";
  if (t === "receita") direction = "income";
  else if (t === "despesa") direction = "expense";
  else if (t === "estorno") direction = "expense";
  else if (amountRaw > 0) direction = "income";
  else if (amountRaw < 0) direction = "expense";

  if (type === "fee") direction = "expense";
  if (type === "refund") direction = "expense";
  if (type === "cashback" || type === "rendimento") direction = "income";

  const signed =
    direction === "expense"
      ? -Math.abs(amountRaw)
      : direction === "income"
        ? Math.abs(amountRaw)
        : amountRaw;

  const status = statusInfo(row.status);
  const when = row.occurred_at ? new Date(row.occurred_at) : null;

  return {
    title: friendlyTitle(row, type, direction),
    description: row.description ?? "",
    direction,
    type,
    statusLabel: status.label,
    statusTone: status.tone,
    statusKey: status.key,
    displayAmount: formatBRL(Math.abs(amountRaw)),
    signedAmount: signed,
    dateLabel: when ? dayLabel(when) : "—",
    timeLabel: when ? timeLabel(when) : "",
    methodLabel: typeLabel(type),
  };
}

function methodIcon(type: NormalizedType) {
  if (type === "pix") return Smartphone;
  if (type === "credit_card" || type === "debit_card") return CreditCard;
  if (type === "cashback") return Coins;
  if (type === "rendimento") return TrendingUp;
  if (type === "boleto") return ReceiptText;
  if (type === "fee") return ReceiptText;
  if (type === "refund") return Undo2;
  return Banknote;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Hoje";
  if (dayKey(d) === dayKey(yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "agora mesmo";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- filter types ----------

type PeriodKey =
  | "all"
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "custom";

type DirectionFilter = "all" | "income" | "expense" | "fee" | "refund" | "cashback" | "rendimento";
type TypeFilter = "all" | NormalizedType;
type StatusFilter = "all" | "approved" | "pending" | "rejected" | "refunded" | "cancelled";
type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "az" | "za";

function periodRange(
  p: PeriodKey,
  fromStr: string,
  toStr: string,
): { from: Date | null; to: Date | null } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  switch (p) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "last7": {
      const f = new Date(now);
      f.setDate(now.getDate() - 6);
      return { from: startOfDay(f), to: endOfDay(now) };
    }
    case "last30": {
      const f = new Date(now);
      f.setDate(now.getDate() - 29);
      return { from: startOfDay(f), to: endOfDay(now) };
    }
    case "thisMonth":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
    case "lastMonth": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from: f, to: t };
    }
    case "custom":
      return {
        from: fromStr ? new Date(fromStr + "T00:00:00") : null,
        to: toStr ? new Date(toStr + "T23:59:59") : null,
      };
    default:
      return { from: null, to: null };
  }
}

// ---------- page ----------

function MovimentacoesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<IntegrationMeta>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [minV, setMinV] = useState("");
  const [maxV, setMaxV] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [txRes, intRes] = await Promise.all([
        supabase
          .from("imported_transactions")
          .select(
            "id, type, title, description, amount, currency, payment_method, status, occurred_at, provider_transaction_id",
          )
          .eq("provider", "mercado_pago")
          .order("occurred_at", { ascending: false })
          .limit(500),
        supabase
          .from("user_integrations_safe")
          .select("last_sync_at")
          .eq("provider", "mercado_pago")
          .maybeSingle(),
      ]);
      if (txRes.error) throw txRes.error;
      setRows((txRes.data ?? []) as Row[]);
      setMeta((intRes.data as IntegrationMeta) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncOk(false);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch("/api/integrations/mercadopago/sync", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await load();
      setSyncOk(true);
      setTimeout(() => setSyncOk(false), 2500);
    } catch {
      // noop, error already surfaced by load if it fails
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // normaliza
  const normalized = useMemo(() => rows.map((r) => ({ row: r, n: normalize(r) })), [rows]);

  const { from, to } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minV ? Number(minV.replace(",", ".")) : null;
    const max = maxV ? Number(maxV.replace(",", ".")) : null;

    const list = normalized.filter(({ row, n }) => {
      // período
      if (from || to) {
        const d = row.occurred_at ? new Date(row.occurred_at) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      // direção
      if (direction !== "all") {
        if (direction === "income" && n.direction !== "income") return false;
        if (direction === "expense" && n.direction !== "expense") return false;
        if (direction === "fee" && n.type !== "fee") return false;
        if (direction === "refund" && n.type !== "refund") return false;
        if (direction === "cashback" && n.type !== "cashback") return false;
        if (direction === "rendimento" && n.type !== "rendimento") return false;
      }
      // tipo
      if (typeF !== "all" && n.type !== typeF) return false;
      // status
      if (statusF !== "all" && n.statusKey !== statusF) return false;
      // valor
      const abs = Math.abs(Number(row.amount ?? 0));
      if (min !== null && !Number.isNaN(min) && abs < min) return false;
      if (max !== null && !Number.isNaN(max) && abs > max) return false;
      // busca
      if (q) {
        const hay =
          `${n.title} ${row.title ?? ""} ${row.description ?? ""} ${n.methodLabel} ${row.provider_transaction_id ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sort === "amount_desc")
        return Math.abs(Number(b.row.amount ?? 0)) - Math.abs(Number(a.row.amount ?? 0));
      if (sort === "amount_asc")
        return Math.abs(Number(a.row.amount ?? 0)) - Math.abs(Number(b.row.amount ?? 0));
      if (sort === "az") return a.n.title.localeCompare(b.n.title, "pt-BR");
      if (sort === "za") return b.n.title.localeCompare(a.n.title, "pt-BR");
      const da = a.row.occurred_at ? new Date(a.row.occurred_at).getTime() : 0;
      const db = b.row.occurred_at ? new Date(b.row.occurred_at).getTime() : 0;
      return sort === "date_asc" ? da - db : db - da;
    });
    return list;
  }, [normalized, query, from, to, direction, typeF, statusF, minV, maxV, sort]);

  const summary = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let maior = 0;
    filtered.forEach(({ n }) => {
      if (n.signedAmount > 0) entradas += n.signedAmount;
      else if (n.signedAmount < 0) saidas += Math.abs(n.signedAmount);
      const abs = Math.abs(n.signedAmount);
      if (abs > maior) maior = abs;
    });
    return { count: filtered.length, entradas, saidas, saldo: entradas - saidas, maior };
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; date: Date; items: typeof filtered }>();
    filtered.forEach((it) => {
      const d = it.row.occurred_at ? new Date(it.row.occurred_at) : new Date(0);
      const key = dayKey(d);
      const existing = map.get(key);
      if (existing) existing.items.push(it);
      else map.set(key, { label: dayLabel(d), date: d, items: [it] });
    });
    return Array.from(map.values());
  }, [filtered]);

  const lastSyncAgo = timeAgo(meta?.last_sync_at ?? null);

  const activeFiltersCount =
    (period !== "last30" ? 1 : 0) +
    (direction !== "all" ? 1 : 0) +
    (typeF !== "all" ? 1 : 0) +
    (statusF !== "all" ? 1 : 0) +
    (minV ? 1 : 0) +
    (maxV ? 1 : 0) +
    (query ? 1 : 0);

  function clearFilters() {
    setQuery("");
    setPeriod("last30");
    setCustomFrom("");
    setCustomTo("");
    setDirection("all");
    setTypeF("all");
    setStatusF("all");
    setMinV("");
    setMaxV("");
    setSort("date_desc");
  }

  const periodLabel = useMemo(() => {
    if (period === "all") return "Todo o período";
    if (period === "custom" && from && to) {
      const f = from.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const t = to.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      return `${f} → ${t}`;
    }
    return {
      today: "Hoje",
      yesterday: "Ontem",
      last7: "Últimos 7 dias",
      last30: "Últimos 30 dias",
      thisMonth: "Este mês",
      lastMonth: "Mês passado",
      custom: "Personalizado",
    }[period];
  }, [period, from, to]);

  return (
    <MobileShell>
      {/* Cabeçalho */}
      <header className="flex items-start gap-3 pt-2">
        <Link
          to="/app/integracoes/mercado-pago"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Mercado Pago
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight">Movimentações importadas</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Confira, filtre e organize as transações importadas da sua conta Mercado Pago.
          </p>
          {lastSyncAgo && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Última sincronização:{" "}
              <span className="font-medium text-foreground">{lastSyncAgo}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-card-elevated/50 disabled:opacity-70",
            syncOk && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
          )}
          aria-label="Sincronizar"
        >
          {syncOk ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Atualizado
            </>
          ) : (
            <>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Sincronizando…" : "Sincronizar"}
            </>
          )}
        </button>
      </header>

      {/* Cards de resumo */}
      <section className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          label="Total importado"
          value={String(summary.count)}
          hint="registros"
          tone="neutral"
        />
        <SummaryCard label="Entradas" value={formatBRL(summary.entradas)} tone="positive" />
        <SummaryCard label="Saídas" value={formatBRL(summary.saidas)} tone="negative" />
        <SummaryCard
          label="Saldo movimentado"
          value={formatBRL(summary.saldo)}
          tone={summary.saldo >= 0 ? "positive" : "negative"}
        />
        <SummaryCard label="Maior movimentação" value={formatBRL(summary.maior)} tone="neutral" />
        <SummaryCard
          label="Período"
          value={periodLabel ?? "—"}
          hint={`${filtered.length} de ${rows.length}`}
          tone="neutral"
          small
        />
      </section>

      {/* Busca + chips rápidos + botão filtros */}
      <section className="mt-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descrição, nome, ID ou método…"
            className="h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <QuickChip active={period === "today"} onClick={() => setPeriod("today")}>
            Hoje
          </QuickChip>
          <QuickChip active={period === "last7"} onClick={() => setPeriod("last7")}>
            7 dias
          </QuickChip>
          <QuickChip active={period === "last30"} onClick={() => setPeriod("last30")}>
            30 dias
          </QuickChip>
          <QuickChip active={period === "thisMonth"} onClick={() => setPeriod("thisMonth")}>
            Este mês
          </QuickChip>
          <QuickChip active={period === "all"} onClick={() => setPeriod("all")}>
            Tudo
          </QuickChip>

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              "ml-auto inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition-colors",
              filtersOpen
                ? "border-primary text-primary"
                : "border-border text-foreground hover:bg-card-elevated/40",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros avançados
            {activeFiltersCount > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {activeFiltersCount}
              </span>
            )}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", filtersOpen && "rotate-180")}
            />
          </button>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Limpar
            </button>
          )}
        </div>

        {/* Painel inline (sem modal) */}
        {filtersOpen && (
          <div className="space-y-4 rounded-3xl border border-border bg-card p-4">
            <FilterBlock title="Período" icon={<CalendarRange className="h-3.5 w-3.5" />}>
              <ChipGroup
                value={period}
                onChange={(v) => setPeriod(v as PeriodKey)}
                options={[
                  ["today", "Hoje"],
                  ["yesterday", "Ontem"],
                  ["last7", "Últimos 7 dias"],
                  ["last30", "Últimos 30 dias"],
                  ["thisMonth", "Este mês"],
                  ["lastMonth", "Mês passado"],
                  ["custom", "Personalizado"],
                  ["all", "Tudo"],
                ]}
              />
              {period === "custom" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <DateField label="De" value={customFrom} onChange={setCustomFrom} />
                  <DateField label="Até" value={customTo} onChange={setCustomTo} />
                </div>
              )}
            </FilterBlock>

            <FilterBlock title="Tipo de movimentação">
              <ChipGroup
                value={direction}
                onChange={(v) => setDirection(v as DirectionFilter)}
                options={[
                  ["all", "Todas"],
                  ["income", "Entradas"],
                  ["expense", "Saídas"],
                  ["fee", "Taxas"],
                  ["refund", "Estornos"],
                  ["cashback", "Cashback"],
                  ["rendimento", "Rendimentos"],
                ]}
              />
            </FilterBlock>

            <FilterBlock title="Método / origem">
              <ChipGroup
                value={typeF}
                onChange={(v) => setTypeF(v as TypeFilter)}
                options={[
                  ["all", "Todos"],
                  ["pix", "Pix"],
                  ["account_money", "Saldo em conta"],
                  ["credit_card", "Cartão crédito"],
                  ["debit_card", "Cartão débito"],
                  ["boleto", "Boleto"],
                  ["other", "Outros"],
                ]}
              />
            </FilterBlock>

            <FilterBlock title="Status">
              <ChipGroup
                value={statusF}
                onChange={(v) => setStatusF(v as StatusFilter)}
                options={[
                  ["all", "Todos"],
                  ["approved", "Aprovado"],
                  ["pending", "Pendente"],
                  ["rejected", "Rejeitado"],
                  ["refunded", "Estornado"],
                  ["cancelled", "Cancelado"],
                ]}
              />
            </FilterBlock>

            <FilterBlock title="Faixa de valor">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Mínimo" value={minV} onChange={setMinV} placeholder="R$ 0,00" />
                <NumberField label="Máximo" value={maxV} onChange={setMaxV} placeholder="R$ 0,00" />
              </div>
            </FilterBlock>

            <FilterBlock title="Ordenação">
              <ChipGroup
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                options={[
                  ["date_desc", "Mais recentes"],
                  ["date_asc", "Mais antigas"],
                  ["amount_desc", "Maior valor"],
                  ["amount_asc", "Menor valor"],
                  ["az", "A–Z"],
                  ["za", "Z–A"],
                ]}
              />
            </FilterBlock>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Mostrando <span className="font-semibold text-foreground">{filtered.length}</span> de{" "}
          <span className="font-semibold text-foreground">{rows.length}</span> movimentações
        </p>
      </section>

      {/* Conteúdo */}
      {loading ? (
        <div className="mt-5 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-3xl border border-destructive/30 bg-destructive/10 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-border bg-card p-8 text-center">
          <Wallet className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">
            {rows.length === 0
              ? "Nenhuma movimentação importada ainda"
              : "Nenhum resultado para os filtros"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length === 0
              ? "Clique em Sincronizar para importar da sua conta Mercado Pago."
              : "Tente limpar a busca ou ajustar os filtros."}
          </p>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium"
            >
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <section key={g.label + g.date.getTime()}>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {g.label}
              </h2>
              <ul className="space-y-2">
                {g.items.map(({ row, n }) => (
                  <TransactionItem
                    key={row.id}
                    row={row}
                    n={n}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </MobileShell>
  );
}

// ---------- componentes ----------

function SummaryCard({
  label,
  value,
  hint,
  tone,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "positive" | "negative" | "neutral";
  small?: boolean;
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 truncate font-bold", small ? "text-sm" : "text-base", toneClass)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function QuickChip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function ChipGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            value === v
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-xs outline-none focus:border-primary"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-xs outline-none focus:border-primary"
      />
    </label>
  );
}

function TransactionItem({
  row,
  n,
  expanded,
  onToggle,
}: {
  row: Row;
  n: Normalized;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon =
    n.type === "refund" ? Undo2 : n.direction === "expense" ? ArrowUpRight : ArrowDownLeft;
  const iconBg =
    n.type === "refund"
      ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
      : n.direction === "expense"
        ? "text-destructive bg-destructive/10"
        : n.direction === "income"
          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
          : "text-muted-foreground bg-card-elevated";

  const amountClass =
    n.direction === "expense"
      ? "text-destructive"
      : n.direction === "income"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  const amountPrefix = n.direction === "expense" ? "−" : n.direction === "income" ? "+" : "";

  const MethodIcon = methodIcon(n.type);

  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-card-elevated/40"
      >
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", iconBg)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{n.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" icon={<MethodIcon className="h-3 w-3" />}>
              {n.methodLabel}
            </Badge>
            <Badge tone={n.statusTone}>{n.statusLabel}</Badge>
            {n.timeLabel && (
              <span className="text-[11px] text-muted-foreground">{n.timeLabel}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("num text-sm font-bold", amountClass)}>
            {amountPrefix}
            {n.displayAmount}
          </p>
          <ChevronDown
            className={cn(
              "ml-auto mt-0.5 h-4 w-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/70 bg-card-elevated/30 p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <DetailRow label="Descrição" value={row.description || n.title} />
            <DetailRow label="Origem" value="Mercado Pago" />
            <DetailRow label="Método" value={n.methodLabel} />
            <DetailRow label="Status" value={n.statusLabel} />
            <DetailRow
              label="Tipo detectado"
              value={
                n.direction === "income"
                  ? "Entrada"
                  : n.direction === "expense"
                    ? "Saída"
                    : "Neutra"
              }
            />
            <DetailRow
              label="Data"
              value={row.occurred_at ? new Date(row.occurred_at).toLocaleString("pt-BR") : "—"}
            />
            <DetailRow label="Valor bruto" value={n.displayAmount} />
            {row.currency && row.currency !== "BRL" && (
              <DetailRow label="Moeda" value={row.currency} />
            )}
            {row.provider_transaction_id && (
              <DetailRow label="ID da transação" value={row.provider_transaction_id} mono full />
            )}
            {row.title && row.title !== n.title && (
              <DetailRow label="Título original" value={row.title} mono full />
            )}
          </dl>
          <button
            type="button"
            disabled
            title="Em breve"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Transformar em lançamento (em breve)
          </button>
        </div>
      )}
    </li>
  );
}

function Badge({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: "ok" | "warn" | "bad" | "neutral";
  icon?: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "bg-destructive/10 text-destructive"
          : "bg-card-elevated text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        cls,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function DetailRow({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={cn(full && "col-span-2")}>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-xs font-medium text-foreground",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
