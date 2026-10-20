/**
 * Implementação real do PluggyStore sobre as tabelas pluggy_* (service role).
 * Toda consulta filtra user_id explicitamente; o chamador já foi autorizado.
 * Se as tabelas ainda não existirem (migração não aplicada), as chamadas falham fechado.
 */
import type { PluggyStore, TxRow } from "./pluggy-sync.server";
import { clampHistoryDays, type AccessState } from "@/lib/pluggy/rules";
import { rows as readRows } from "./pluggy-import-store.server";

export async function createPluggyStore(): Promise<PluggyStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Tabelas novas ainda não estão nos tipos gerados (migração candidata).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const must = (r: { error: unknown }) => {
    if (r.error) throw new Error("pluggy_store_indisponivel");
  };

  let hasOriginal: boolean | null = null;
  return {
    async getSettings(userId) {
      const r = await db.from("pluggy_settings").select("*").eq("user_id", userId).maybeSingle();
      must(r);
      const s = r.data;
      return {
        autoImport: !!s?.auto_import,
        autoCategorize: s?.auto_categorize ?? true,
        historyDays: clampHistoryDays(s?.history_days),
        accessState: (s?.access_state ?? "ok") as AccessState,
        configured: !!s,
      };
    },
    async setAccessState(userId, state, reason) {
      // Só atualiza: nunca cria a linha de preferências (isso é escolha do usuário).
      must(await db.from("pluggy_settings").update({ access_state: state, paused_reason: reason }).eq("user_id", userId));
    },
    async getItemOwner(itemId) {
      const r = await db.from("pluggy_items").select("user_id,is_sandbox").eq("item_id", itemId).is("deleted_at", null).maybeSingle();
      must(r);
      return r.data ? { userId: r.data.user_id, isSandbox: r.data.is_sandbox } : null;
    },
    async upsertItem(userId, item) {
      must(
        await db.from("pluggy_items").update({
          connector_id: item.connector.id,
          connector_name: item.connector.name,
          is_sandbox: item.connector.isSandbox === true,
          status: item.status,
          execution_status: item.executionStatus ?? null,
          consent_expires_at: item.consentExpiresAt ?? null,
        }).eq("item_id", item.id).eq("user_id", userId),
      );
    },
    async markItemSync(userId, itemId, outcome) {
      const patch = outcome.ok
        ? { last_error: outcome.pluggyError, last_synced_at: new Date().toISOString() }
        : { last_error: outcome.error.slice(0, 80) };
      must(await db.from("pluggy_items").update(patch).eq("item_id", itemId).eq("user_id", userId));
    },
    async markItemDeleted(itemId) {
      must(await db.from("pluggy_items").update({ deleted_at: new Date().toISOString(), status: "DELETED" }).eq("item_id", itemId));
    },
    async upsertAccounts(userId, accounts, isSandbox) {
      if (!accounts.length) return;
      must(
        await db.from("pluggy_accounts").upsert(
          accounts.map((a) => ({
            user_id: userId,
            item_id: a.itemId,
            account_id: a.id,
            type: a.type,
            subtype: a.subtype ?? null,
            name: a.name,
            number_last4: (a.number ?? "").replace(/\D/g, "").slice(-4) || null,
            balance: a.balance,
            currency: a.currencyCode ?? "BRL",
            credit_limit: a.creditData?.creditLimit ?? null,
            available_credit: a.creditData?.availableCreditLimit ?? null,
            balance_due_date: a.creditData?.balanceDueDate ?? null,
            is_sandbox: isSandbox,
          })),
          { onConflict: "user_id,account_id" },
        ),
      );
    },
    async upsertTransactions(rows: TxRow[]) {
      // amount_original só é gravado se a coluna já existir (migração candidata ainda não aplicada).
      if (hasOriginal === null) {
        const probe = await db.from("pluggy_transactions").select("amount_original").limit(1);
        if (probe.error && !["42703", "PGRST204"].includes(probe.error.code)) throw new Error("pluggy_leitura_indisponivel");
        hasOriginal = !probe.error;
      }
      if (!hasOriginal) rows = rows.map(({ amount_original: _o, ...r }) => r as TxRow);
      for (let i = 0; i < rows.length; i += 500) {
        must(await db.from("pluggy_transactions").upsert(rows.slice(i, i + 500), { onConflict: "user_id,account_id,transaction_id" }));
      }
    },
    async markTransactionsDeleted(userId, ids, itemId) {
      if (!ids.length) return;
      must(
        await db.from("pluggy_transactions").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId).eq("item_id", itemId).in("transaction_id", ids),
      );
    },
    async mpCandidates(userId, from, to) {
      const found = await readRows(() => db
        .from("imported_transactions")
        .select("id,amount,occurred_at,status")
        .eq("user_id", userId)
        .eq("provider", "mercado_pago")
        .gte("occurred_at", `${from}T00:00:00Z`)
        .lte("occurred_at", `${to}T23:59:59Z`)
        .order("id"));
      return found.map((x) => ({
        id: String(x.id),
        amount: Number(x.amount),
        occurredAt: String(x.occurred_at),
        status: String(x.status),
      }));
    },
  };
}
