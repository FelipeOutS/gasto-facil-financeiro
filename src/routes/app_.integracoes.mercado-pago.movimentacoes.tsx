import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Wallet, ArrowDownLeft, ArrowUpRight, Undo2 } from "lucide-react";
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
  payment_method: string | null;
  status: string | null;
  occurred_at: string | null;
};

export const Route = createFileRoute("/app_/integracoes/mercado-pago/movimentacoes")({
  head: () => ({ meta: [{ title: "Movimentações Mercado Pago — Gasto Inteligente" }] }),
  component: MovimentacoesPage,
});

function MovimentacoesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("imported_transactions")
        .select("id, type, title, description, amount, payment_method, status, occurred_at")
        .eq("provider", "mercado_pago")
        .order("occurred_at", { ascending: false })
        .limit(200);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app/integracoes/mercado-pago"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Mercado Pago
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight">Movimentações</h1>
        </div>
      </header>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-border bg-card p-6 text-center">
          <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Nenhuma movimentação importada ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Volte e clique em <strong>Sincronizar agora</strong>.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((r) => {
            const isEstorno = r.type === "estorno";
            const isDespesa = r.type === "despesa";
            const Icon = isEstorno ? Undo2 : isDespesa ? ArrowUpRight : ArrowDownLeft;
            const colorClass = isEstorno
              ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
              : isDespesa
                ? "text-destructive bg-destructive/10"
                : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
            const when = r.occurred_at
              ? new Date(r.occurred_at).toLocaleString("pt-BR")
              : "—";
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", colorClass)}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.title ?? "Mercado Pago"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {when} · {r.payment_method ?? "—"} · {r.status ?? "—"}
                  </p>
                </div>
                <p className="num shrink-0 text-sm font-semibold">
                  {formatBRL(Number(r.amount ?? 0))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </MobileShell>
  );
}
