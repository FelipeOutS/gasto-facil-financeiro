import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pluggyRealImport } from "@/lib/pluggy/real-import.functions";
import { previewReason } from "@/lib/pluggy/import-preview";

type Result = Awaited<ReturnType<typeof pluggyRealImport>>;
type Real = Extract<Result, { real: true }>;
const GROUPS = [["gasto", "Elegíveis para Gastos"], ["receita", "Elegíveis para Receitas"], ["duplicacao", "Possíveis duplicações"], ["cartao", "Cartão aguardando vínculo"], ["revisao", "Precisam de revisão"], ["ignorado", "Ignoradas"]] as const;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Prévia do Mercado Pago real (7 dias). Somente leitura: nenhum lançamento é criado. */
export function PluggyRealPreview() {
  const call = useServerFn(pluggyRealImport);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [data, setData] = useState<Real | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    try {
      const r = await call({ data: { action: "preview_real", from } });
      if ("real" in r && r.real === true) { setData(r as Real); setSel(null); }
    } catch { toast.error("Prévia real indisponível para esta conta ou período."); }
    finally { setBusy(false); }
  }
  const chosen = data?.firstBatch.find((b) => `${b.account_id}|${b.transaction_id}` === sel) ?? null;
  async function importar() {
    if (!data || !chosen?.row) return;
    const r = chosen.row;
    if (!confirm(`Criar exatamente 1 lançamento em ${chosen.table === "gastos" ? "Gastos" : "Receitas"}?\n${r.data} · ${r.descricao} · ${brl(r.valor)}\nPoderá ser desfeito enquanto não for editado.`)) return;
    setBusy(true);
    try {
      await call({ data: { action: "import_real_once", from: data.window.from, selection: [{ accountId: chosen.account_id, transactionId: chosen.transaction_id }], confirmed: true } });
      toast.success("Lançamento criado.");
      await run();
    } catch { toast.error("Importação real bloqueada ou movimentação não elegível. Nada foi gravado."); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-7 space-y-4">
      <h2 className="text-sm font-semibold">Prévia real — Mercado Pago (7 dias, sem lançar)</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Início do período<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-44" /></label>
        <Button variant="outline" size="sm" disabled={busy || !from} onClick={run}><Eye className="mr-2 h-4 w-4" />Ver prévia real</Button>
      </div>
      {data && <>
        <p className="text-xs text-muted-foreground">{data.window.from} a {data.window.to}. Gravação bloqueada — nada será lançado. Primeiro lote possível: {data.firstBatch.length} movimentações bancárias sem suspeita.</p>
        <div className="space-y-2 border-b border-border py-3">
          <p className="text-sm font-medium">Importar movimentações selecionadas</p>
          <p className="text-xs text-muted-foreground">Primeiro teste: escolha uma única movimentação bancária sem suspeita de duplicação.</p>
          {data.firstBatch.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma movimentação elegível neste período.</p>}
          {data.firstBatch.map((b) => b.row && <label key={b.account_id + b.transaction_id} className="flex items-center gap-2 text-xs">
            <input type="radio" name="real-sel" checked={sel === `${b.account_id}|${b.transaction_id}`} onChange={() => setSel(`${b.account_id}|${b.transaction_id}`)} />
            <span>{b.row.data} · {b.row.descricao} · {brl(b.row.valor)} → {b.table === "gastos" ? "Gastos" : "Receitas"}</span>
          </label>)}
          <Button size="sm" disabled={busy || !chosen || !data.realFirstImportAuthorized} onClick={importar}>Importar movimentações selecionadas</Button>
          {!data.realFirstImportAuthorized && <p className="text-xs text-muted-foreground">Gravação real bloqueada até autorização final.</p>}
        </div>
        {GROUPS.map(([g, label]) => {
          const lines = data.lines.filter((l) => l.grupo === g);
          return <details key={g} className="border-b border-border py-2">
            <summary className="cursor-pointer text-sm">{label}: <span className="font-semibold">{lines.length}</span> ({brl(lines.reduce((s, l) => s + l.amount, 0))})</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {lines.map((l) => <li key={l.account_id + l.transaction_id} className="flex flex-wrap justify-between gap-2">
                <span>{l.date} · {l.description ?? "Sem descrição"}{l.categoria ? ` · ${l.categoria}` : ""}</span>
                <span className="text-muted-foreground">{brl(l.amount)} → {l.destino}{l.motivo ? ` (${previewReason(l.motivo)})` : ""}</span>
              </li>)}
            </ul>
          </details>;
        })}
      </>}
    </section>
  );
}
