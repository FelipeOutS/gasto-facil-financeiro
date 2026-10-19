import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), simulationLinks: z.array(z.object({ accountId: z.string().min(1).max(100), cardId: z.string().uuid() })).max(20).optional() }),
  z.object({ action: z.literal("preview_real"), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("history"), batchId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("revert"), batchId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("link"), accountId: z.string().min(1).max(100), cardId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("unlink"), accountId: z.string().min(1).max(100), confirmed: z.literal(true) }),
  z.object({ action: z.literal("review"), accountId: z.string().min(1).max(100), transactionId: z.string().min(1).max(100), decision: z.enum(["aprovado", "rejeitado"]).nullable() }),
  z.object({ action: z.literal("automatic"), enabled: z.boolean(), confirmed: z.literal(true) }),
]);
export type PluggyImportInput = z.input<typeof Input>;

/** No userId, release flag, plan actions or financial values are accepted from the browser. */
export const pluggyImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PluggyImportInput) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { isPluggyAllowed } = await import("@/lib/pluggy/rules");
    const roles = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roles.error || !isPluggyAllowed(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
    const { runPluggyImport, revertPluggyImport, PLUGGY_IMPORT_RELEASE_AUTHORIZED } = await import("@/server/pluggy/pluggy-import.server");
    // Before any privileged import, financial write, or RPC call. Never supplied by client.
    if (data.action !== "preview" && data.action !== "preview_real" && !PLUGGY_IMPORT_RELEASE_AUTHORIZED) throw new Error("importacao_bloqueada");
    const { createImportDeps, importSchemaReady, readRealTxs } = await import("@/server/pluggy/pluggy-import-store.server");
    const deps = createImportDeps(context.supabase);
    if (data.action === "preview_real") {
      // Somente leitura: nenhum RPC, nenhum cliente privilegiado, nenhuma gravação.
      const rp = await import("@/lib/pluggy/real-preview");
      if (!rp.canUseRealPreview(context.userId, (roles.data ?? []).map((r) => r.role))) throw new Error("pluggy_nao_autorizado");
      const win = rp.realPreviewWindow(data.from);
      const txs = (await readRealTxs(context.supabase, context.userId, win)).map(rp.reclassifyForPreview);
      const [cardLinks, categorias, imported, existing] = await Promise.all([
        deps.cardLinks(context.userId), deps.categorias(context.userId), deps.imported(context.userId), deps.existing(context.userId, win.from, win.to),
      ]);
      const { planImport, summarizePlan } = await import("@/lib/pluggy/import-plan");
      const actions = planImport({ userId: context.userId, txs, cardLinks, categorias, imported, existing });
      const lote = rp.firstBatchActions(actions, txs);
      return { real: true as const, window: win, resumo: summarizePlan(actions), lines: rp.groupRealPreview(actions, txs), firstBatch: lote.map((a) => ({ transaction_id: a.transaction_id, table: a.op === "insert" ? a.table : null, row: a.op === "insert" ? a.row : null })), existingCount: existing.length, releaseAuthorized: PLUGGY_IMPORT_RELEASE_AUTHORIZED };
    }
    if (data.action === "preview") {
      const [plan, schemaReady, cards, transactions, settings, cardLinks, categorias, imported] = await Promise.all([
        runPluggyImport(deps, { userId: context.userId, batchId: crypto.randomUUID(), mode: "previa" }),
        importSchemaReady(context.supabase, context.userId),
        context.supabase.from("cartoes").select("id,nome,dia_fechamento,dia_vencimento").eq("user_id", context.userId).order("nome"),
        deps.txs(context.userId),
        deps.settings(context.userId),
        deps.cardLinks(context.userId),
        deps.categorias(context.userId),
        deps.imported(context.userId),
      ]);
      if (cards.error || !plan.ok || !plan.actions) throw new Error("pluggy_leitura_indisponivel");
      // Batches are read only when candidate schema exists; no seed/creation on page load.
      const batches = schemaReady ? await context.supabase.from("extratos_importados").select("id,status,data_importacao,qtd_movimentacoes").eq("user_id", context.userId).eq("tipo_origem", "pluggy").order("data_importacao", { ascending: false }).limit(30) : { data: [], error: null };
      if (batches.error) throw new Error("pluggy_leitura_indisponivel");
      const dates = transactions.map((t) => t.date).sort();
      const existing = dates.length ? await deps.existing(context.userId, dates[0], dates[dates.length - 1]) : [];
      const { simulateCardLinks } = await import("@/lib/pluggy/import-preview");
      const simulated = (data.simulationLinks?.length ?? 0) > 0;
      const result = simulated ? simulateCardLinks({ userId: context.userId, txs: transactions, cardLinks, categorias, imported, existing }, cards.data ?? [], data.simulationLinks ?? []) : { actions: plan.actions, resumo: plan.resumo };
      return { ...plan, ...result, simulated, cardLinks, categorias, existing, transactions: transactions.map((t) => ({ account_id: t.account_id, transaction_id: t.transaction_id, description: t.description, amount: t.amount, date: t.date, review_status: t.review_status, categoria: t.categoria_manual ?? t.categoria_sugerida, mp_match_ids: t.mp_match_ids })), schemaReady, autoImport: settings?.auto_import === true, releaseAuthorized: PLUGGY_IMPORT_RELEASE_AUTHORIZED, cards: cards.data ?? [], batches: batches.data ?? [] };
    }
    if (!(await importSchemaReady(context.supabase, context.userId))) throw new Error("pluggy_import_rpc_indisponivel");
    if (data.action === "history") return runPluggyImport(deps, { userId: context.userId, batchId: data.batchId, mode: "historico_inicial", confirmed: true });
    if (data.action === "revert") return revertPluggyImport(deps, { userId: context.userId, batchId: data.batchId });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    if (data.action === "automatic") {
      // Consent is explicit; activation does not sync or import any rows itself.
      const r = await db.from("pluggy_settings").update({ auto_import: data.enabled }).eq("user_id", context.userId).select("auto_import").single();
      if (r.error || r.data?.auto_import !== data.enabled) throw new Error("pluggy_preferencia_nao_confirmada");
      return { ok: true as const };
    }
    const result = data.action === "link" || data.action === "unlink"
      ? await db.rpc("pluggy_link_card", { p_user_id: context.userId, p_account_id: data.accountId, p_cartao_id: data.action === "link" ? data.cardId : null })
      : await db.rpc("pluggy_review_decide", { p_user_id: context.userId, p_account_id: data.accountId, p_transaction_id: data.transactionId, p_decision: data.decision });
    if (result.error) throw new Error("pluggy_import_rpc_indisponivel");
    return { ok: true as const };
  });