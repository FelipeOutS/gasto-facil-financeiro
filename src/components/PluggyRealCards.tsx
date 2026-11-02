import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pluggyRealCards } from "@/lib/pluggy/real-cards.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
type Preview = Extract<Awaited<ReturnType<typeof pluggyRealCards>>, { preview: true }>;
export function PluggyRealCards() {
  const call = useServerFn(pluggyRealCards);
  const [data, setData] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Record<string, string>>({});
  async function load() {
    try { const r = await call({ data: { action: "preview" } }); if (r.preview === true) setData(r); setFailed(false); }
    catch { setFailed(true); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function link(accountId: string, cardId: string | null) {
    if (!confirm(cardId ? "Confirmar este vínculo? Compras anteriores continuarão no cartão original." : "Desvincular? Nenhum lançamento será apagado.")) return;
    setBusy(true);
    try { await call({ data: { action: "link", accountId, cardId, confirmed: true } }); await load(); toast.success("Vínculo atualizado."); }
    catch { toast.error("Não foi possível confirmar o vínculo. Atualize a página antes de tentar novamente."); }
    finally { setBusy(false); }
  }
  if (failed) return <p className="mt-4 text-sm text-muted-foreground">Não foi possível consultar os vínculos de cartões. <button onClick={load} className="underline">Tentar novamente</button></p>;
  if (!data?.accounts.length) return null;
  return <section className="mt-6 space-y-3">
    <h2 className="text-sm font-semibold">Cartões encontrados no Mercado Pago</h2>
    <p className="text-xs text-muted-foreground">Compare com seus cartões antes de vincular. Compras sem fatura bancária identificada ficam para revisão.</p>
    {!data.released && <p className="text-xs text-muted-foreground">Vínculos disponíveis para consulta; confirmação aguarda liberação.</p>}
    {data.accounts.map(a => {
      const current = data.links.find(l => l.account_id === a.id)?.cartao_id;
      const chosen = selection[a.id] ?? current ?? "";
      return <div key={a.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">{a.name}{a.last4 ? ` · final ${a.last4}` : ""}<p className="text-xs text-muted-foreground">{current ? `Vinculado a ${data.cards.find(c => c.id === current)?.name ?? "cartão cadastrado"}` : "Sem vínculo confirmado"}</p></div>
        <select aria-label={`Cartão correspondente a ${a.name}`} className="min-w-0 rounded-md border bg-background p-2 text-sm" value={chosen} disabled={busy} onChange={e => setSelection(s => ({ ...s, [a.id]: e.target.value }))}>
          <option value="">Escolha seu cartão</option>{data.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Button size="sm" disabled={busy || !data.released || !chosen || chosen === current} onClick={() => link(a.id, chosen)}>Confirmar vínculo</Button>
        {current && <Button size="sm" variant="outline" disabled={busy || !data.released} onClick={() => link(a.id, null)}>Desvincular</Button>}
      </div>;
    })}
  </section>;
}
