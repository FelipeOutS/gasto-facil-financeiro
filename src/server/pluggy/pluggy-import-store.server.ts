import type { ImportDeps } from "./pluggy-import.server";
import type { EntrySnapshot, ImportedEntry, PlanTx } from "@/lib/pluggy/import-plan";

// Candidate tables are deliberately absent from generated types until approved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Row = Record<string, unknown>;
const missing = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

/** Paginated, owner-scoped reads; never silently plan with a truncated financial ledger. */
async function rows(query: () => Db): Promise<Row[]> {
  const result: Row[] = [];
  for (let page = 0; page < 100; page++) {
    const r = await query().range(page * 500, page * 500 + 499);
    if (r.error) throw new Error("pluggy_leitura_indisponivel");
    result.push(...(r.data ?? []));
    if ((r.data ?? []).length < 500) return result;
  }
  throw new Error("pluggy_leitura_excede_limite");
}

function snapshot(row: Row): EntrySnapshot {
  return { valor: Number(row.valor), data: String(row.data), descricao: String(row.descricao), categoria_id: row.categoria_id == null ? null : String(row.categoria_id), updated_at: String(row.updated_at), cartao_id: row.cartao_id == null ? null : String(row.cartao_id) };
}

/** Read client is authenticated/RLS; privileged client is loaded only inside gated RPC writers. */
export function createImportDeps(db: Db): ImportDeps {
  const rpc = async (name: string, args: Row) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await (supabaseAdmin as Db).rpc(name, args);
    if (r.error) throw new Error("pluggy_import_rpc_indisponivel");
    return r.data as Record<string, unknown>;
  };
  return {
    async roles(userId) {
      const r = await db.from("user_roles").select("role").eq("user_id", userId);
      if (r.error) throw new Error("pluggy_nao_autorizado");
      return (r.data ?? []).map((r: { role: string }) => r.role);
    },
    async settings(userId) {
      const r = await db.from("pluggy_settings").select("auto_import").eq("user_id", userId).maybeSingle();
      if (r.error) throw new Error("pluggy_leitura_indisponivel");
      return r.data;
    },
    async txs(userId) {
      const [txs, accounts, items] = await Promise.all([
        rows(() => db.from("pluggy_transactions").select("*").eq("user_id", userId).order("id")),
        rows(() => db.from("pluggy_accounts").select("account_id,item_id,type,is_sandbox").eq("user_id", userId).order("id")),
        rows(() => db.from("pluggy_items").select("item_id,is_sandbox").eq("user_id", userId).is("deleted_at", null).order("id")),
      ]);
      const active = new Set(items.filter((i) => i.is_sandbox === true).map((i) => i.item_id));
      const allowed = new Map(accounts.filter((a) => a.is_sandbox === true && active.has(a.item_id) && (a.type === "BANK" || a.type === "CREDIT")).map((a) => [a.account_id, a.type]));
      return txs.filter((t) => t.is_sandbox === true && allowed.has(t.account_id)).map((t) => ({ ...t, amount: Number(t.amount), amount_original: t.amount_original == null ? null : Number(t.amount_original), account_type: allowed.get(t.account_id) })) as PlanTx[];
    },
    async cardLinks(userId) {
      const r = await db.from("pluggy_card_links").select("account_id,cartao_id").eq("user_id", userId).eq("active", true);
      if (missing(r.error)) return []; // before migration, unlinked card purchases go to review
      if (r.error) throw new Error("pluggy_leitura_indisponivel");
      const cards = await rows(() => db.from("cartoes").select("id,dia_fechamento,dia_vencimento").eq("user_id", userId).order("id"));
      return (r.data ?? []).flatMap((l: { account_id: string; cartao_id: string }) => {
        const c = cards.find((c) => c.id === l.cartao_id);
        return c ? [{ ...l, dia_fechamento: Number(c.dia_fechamento), dia_vencimento: Number(c.dia_vencimento) }] : [];
      });
    },
    async categorias(userId) {
      return await rows(() => db.from("categorias").select("id,nome").eq("user_id", userId).order("id")) as Array<{ id: string; nome: string }>;
    },
    async imported(userId) {
      const probe = await db.from("pluggy_import_entries").select("id").eq("user_id", userId).limit(1);
      if (missing(probe.error)) return [];
      if (probe.error) throw new Error("pluggy_leitura_indisponivel");
      const [entries, gastos, receitas] = await Promise.all([
        rows(() => db.from("pluggy_import_entries").select("*").eq("user_id", userId).order("id")),
        rows(() => db.from("gastos").select("id,valor,data,descricao,categoria_id,updated_at,cartao_id").eq("user_id", userId).eq("origem", "pluggy").is("deleted_at", null).order("id")),
        rows(() => db.from("receitas").select("id,valor,data,descricao,updated_at").eq("user_id", userId).eq("origem", "pluggy").is("deleted_at", null).order("id")),
      ]);
      return entries.map((e) => {
        const current = (e.entry_table === "gastos" ? gastos : receitas).find((r) => r.id === e.entry_id);
        return { ...e, current: current ? snapshot(current) : null };
      }) as ImportedEntry[];
    },
    async existing(userId, from, to) {
      const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
      const result = await Promise.all((["gastos", "receitas"] as const).map(async (table) => {
        const found = await rows(() => db.from(table).select("id,valor,data,descricao,origem").eq("user_id", userId).is("deleted_at", null).gte("data", shift(from, -1)).lte("data", shift(to, 1)).order("id"));
        return found.map((r) => ({ table, id: String(r.id), valor: Number(r.valor), data: String(r.data), descricao: String(r.descricao), origem: r.origem == null ? null : String(r.origem) }));
      }));
      return result.flat();
    },
    apply: (userId, batchId, actions) => rpc("pluggy_import_apply", { p_user_id: userId, p_batch_id: batchId, p_actions: actions }),
    revert: (userId, batchId) => rpc("pluggy_import_revert", { p_user_id: userId, p_batch_id: batchId }),
  };
}

/** Leitura RLS das transações reais (conector permitido) na janela; nunca escreve. */
export async function readRealTxs(db: Db, userId: string, win: { from: string; to: string }) {
  const { selectRealTxs } = await import("@/lib/pluggy/real-preview");
  const [txs, accounts, items] = await Promise.all([
    rows(() => db.from("pluggy_transactions").select("*").eq("user_id", userId).eq("is_sandbox", false).gte("date", win.from).lte("date", win.to).order("id")),
    rows(() => db.from("pluggy_accounts").select("account_id,item_id,type,is_sandbox").eq("user_id", userId).eq("is_sandbox", false).order("id")),
    rows(() => db.from("pluggy_items").select("item_id,is_sandbox,connector_id,deleted_at").eq("user_id", userId).eq("is_sandbox", false).is("deleted_at", null).order("id")),
  ]);
  const norm = txs.map((t) => ({ ...t, amount: Number(t.amount), amount_original: t.amount_original == null ? null : Number(t.amount_original) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return selectRealTxs(items as any, accounts as any, norm as any, win);
}

export async function importSchemaReady(db: Db, userId: string): Promise<boolean> {
  const results = await Promise.all(["pluggy_card_links", "pluggy_import_entries", "pluggy_review_decisions"].map((t) => db.from(t).select("user_id").eq("user_id", userId).limit(1)));
  if (results.some((r) => r.error && !missing(r.error))) throw new Error("pluggy_leitura_indisponivel");
  return results.every((r) => !r.error);
}