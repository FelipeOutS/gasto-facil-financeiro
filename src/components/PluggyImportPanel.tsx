import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Undo2, Link2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { pluggyImport, type PluggyImportInput } from "@/lib/pluggy/import.functions";

type Result = Awaited<ReturnType<typeof pluggyImport>>;
type Preview = Extract<Result, { cards: unknown }>;
type Account = { account_id: string; name: string; number_last4: string | null; type: string };

/** All import controls use the server-derived gate; preview itself never writes. */
export function PluggyImportPanel({ accounts }: { accounts: Account[] }) {
  const call = useServerFn(pluggyImport);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [batchId, setBatchId] = useState<string | null>(null);
  async function refresh() {
    const r = await call({ data: { action: "preview" } });
    if ("cards" in r) setPreview(r);
  }
  async function act(data: PluggyImportInput) {
    setBusy(true);
    try {
      const r = await call({ data });
      if ("ok" in r && !r.ok) throw new Error("error" in r ? r.error : "erro");
      if (data.action === "preview") { if ("cards" in r) setPreview(r); }
      else {
        if ("resultado" in r) {
          const result = r.resultado;
          toast.success(result && "revertidos" in result ? `${result.revertidos} retirados; ${result.preservados} preservados.` : `Importação concluída: ${result?.gastos ?? 0} gastos e ${result?.receitas ?? 0} receitas.`);
        }
        else toast.success("Salvo.");
        await refresh();
        if (data.action === "history") setBatchId(null);
      }
    } catch {
      toast.error("Não foi possível concluir. A importação permanece bloqueada se ainda não foi autorizada.");
    } finally { setBusy(false); }
  }
  const enabled = !!preview?.schemaReady && !!preview?.releaseAuthorized && !busy;
  const review = preview?.actions.filter((a) => a.op === "review") ?? [];
  return (
    <section className="mt-7 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Importação para Gastos e Receitas</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "preview" })}><Eye className="mr-2 h-4 w-4" />Prévia sem lançar</Button>
      </div>
      {preview && <>
        <p className="text-xs text-muted-foreground">{preview.schemaReady ? "Estrutura disponível." : "Estrutura de importação aguardando aprovação."} {preview.releaseAuthorized ? "Importação autorizada." : "Gravação bloqueada."}</p>
        <label className="flex items-center justify-between gap-3 text-sm">Importar novas movimentações automaticamente<Switch checked={preview.autoImport} disabled={!enabled} onCheckedChange={(v) => { if (confirm(v ? "Autorizar importações automáticas das suas novas movimentações elegíveis?" : "Desativar a importação automática?")) void act({ action: "automatic", enabled: v, confirmed: true }); }} /></label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([["Gastos", preview.resumo.gastos], ["Receitas", preview.resumo.receitas], ["Revisão", preview.resumo.revisao], ["Ignorados", preview.resumo.ignorados], ["Atualizações", preview.resumo.atualizacoes], ["Remoções reversíveis", preview.resumo.remocoes]] as const).map(([label, count]) => <div key={label} className="border-b border-border py-3"><p className="text-xl font-semibold">{count}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
        </div>
        {accounts.filter((a) => a.type === "CREDIT").map((a) => <div key={a.account_id} className="space-y-2 border-b border-border py-3">
          <p className="text-sm font-medium">{a.name} {a.number_last4 ? `••${a.number_last4}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <select aria-label={`Cartão vinculado a ${a.name}`} className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-sm" value={links[a.account_id] ?? ""} onChange={(e) => setLinks((v) => ({ ...v, [a.account_id]: e.target.value }))}>
              <option value="">Escolha seu cartão…</option>
              {preview.cards.map((c) => <option key={c.id} value={c.id}>{c.nome} · fecha {c.dia_fechamento}, vence {c.dia_vencimento}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!enabled || !links[a.account_id]} onClick={() => { const cardId = links[a.account_id]; if (cardId && confirm("Confirmar que este é o mesmo cartão? Lançamentos anteriores não serão movidos.")) void act({ action: "link", accountId: a.account_id, cardId, confirmed: true }); }}><Link2 className="mr-2 h-4 w-4" />Confirmar vínculo</Button>
          </div>
        </div>)}
        <Button disabled={!enabled || preview.resumo.gastos + preview.resumo.receitas + preview.resumo.atualizacoes + preview.resumo.remocoes === 0} onClick={() => { if (confirm("Confirmar o lançamento deste histórico em Gastos e Receitas? Movimentações em revisão ficam de fora.")) { const id = batchId ?? crypto.randomUUID(); setBatchId(id); void act({ action: "history", batchId: id, confirmed: true }); } }}><Download className="mr-2 h-4 w-4" />Confirmar importação do histórico</Button>
        <h3 className="text-sm font-semibold">Revisão da importação ({review.length})</h3>
        {review.map((a) => <div key={`${a.account_id}:${a.transaction_id}`} className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{preview.transactions.find((t) => t.account_id === a.account_id && t.transaction_id === a.transaction_id)?.description ?? "Movimentação sem descrição"}</p>
          <p className="break-all text-xs text-muted-foreground">{a.transaction_id}</p>
          <p className="mt-1 text-sm">{a.op === "review" ? a.reason.replace(/_/g, " ") : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!enabled} onClick={() => confirm("Confirmar que esta movimentação é legítima e não está lançada por outra origem?") && act({ action: "review", accountId: a.account_id, transactionId: a.transaction_id, decision: "aprovado" })}>É legítima</Button>
            <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => act({ action: "review", accountId: a.account_id, transactionId: a.transaction_id, decision: "rejeitado" })}>É duplicada</Button>
            <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => act({ action: "review", accountId: a.account_id, transactionId: a.transaction_id, decision: null })}>Voltar a pendente</Button>
          </div>
        </div>)}
        {preview.transactions.filter((t) => t.review_status).map((t) => <div key={`decision:${t.account_id}:${t.transaction_id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3"><p className="text-sm">{t.description} · {t.review_status}</p><Button size="sm" variant="ghost" disabled={!enabled} onClick={() => act({ action: "review", accountId: t.account_id, transactionId: t.transaction_id, decision: null })}>Voltar a pendente</Button></div>)}
        <h3 className="text-sm font-semibold">Importações anteriores</h3>
        {preview.batches.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma importação realizada.</p>}
        {preview.batches.map((b) => <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3">
          <p className="text-xs">{new Date(b.data_importacao).toLocaleString("pt-BR")} · {b.qtd_movimentacoes} lançamentos · {b.status}</p>
          <Button size="sm" variant="outline" disabled={!enabled || b.status === "revertido" || b.qtd_movimentacoes === 0} onClick={() => confirm("Desfazer os lançamentos criados nesta importação? Edições manuais serão preservadas. Atualizações de lotes incrementais não são revertidas.") && act({ action: "revert", batchId: b.id, confirmed: true })}><Undo2 className="mr-2 h-4 w-4" />Desfazer</Button>
        </div>)}
      </>}
    </section>
  );
}