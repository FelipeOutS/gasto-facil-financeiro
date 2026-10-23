import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  pluggySettlements,
  type SettlementState,
  type SettlementQuote,
} from "@/lib/pluggy/settlements.functions";
const labels = {
  advance_link: "Vincular Pix adiantado a uma conta a receber",
  receivable_return: "Conciliar devolução do principal",
  refund: "Vincular estorno à compra original",
  bill_payment: "Conciliar pagamento de fatura",
};
const money = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function PluggySettlements() {
  const call = useServerFn(pluggySettlements),
    [state, setState] = useState<SettlementState>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<SettlementQuote["kind"]>("advance_link"),
    [account, setAccount] = useState(""),
    [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [quote, setQuote] = useState<SettlementQuote>();
  useEffect(() => {
    let live = true;
    call({ data: { action: "status" } })
      .then((r) => {
        if (live) setState(r.state);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [call]);
  useEffect(() => {
    setQuote(undefined);
  }, [kind, account, source, target]);
  if (!state)
    return (
      <p role="status">
        {error ? "Consulta de conciliações indisponível." : "Consultando conciliações…"}
      </p>
    );
  if (!state.schemaReady)
    return (
      <p className="text-sm text-muted-foreground">
        Conciliações confirmadas aguardando liberação.
      </p>
    );
  const sources =
    kind === "bill_payment"
      ? state.bills
          .filter((x) => x.account_id === account)
          .map((x) => ({ id: x.bill_id, label: x.due_date + " · " + money(x.total) }))
      : state.transactions
          .filter(
            (x) =>
              x.account_id === account && x.type === (kind === "advance_link" ? "DEBIT" : "CREDIT"),
          )
          .map((x) => ({
            id: x.transaction_id,
            label: x.date + " · " + x.description + " · " + money(x.amount),
          }));
  const targets =
    kind === "bill_payment"
      ? state.cards.map((x) => ({ id: x.id, label: x.nome }))
      : kind === "refund"
        ? state.expenses.map((x) => ({
            id: x.id,
            label: x.data + " · " + x.descricao + " · " + money(x.valor),
          }))
        : state.receivables.map((x) => ({
            id: x.id,
            label: x.titulo + " · restante " + money(x.valor_restante),
          }));
  async function run(action: "preview" | "apply" | "undo", id?: string) {
    if (
      action === "apply" &&
      !confirm(
        "Confirmar a conciliação de " +
          money(quote!.amount) +
          " com o destino selecionado? Ela altera o registro original e não cria uma nova receita ou despesa.",
      )
    )
      return;
    if (
      action === "undo" &&
      !confirm("Desfazer esta conciliação? Registros editados manualmente serão preservados.")
    )
      return;
    setBusy(true);
    try {
      const r = await call({
        data:
          action === "preview"
            ? { action, accountId: account, sourceId: source, kind, targetId: target }
            : action === "apply"
              ? { action, quote: quote!, confirmed: true }
              : { action, id: id!, confirmed: true },
      });
      if (r.quote) setQuote(r.quote);
      else {
        toast.success(
          r.result === "preservado" ? "Edição manual preservada." : "Operação conferida.",
        );
        setQuote(undefined);
        setState((await call({ data: { action: "status" } })).state);
      }
    } catch {
      toast.error(
        "Não foi possível confirmar. Confira a origem e o destino e gere uma nova prévia.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h3 className="font-semibold">Conciliações confirmadas</h3>
      <p className="text-sm text-muted-foreground">
        Escolha explicitamente a origem e o registro existente. Adiantamentos e devoluções de
        principal não são renda. A baixa de fatura exige os pagamentos do ciclo seguinte e os
        valores exatos. A lista mostra até 300 movimentações dos últimos 31 dias e 300 destinos
        recentes.
      </p>
      {!state.released && <p className="text-sm">Gravações bloqueadas até a homologação.</p>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label>
          Operação
          <select
            className="block w-full rounded border bg-background p-2"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setSource("");
              setTarget("");
            }}
          >
            {Object.entries(labels).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Conta Mercado Pago
          <select
            className="block w-full rounded border bg-background p-2"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setSource("");
            }}
          >
            <option value="">Selecione</option>
            {state.accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origem
          <select
            className="block w-full rounded border bg-background p-2"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Selecione</option>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destino confirmado
          <select
            className="block w-full rounded border bg-background p-2"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Selecione</option>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <button
        className="rounded border px-3 py-2"
        disabled={busy || !account || !source || !target}
        onClick={() => void run("preview")}
      >
        Conferir prévia
      </button>
      {quote && (
        <div role="status" className="space-y-2 rounded border p-3">
          <p>
            {labels[quote.kind]}: {money(quote.amount)}. A confirmação revalida os dados no banco.
          </p>
          <button
            className="rounded border px-3 py-2"
            disabled={busy || !state.released}
            onClick={() => void run("apply")}
          >
            Confirmar conciliação
          </button>
        </div>
      )}
      <h4 className="font-medium">Histórico</h4>
      {!state.history.length && <p className="text-sm">Nenhuma conciliação registrada.</p>}
      {state.history.map((h) => (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"
          key={h.id}
        >
          <span>
            {labels[h.kind as keyof typeof labels]} · {money(h.amount)} ·{" "}
            {new Date(h.created_at).toLocaleString("pt-BR")}
          </span>
          {h.reverted_at ? (
            <span>Desfeita</span>
          ) : (
            <button disabled={busy || !state.released} onClick={() => void run("undo", h.id)}>
              Desfazer com segurança
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
