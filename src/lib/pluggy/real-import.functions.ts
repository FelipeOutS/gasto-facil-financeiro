import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_real"), from: Day }),
  z.object({ action: z.literal("real_status") }),
  z.object({ action: z.literal("import_real_once"), from: Day, selection: z.array(z.object({ accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100) })).min(1).max(1), confirmed: z.literal(true) }),
  z.object({ action: z.literal("revert_real_once"), accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100), confirmed: z.literal(true) }),
]);
export type PluggyRealImportInput = z.input<typeof Input>;

/**
 * Mercado Pago real (conector 606), só Admin Master. A prévia nunca grava; importar/desfazer
 * exigem a trava de código PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED e a autorização literal no banco.
 * O lote vem SEMPRE da autorização aprovada (lida no servidor); o navegador nunca escolhe o lote.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authorizedBatch(admin: any, userId: string, accountId: string, transactionId: string): Promise<string> {
  const g = await admin.from("pluggy_real_import_grants").select("batch_id").eq("user_id", userId).eq("account_id", accountId).eq("transaction_id", transactionId).maybeSingle();
  if (g.error || !g.data?.batch_id) throw new Error("pluggy_autorizacao_inexistente");
  return g.data.batch_id as string;
}
export const pluggyRealImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PluggyRealImportInput) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { isPluggyAllowed } = await import("@/lib/pluggy/rules");
    const roles = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roles.error || !isPluggyAllowed(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
    const { PLUGGY_IMPORT_RELEASE_AUTHORIZED: releaseAuthorized } = await import("@/server/pluggy/pluggy-import.server");
    const { createImportDeps, readRealTxs } = await import("@/server/pluggy/pluggy-import-store.server");
    const deps = createImportDeps(context.supabase);
    if (data.action === "real_status") {
      // Somente leitura: autorizações já consumidas do próprio usuário + lançamento criado.
      const rp = await import("@/lib/pluggy/real-preview");
      if (!rp.canUseRealPreview(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = supabaseAdmin as any;
      const g = await a.from("pluggy_real_import_grants").select("account_id,transaction_id,entry_table,batch_id,consumed_at,reverted_at,revert_outcome").eq("user_id", context.userId).not("consumed_at", "is", null);
      if (g.error) throw new Error("pluggy_status_indisponivel");
      const lotes = [];
      for (const row of g.data ?? []) {
        const e = await context.supabase.from("pluggy_import_entries").select("entry_id,state").eq("user_id", context.userId).eq("batch_id", row.batch_id).eq("transaction_id", row.transaction_id).maybeSingle();
        const tbl = row.entry_table === "gastos" ? "gastos" : "receitas";
        const l = e.data?.entry_id ? await context.supabase.from(tbl).select("descricao,valor,data,deleted_at").eq("id", e.data.entry_id).eq("user_id", context.userId).maybeSingle() : null; // soft-delete-exceção: mostra estado do item do lote
        lotes.push({ accountId: row.account_id as string, transactionId: row.transaction_id as string, batchId: row.batch_id as string, table: tbl, revertido: !!row.reverted_at, resultado: (row.revert_outcome ?? null) as string | null, estado: (e.data?.state ?? null) as string | null, lancamento: l?.data ? { descricao: l.data.descricao as string, valor: Number(l.data.valor), data: l.data.data as string, excluido: !!l.data.deleted_at } : null });
      }
      return { status: true as const, lotes, revertAuthorized: rp.PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED };
    }
    if (data.action === "revert_real_once") {
      const rp = await import("@/lib/pluggy/real-preview");
      if (!rp.canUseRealPreview(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
      if (!rp.PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED) throw new Error("importacao_bloqueada");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batchId = await authorizedBatch(supabaseAdmin, context.userId, data.accountId, data.transactionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (supabaseAdmin as any).rpc("pluggy_import_revert_real_once", { p_user_id: context.userId, p_batch_id: batchId });
      if (r.error) throw new Error("pluggy_import_rpc_indisponivel");
      return { ok: true as const, resultado: r.data as { resultado: "revertido" | "parcial"; revertidos: number; preservados: number; replay: boolean } };
    }
    {
      // Prévia: somente leitura. Importação: revalida tudo no servidor e só grava pela RPC única autorizada.
      const rp = await import("@/lib/pluggy/real-preview");
      if (!rp.canUseRealPreview(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
      if (data.action === "import_real_once" && !rp.PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED) throw new Error("importacao_bloqueada");
      const win = rp.realPreviewWindow(data.from);
      const txs = (await readRealTxs(context.supabase, context.userId, win)).map(rp.reclassifyForPreview);
      const [cardLinks, categorias, imported, existing] = await Promise.all([
        deps.cardLinks(context.userId), deps.categorias(context.userId), deps.imported(context.userId), deps.existing(context.userId, win.from, win.to),
      ]);
      const { planImport, summarizePlan } = await import("@/lib/pluggy/import-plan");
      const actions = planImport({ userId: context.userId, txs, cardLinks, categorias, imported, existing });
      const lote = rp.firstBatchActions(actions, txs);
      if (data.action === "import_real_once") {
        const [chosen] = rp.pickRealSelection(lote, data.selection);
        if (chosen.op !== "insert") throw new Error("movimentacao_nao_elegivel");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batchId = await authorizedBatch(supabaseAdmin, context.userId, chosen.account_id, chosen.transaction_id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await (supabaseAdmin as any).rpc("pluggy_import_apply_real_once", { p_user_id: context.userId, p_account_id: chosen.account_id, p_transaction_id: chosen.transaction_id, p_batch_id: batchId, p_row: chosen.row });
        if (r.error) throw new Error("pluggy_import_rpc_indisponivel");
        return { ok: true as const, resultado: r.data as { gastos: number; receitas: number; replay: boolean; batch_id: string } };
      }
      return { real: true as const, window: win, resumo: summarizePlan(actions), lines: rp.groupRealPreview(actions, txs, lote), firstBatch: lote.map((a) => ({ account_id: a.account_id, transaction_id: a.transaction_id, table: a.op === "insert" ? a.table : null, row: a.op === "insert" ? a.row : null })), existingCount: existing.length, releaseAuthorized: releaseAuthorized, realFirstImportAuthorized: rp.PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED };
    }
  });
