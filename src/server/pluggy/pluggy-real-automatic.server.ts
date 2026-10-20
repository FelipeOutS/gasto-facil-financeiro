/** Real automation consumes only pre-existing, exact closed-batch grants.
 * It never creates grants or enables the global financial writer.
 */
import { canUseRealPreview, firstBatchActions, matchBatchGrant, reclassifyForPreview, validateGrantedActions, type FinancialGrantItem, PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED } from "@/lib/pluggy/real-preview";
import { planImport, type PlanAction } from "@/lib/pluggy/import-plan";
export const PLUGGY_REAL_AUTOMATIC_AUTHORIZED = false as const;
type Item = { account_id: string; transaction_id: string };
export type AutomaticDeps = {
  roles(): Promise<string[]>;
  enabled(): Promise<boolean>;
  grants(): Promise<Array<{ batch_id: string; expires_at: string; items: Item[] }>>;
  plan(items: Item[]): Promise<PlanAction[]>;
  apply(batch: string, actions: PlanAction[]): Promise<unknown>;
};
export async function runAuthorizedRealBatches(userId: string, deps: AutomaticDeps, released = false, now = new Date()) {
  if (!released) return { blocked: true, batches: 0 };
  if (!canUseRealPreview(userId, await deps.roles())) throw new Error("pluggy_nao_autorizado");
  if (!await deps.enabled()) return { disabled: true, batches: 0 };
  let batches = 0;
  for (const grant of await deps.grants()) {
    if (!(Date.parse(grant.expires_at) > now.getTime())) continue;
    const actions = (await deps.plan(grant.items)).filter(a => a.op === "insert" && grant.items.some(i => i.account_id === a.account_id && i.transaction_id === a.transaction_id));
    if (matchBatchGrant([grant], actions) !== grant.batch_id) continue; // ambiguous/changed item blocks whole batch
    if (!await deps.enabled()) break; // consent may have been revoked during planning
    await deps.apply(grant.batch_id, actions);
    batches++;
  }
  return { batches };
}

export async function runRealAutomaticAfterSync(userId: string) {
  if (!PLUGGY_REAL_AUTOMATIC_AUTHORIZED || !PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED) return { blocked: true, batches: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createImportDeps, readRealTxs, rows } = await import("./pluggy-import-store.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const deps = createImportDeps(db);
  return runAuthorizedRealBatches(userId, {
    roles: () => deps.roles(userId),
    enabled: async () => {
      const r = await db.from("pluggy_settings").select("real_auto_import").eq("user_id", userId).maybeSingle();
      if (r.error) throw new Error("pluggy_leitura_indisponivel");
      return r.data?.real_auto_import === true;
    },
    grants: async () => {
      const g = await rows(() => db.from("pluggy_real_batch_grants").select("batch_id,expires_at").eq("user_id", userId).is("consumed_at", null).order("batch_id"));
      const items = await rows(() => db.from("pluggy_real_batch_grant_items").select("batch_id,account_id,transaction_id").eq("user_id", userId).order("batch_id").order("transaction_id"));
      return g.map(b => ({ batch_id: String(b.batch_id), expires_at: String(b.expires_at), items: items.filter(i => i.batch_id === b.batch_id).map(i => ({ account_id: String(i.account_id), transaction_id: String(i.transaction_id) })) }));
    },
    plan: async items => {
      const g = await rows(() => db.from("pluggy_real_batch_grant_items").select("account_id,transaction_id,data").eq("user_id", userId).order("data").order("transaction_id"));
      const dates = g.filter(i => items.some(t => t.account_id === i.account_id && t.transaction_id === i.transaction_id)).map(i => String(i.data)).sort();
      if (!dates.length) return [];
      const txs = (await readRealTxs(db, userId, { from: dates[0], to: dates[dates.length-1] })).map(reclassifyForPreview);
      const [cardLinks, categorias, imported, existing] = await Promise.all([deps.cardLinks(userId), deps.categorias(userId), deps.imported(userId), deps.existing(userId, dates[0], dates[dates.length-1])]);
      return firstBatchActions(planImport({ userId, txs, cardLinks, categorias, imported, existing }), txs);
    },
    apply: async (batchId, actions) => {
      const granted = await rows(() => db.from("pluggy_real_batch_grant_items").select("account_id,transaction_id,entry_table,valor,data,categoria_id,tipo").eq("user_id", userId).eq("batch_id", batchId).order("transaction_id"));
      if (!validateGrantedActions(actions, granted as FinancialGrantItem[])) throw new Error("pluggy_autorizacao_divergente");
      const result = await db.rpc("pluggy_import_apply_real_automatic", { p_user_id: userId, p_batch_id: batchId, p_rows: actions.map(a => ({ account_id: a.account_id, transaction_id: a.transaction_id, descricao: a.op === "insert" ? a.row.descricao : "", estabelecimento: a.op === "insert" && a.table === "gastos" ? a.row.estabelecimento : "" })) });
      if (result.error) throw new Error("pluggy_import_rpc_indisponivel");
      return result.data;
    },
  }, true);
}
