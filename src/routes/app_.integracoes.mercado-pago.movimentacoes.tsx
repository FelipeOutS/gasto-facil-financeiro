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
  Filter,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
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
  component: MovimentacoesPage,
});

// ---------- helpers ----------

function prettyMethod(method: string | null): string {
  if (!method) return "Outro";
  const m = method.toLowerCase();
  const map: Record<string, string> = {
    account_money: "Saldo em conta",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    pix: "Pix",
    cashback: "Cashback",
    boleto: "Boleto",
    ted: "TED",
    digital_currency: "Saldo digital",
    bank_transfer: "Transferência",
  };
  return map[m] ?? method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function methodIcon(method: string | null) {
  const m = (method ?? "").toLowerCase();
  if (m.includes("pix")) return Smartphone;
  if (m.includes("credit") || m.includes("debit") || m.includes("card")) return CreditCard;
  if (m.includes("cashback")) return Coins;
  if (m.includes("boleto")) return ReceiptText;
  return Banknote;
}

function prettyStatus(status: string | null): {
  label: string;
  tone: "ok" | "warn" | "bad" | "neutral";
} {
  const s = (status ?? "").toLowerCase();
  if (["approved", "paid", "aprovado", "completed", "authorized"].includes(s))
    return { label: "Aprovado", tone: "ok" };
  if (["pending", "in_process", "in_mediation", "pendente"].includes(s))
    return { label: "Pendente", tone: "warn" };
  if (["rejected", "cancelled", "canceled", "refunded", "charged_back"].includes(s))
    return { label: s === "refunded" ? "Estornado" : "Cancelado", tone: "bad" };
  return { label: status ?? "—", tone: "neutral" };
}

function prettyTitle(title: string | null, fallback = "Mercado Pago"): string {
  if (!title) return fallback;
  // Mercado Pago #163... -> "Movimentação Mercado Pago"
  if (/^Mercado Pago #\d+/i.test(title)) return "Movimentação Mercado Pago";
  // EARN_BUY_MUSDBRL e similares
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(title.trim())) {
    if (title.toUpperCase().includes("EARN")) return "Rendimento";
    if (title.toUpperCase().includes("CASHBACK")) return "Cashback";
    return "Movimentação interna";
  }
  if (/^Cashback/i.test(title)) return title; // já amigável
  return title;
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

// ---------- page ----------

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

function MovimentacoesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<IntegrationMeta>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  useEffect(() => {
    void load();
  }, []);

  // métodos únicos para o filtro
  const methods = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.payment_method && set.add(r.payment_method));
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (methodFilter !== "all" && r.payment_method !== methodFilter) return false;
      if (!q) return true;
      const hay = `${r.title ?? ""} ${r.description ?? ""} ${prettyTitle(r.title)} ${prettyMethod(r.payment_method)}`.toLowerCase();
      return hay.includes(q);
    });
    list.sort((a, b) => {
      if (sort === "amount_desc") return Number(b.amount ?? 0) - Number(a.amount ?? 0);
      if (sort === "amount_asc") return Number(a.amount ?? 0) - Number(b.amount ?? 0);
      const da = a.occurred_at ? new Date(a.occurred_at).getTime() : 0;
      const db = b.occurred_at ? new Date(b.occurred_at).getTime() : 0;
      return sort === "date_asc" ? da - db : db - da;
    });
    return list;
  }, [rows, query, methodFilter, sort]);

  const summary = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let totalAbs = 0;
    filtered.forEach((r) => {
      const v = Number(r.amount ?? 0);
      totalAbs += Math.abs(v);
      if (r.type === "despesa" || v < 0) saidas += Math.abs(v);
      else entradas += Math.abs(v);
    });
    return { count: filtered.length, entradas, saidas, totalAbs };
  }, [filtered]);

  // agrupamento por data
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; date: Date; items: Row[] }>();
    filtered.forEach((r) => {
      const d = r.occurred_at ? new Date(r.occurred_at) : new Date(0);
      const key = dayKey(d);
      const existing = map.get(key);
      if (existing) existing.items.push(r);
      else map.set(key, { label: dayLabel(d), date: d, items: [r] });
    });
    return Array.from(map.values());
  }, [filtered]);

  const lastSync = meta?.last_sync_at
    ? new Date(meta.last_sync_at).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

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
            Transações importadas automaticamente da sua conta Mercado Pago.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{rows.length}</span> movimentações
            {lastSync && (
              <>
                {" "}
                · última sincronização em{" "}
                <span className="font-medium text-foreground">{lastSync}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Atualizar"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {/* Resumo */}
      <section className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <SummaryCard label="Total" value={String(summary.count)} hint="registros" tone="neutral" />
        <SummaryCard
          label="Entradas"
          value={formatBRL(summary.entradas)}
          tone="positive"
        />
        <SummaryCard label="Saídas" value={formatBRL(summary.saidas)} tone="negative" />
        <SummaryCard
          label="Movimentado"
          value={formatBRL(summary.totalAbs)}
          hint="no período listado"
          tone="neutral"
        />
      </section>

      {/* Filtros */}
      <section className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar descrição, nome ou método…"
            className="h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-3 text-sm outline-none ring-0 placeholder:text-muted-foreground/70 focus:border-primary"
          />
        </div>
        <div className="flex gap-2">
          <SelectChip
            icon={<Filter className="h-4 w-4" />}
            value={methodFilter}
            onChange={setMethodFilter}
            options={[
              { value: "all", label: "Todos os tipos" },
              ...methods.map((m) => ({ value: m, label: prettyMethod(m) })),
            ]}
          />
          <SelectChip
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "date_desc", label: "Mais recentes" },
              { value: "date_asc", label: "Mais antigas" },
              { value: "amount_desc", label: "Maior valor" },
              { value: "amount_asc", label: "Menor valor" },
            ]}
          />
        </div>
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
              ? "Volte e clique em Sincronizar agora."
              : "Tente limpar a busca ou trocar os filtros."}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <section key={g.label + g.date.getTime()}>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {g.label}
              </h2>
              <ul className="space-y-2">
                {g.items.map((r) => (
                  <TransactionItem
                    key={r.id}
                    row={r}
                    expanded={expandedId === r.id}
                    onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
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
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "positive" | "negative" | "neutral";
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
      <p className={cn("num mt-1 truncate text-base font-bold", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectChip({
  value,
  onChange,
  options,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 appearance-none rounded-2xl border border-border bg-card pr-8 text-sm font-medium outline-none focus:border-primary",
          icon ? "pl-9" : "pl-3",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function TransactionItem({
  row,
  expanded,
  onToggle,
}: {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isEstorno = row.type === "estorno";
  const isDespesa = row.type === "despesa" || Number(row.amount ?? 0) < 0;
  const Icon = isEstorno ? Undo2 : isDespesa ? ArrowUpRight : ArrowDownLeft;
  const iconBg = isEstorno
    ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
    : isDespesa
      ? "text-destructive bg-destructive/10"
      : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  const amount = Number(row.amount ?? 0);
  const amountClass = isDespesa
    ? "text-destructive"
    : isEstorno
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";
  const amountPrefix = isDespesa ? "−" : "+";

  const status = prettyStatus(row.status);
  const method = prettyMethod(row.payment_method);
  const MethodIcon = methodIcon(row.payment_method);
  const title = prettyTitle(row.title);
  const when = row.occurred_at ? new Date(row.occurred_at) : null;

  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-card-elevated/40"
      >
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
            iconBg,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" icon={<MethodIcon className="h-3 w-3" />}>
              {method}
            </Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {when && (
              <span className="text-[11px] text-muted-foreground">
                {timeLabel(when)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("num text-sm font-bold", amountClass)}>
            {amountPrefix}
            {formatBRL(Math.abs(amount))}
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
        <div className="border-t border-border/70 bg-card-elevated/30 p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <DetailRow label="Descrição" value={row.description || prettyTitle(row.title)} />
            <DetailRow label="Origem" value="Mercado Pago" />
            <DetailRow label="Método" value={method} />
            <DetailRow label="Status" value={status.label} />
            <DetailRow
              label="Data"
              value={when ? when.toLocaleString("pt-BR") : "—"}
            />
            <DetailRow
              label="Valor"
              value={formatBRL(Math.abs(amount))}
            />
            {row.currency && row.currency !== "BRL" && (
              <DetailRow label="Moeda" value={row.currency} />
            )}
            {row.provider_transaction_id && (
              <DetailRow
                label="ID da transação"
                value={row.provider_transaction_id}
                mono
                full
              />
            )}
            {row.title && row.title !== title && (
              <DetailRow label="Título original" value={row.title} mono full />
            )}
          </dl>
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
