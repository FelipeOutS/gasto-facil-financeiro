import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pluggyRealImport } from "@/lib/pluggy/real-import.functions";

type Status = Extract<Awaited<ReturnType<typeof pluggyRealImport>>, { status: true }>;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (d: string) => d.split("-").reverse().join("/");

/** Importações reais já feitas (somente o lote autorizado) com opção de desfazer reversível. */
export function PluggyRealUndo() {
  const call = useServerFn(pluggyRealImport);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    try { const r = await call({ data: { action: "real_status" } }); if ("status" in r) setSt(r as Status); } catch { setSt(null); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st || st.lotes.length === 0) return null;
  async function desfazer(l: Status["lotes"][number]) {
    const x = l.lancamento;
    const txt = x ? `${x.descricao} · ${brl(x.valor)} · ${dt(x.data)}` : "lançamento do lote";
    if (!confirm(`Desfazer importação?\n\nSerá excluída (de forma reversível) apenas esta ${l.table === "gastos" ? "despesa" : "receita"}:\n${txt}\n\nLote ${l.batchId}\nNenhum outro lançamento será afetado. Se ela foi editada, será preservada.`)) return;
    setBusy(true);
    try {
      const r = await call({ data: { action: "revert_real_once", accountId: l.accountId, transactionId: l.transactionId, confirmed: true } });
      const res = "resultado" in r ? (r.resultado as { resultado: string; replay: boolean }) : null;
      toast.success(res?.replay ? "Essa importação já tinha sido desfeita." : res?.resultado === "parcial" ? "Lançamento editado foi preservado." : "Importação desfeita.");
      await load();
    } catch { toast.error("Não foi possível desfazer. Nada foi alterado."); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-7 space-y-3">
      <h2 className="text-sm font-semibold">Importações reais realizadas</h2>
      {st.lotes.map((l) => (
        <div key={l.batchId} className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs">
            <p className="text-sm font-medium">
              {l.lancamento ? `${l.lancamento.descricao} · ${brl(l.lancamento.valor)} · ${dt(l.lancamento.data)}` : "Lançamento não encontrado"}
            </p>
            <p className="text-muted-foreground">{l.table === "gastos" ? "Gastos" : "Receitas"} · Open Finance — Mercado Pago</p>
            <p className="break-all text-muted-foreground">Lote {l.batchId}</p>
            <p className="text-muted-foreground">{l.revertido ? (l.resultado === "parcial" ? "Desfeito parcialmente (editado preservado)" : "Importação desfeita") : "Importado"}</p>
          </div>
          {!l.revertido && (
            <Button size="sm" variant="destructive" className="w-full sm:w-auto" disabled={busy || !st.revertAuthorized} onClick={() => desfazer(l)}>
              <Undo2 className="mr-2 h-4 w-4" />Desfazer importação
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
