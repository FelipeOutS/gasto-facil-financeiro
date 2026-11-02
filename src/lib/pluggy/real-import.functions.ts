import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_real"), from: Day, to: Day.optional() }),
  z.object({ action: z.literal("real_status") }),
  z.object({ action: z.literal("import_real_once"), from: Day, to: Day.optional(), selection: z.array(z.object({ accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100) })).min(1).max(1), confirmed: z.literal(true) }),
  z.object({ action: z.literal("revert_real_once"), accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100), confirmed: z.literal(true) }),
  z.object({ action: z.literal("import_real_batch"), from: Day, to: Day.optional(), selection: z.array(z.object({ accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100) })).min(1).max(10), confirmed: z.literal(true) }),
  z.object({ action: z.literal("revert_real_batch"), batchId: z.string().uuid(), entryIds: z.array(z.string().uuid()).min(1).max(10).optional(), confirmed: z.literal(true) }),
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
      // Histórico dos lotes fechados (Fase 4). Tabela ausente = SQL ainda não aplicado: lista vazia.
      const bg = await a.from("pluggy_real_batch_grants").select("batch_id,item_count,total,consumed_at,reverted_at,revert_outcome").eq("user_id", context.userId).not("consumed_at", "is", null);
      const lotesFechados = [];
      if (bg.error && !["42P01", "PGRST205"].includes(bg.error.code)) throw new Error("pluggy_status_indisponivel");
      for (const row of bg.error ? [] : bg.data ?? []) {
        const entries = await context.supabase.from("pluggy_import_entries").select("entry_id,entry_table,state,snapshot").eq("user_id", context.userId).eq("batch_id", row.batch_id);
        if (entries.error) throw new Error("pluggy_status_indisponivel");
        const ex = await context.supabase.from("extratos_importados").select("status,total_receitas,total_despesas,periodo_inicio,periodo_fim").eq("id", row.batch_id).eq("user_id", context.userId).maybeSingle();
        lotesFechados.push({ entries: (entries.data ?? []).map(e => ({ id: e.entry_id, table: e.entry_table, state: e.state, snapshot: e.snapshot as { descricao?: string; valor?: number; data?: string } })), batchId: row.batch_id as string, itens: Number(row.item_count), total: Number(row.total), revertido: !!row.reverted_at, resultado: (row.revert_outcome ?? null) as string | null, status: (ex.data?.status ?? null) as string | null, receitas: Number(ex.data?.total_receitas ?? 0), despesas: Number(ex.data?.total_despesas ?? 0), de: (ex.data?.periodo_inicio ?? null) as string | null, ate: (ex.data?.periodo_fim ?? null) as string | null });
      }
      return { status: true as const, lotes, lotesFechados, revertAuthorized: rp.PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED, batchRevertAuthorized: rp.PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED };
    }
    if (data.action === "revert_real_batch") {
      const rp = await import("@/lib/pluggy/real-preview");
      if (!rp.canUseRealPreview(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
      if (!rp.PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED) throw new Error("importacao_bloqueada");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = supabaseAdmin as any;
      const g = await a.from("pluggy_real_batch_grants").select("batch_id").eq("user_id", context.userId).eq("batch_id", data.batchId).not("consumed_at", "is", null).maybeSingle();
      if (g.error || !g.data) throw new Error("pluggy_lote_inexistente");
      const r = data.entryIds
        ? await a.rpc("pluggy_import_revert_real_batch_items", { p_user_id: context.userId, p_batch_id: g.data.batch_id, p_entry_ids: data.entryIds })
        : await a.rpc("pluggy_import_revert_real_batch", { p_user_id: context.userId, p_batch_id: g.data.batch_id });
      if (r.error) throw new Error("pluggy_import_rpc_indisponivel");
      return { ok: true as const, resultado: r.data as { resultado: "revertido" | "parcial"; revertidos: number; preservados: number; replay: boolean } };
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
      const win = rp.realPreviewWindow(data.from, data.to);
      const txs = (await readRealTxs(context.supabase, context.userId, win)).map(rp.reclassifyForPreview);
      const [cardLinks, categorias, imported, existing] = await Promise.all([
        deps.cardLinks(context.userId), deps.categorias(context.userId), deps.imported(context.userId), deps.existing(context.userId, win.from, win.to),
      ]);
      const { planImport, summarizePlan } = await import("@/lib/pluggy/import-plan");
      const actions = planImport({ userId: context.userId, txs, cardLinks, categorias, imported, existing });
      // Nunca repropõe transação já importada, inclusive desfeita (ex.: 1º teste de R$ 0,01).
      const prev = await context.supabase.from("pluggy_import_entries").select("account_id,transaction_id").eq("user_id", context.userId);
      if (prev.error) throw new Error("pluggy_status_indisponivel");
      const done = new Set((prev.data ?? []).map((e) => `${e.account_id}|${e.transaction_id}`));
      const lote = rp.closedBatchActions(actions, txs, data.action !== "import_real_once" && rp.PLUGGY_REAL_CARD_IMPORT_AUTHORIZED).filter((a) => !done.has(`${a.account_id}|${a.transaction_id}`));
      if (data.action === "import_real_batch") {
        if (!rp.PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED) throw new Error("importacao_bloqueada");
        const chosen = rp.pickRealBatchSelection(lote, data.selection);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = supabaseAdmin as any;
        const gi = await a.from("pluggy_real_batch_grant_items").select("*").eq("user_id", context.userId);
        if (gi.error) throw new Error("pluggy_autorizacao_inexistente");
        const byBatch = new Map<string, { account_id: string; transaction_id: string }[]>();
        for (const i of gi.data ?? []) byBatch.set(i.batch_id, [...(byBatch.get(i.batch_id) ?? []), i]);
        const batchId = rp.matchBatchGrant([...byBatch].map(([batch_id, items]) => ({ batch_id, items })), chosen);
        if (!batchId || !rp.validateGrantedActions(chosen, (gi.data ?? []).filter((i: { batch_id: string }) => i.batch_id === batchId), txs)) throw new Error("pluggy_lote_nao_autorizado");
        const rows = chosen.map((c) => ({ account_id: c.account_id, transaction_id: c.transaction_id, descricao: c.op === "insert" ? c.row.descricao : "", estabelecimento: c.op === "insert" && c.table === "gastos" ? (c.row.estabelecimento ?? "") : "" }));
        const r = await a.rpc("pluggy_import_apply_real_batch", { p_user_id: context.userId, p_batch_id: batchId, p_rows: rows });
        if (r.error) throw new Error("pluggy_import_rpc_indisponivel");
        return { ok: true as const, resultado: r.data as { gastos: number; receitas: number; replay: boolean; batch_id: string } };
      }
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
      return { real: true as const, window: win, resumo: summarizePlan(actions), lines: rp.groupRealPreview(actions, txs, lote), firstBatch: lote.map((a) => ({ account_id: a.account_id, transaction_id: a.transaction_id, table: a.op === "insert" ? a.table : null, row: a.op === "insert" ? a.row : null })), existingCount: existing.length, releaseAuthorized: releaseAuthorized, realFirstImportAuthorized: rp.PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED };
    }
  });
