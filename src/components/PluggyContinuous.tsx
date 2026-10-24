import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { pluggyContinuous, type ContinuousState } from "@/lib/pluggy/continuous.functions";
import {
  CONTINUOUS_KINDS,
  CONTINUOUS_LABELS,
  CONTINUOUS_REASONS,
} from "@/lib/pluggy/continuous-policy";
export function PluggyContinuous() {
  const call = useServerFn(pluggyContinuous);
  const [state, setState] = useState<ContinuousState | null>(null);
  const [error, setError] = useState(false);
  const [account, setAccount] = useState("");
  const [kinds, setKinds] = useState<(typeof CONTINUOUS_KINDS)[number][]>(["interest"]);
  const [category, setCategory] = useState("");
  const [perTx, setPerTx] = useState(100);
  const [perDay, setPerDay] = useState(500);
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call({ data: { action: "status" } })
      .then((s) => {
        if (live) {
          setState(s);
          setAccount(s.accounts[0]?.account_id ?? s.policies[0]?.account_id ?? "");
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [call]);
  useEffect(() => {
    const p = state?.policies.find((p) => p.account_id === account);
    if (p) {
      setKinds(p.kinds as typeof kinds);
      setCategory(p.categoria_id ?? "");
      setPerTx(Number(p.max_transaction));
      setPerDay(Number(p.max_daily_amount));
      setCount(p.max_daily_count);
    }
  }, [account, state?.policies]);
  const policy = state?.policies.find((p) => p.account_id === account);
  async function save(enabled: boolean) {
    if (
      enabled &&
      !confirm(
        "Permitir que movimentações a partir de hoje, das categorias selecionadas sejam importadas automaticamente nesta conta, dentro destes limites? Pix e operações duvidosas continuarão em revisão. O consentimento vale por 90 dias e pode ser pausado.",
      )
    )
      return;
    setBusy(true);
    try {
      setState(
        await call({
          data: {
            action: "set",
            accountId: account,
            enabled,
            confirmed: true,
            kinds: !enabled && policy ? (policy.kinds as typeof kinds) : kinds,
            categoryId: !enabled && policy ? policy.categoria_id : category || null,
            maxTransaction: !enabled && policy ? Number(policy.max_transaction) : perTx,
            maxDailyAmount: !enabled && policy ? Number(policy.max_daily_amount) : perDay,
            maxDailyCount: !enabled && policy ? policy.max_daily_count : count,
          },
        }),
      );
      toast.success(enabled ? "Política salva." : "Automação pausada.");
    } catch {
      toast.error("Não foi possível confirmar a alteração. Atualize para conferir.");
    } finally {
      setBusy(false);
    }
  }
  async function undo(batchId: string) {
    if (
      !confirm(
        "Desfazer esta importação? Alterações manuais serão preservadas e a origem não poderá ser importada novamente.",
      )
    )
      return;
    setBusy(true);
    try {
      setState(await call({ data: { action: "undo", batchId, confirmed: true } }));
      toast.success("Reversão processada. Registros editados são preservados.");
    } catch {
      toast.error("Não foi possível desfazer.");
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    try {
      setState(await call({ data: { action: "preview", accountId: account } }));
    } catch {
      toast.error("Prévia indisponível.");
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <p role="status">
        {error ? "Consulta da automação contínua indisponível." : "Consultando automação contínua…"}
      </p>
    );
  if (!state.schemaReady)
    return (
      <p className="text-sm text-muted-foreground">Automação contínua aguardando liberação.</p>
    );
  const accounts = [
    ...state.accounts,
    ...state.policies
      .filter((p) => !state.accounts.some((a) => a.account_id === p.account_id))
      .map((p) => ({ account_id: p.account_id, name: "Conta desconectada", type: "" })),
  ];
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h3 className="font-semibold">Automação contínua por conta</h3>
      <p className="text-xs text-muted-foreground">
        Importa novas movimentações identificadas com segurança. Casos ambíguos ficam para revisão.
        Limites usados não são devolvidos ao desfazer.
      </p>
      <label className="block">
        Conta Mercado Pago
        <select
          aria-label="Conta da automação"
          disabled={busy}
          className="ml-2 max-w-full rounded border bg-background p-2"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setState({ ...state, preview: undefined });
          }}
        >
          {accounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {a.name} · {a.type}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={busy || !state.released} className="space-y-2">
        <legend>Movimentações permitidas</legend>
        {CONTINUOUS_KINDS.map((k) => (
          <label className="block text-sm" key={k}>
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) =>
                setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))
              }
            />{" "}
            {CONTINUOUS_LABELS[k]}
          </label>
        ))}
        <label className="block text-sm">
          Categoria para despesas
          <select
            className="ml-2 rounded border bg-background p-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Selecione</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["Por movimentação (R$)", perTx, setPerTx, 5000],
            ["Por dia (R$)", perDay, setPerDay, 20000],
            ["Movimentações por dia", count, setCount, 100],
          ].map(([label, value, set, max]) => (
            <label className="text-sm" key={String(label)}>
              {String(label)}
              <input
                className="block w-full rounded border bg-background p-2"
                aria-label={String(label)}
                type="number"
                min="1"
                max={Number(max)}
                value={Number(value)}
                onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      </fieldset>
      {!state.released && <p className="text-sm">Ativação bloqueada até a homologação.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={
            busy ||
            !state.released ||
            !account ||
            !kinds.length ||
            ((kinds.includes("purchase") || kinds.includes("card_purchase")) && !category)
          }
          onClick={() => save(true)}
        >
          Confirmar política
        </button>
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={busy || !policy?.enabled}
          onClick={() => save(false)}
        >
          Pausar agora
        </button>
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={busy || !policy}
          onClick={preview}
        >
          Ver prévia
        </button>
      </div>
      <p className="text-sm">
        Situação:{" "}
        {policy?.enabled
          ? Date.parse(policy.expires_at) <= Date.now()
            ? "consentimento expirado"
            : "ativa"
          : "desligada"}
        {policy ? ` · versão ${policy.revision}` : ""}
      </p>
      {state.preview && (
        <ul className="space-y-1 text-sm">
          {state.preview.length ? (
            state.preview.map((x) => (
              <li key={x.transaction_id}>
                {x.date} · R$ {Number(x.amount).toFixed(2)} ·{" "}
                {CONTINUOUS_REASONS[x.reason] ?? "Revisar"}
              </li>
            ))
          ) : (
            <li>Nenhuma movimentação nesta prévia.</li>
          )}
        </ul>
      )}
      <details>
        <summary>Histórico recente da automação</summary>
        <ul className="space-y-1 text-sm">
          {state.history.map((x, i) => (
            <li key={i}>
              {new Date(x.processed_at).toLocaleDateString("pt-BR")} · R${" "}
              {Number(x.amount).toFixed(2)} · {CONTINUOUS_REASONS[x.reason] ?? "Revisar"}
              {x.batch_id && (
                <button
                  className="ml-2 underline"
                  disabled={busy}
                  onClick={() => void undo(x.batch_id!)}
                >
                  Desfazer com segurança
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
