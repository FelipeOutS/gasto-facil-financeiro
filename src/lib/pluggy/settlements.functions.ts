import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLUGGY_SETTLEMENTS_AUTHORIZED, confirmedBillPayment, type BankBill } from "./settlements";
const kind = z.enum(["advance_link", "receivable_return", "refund", "bill_payment"]);
const selection = z.object({
  accountId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  kind,
  targetId: z.string().uuid(),
});
const quote = selection.extend({
  amount: z.number().positive(),
  targetExpected: z.string().nullable(),
  sourceExpected: z.record(z.string(), z.string()),
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  selection.extend({ action: z.literal("preview") }),
  z.object({ action: z.literal("apply"), quote, confirmed: z.literal(true) }),
  z.object({ action: z.literal("undo"), id: z.string().uuid(), confirmed: z.literal(true) }),
]);
export type SettlementQuote = z.infer<typeof quote>;
export type SettlementState = {
  schemaReady: boolean;
  released: boolean;
  accounts: { account_id: string; name: string }[];
  transactions: {
    account_id: string;
    transaction_id: string;
    description: string;
    amount: number;
    date: string;
    type: string;
  }[];
  bills: { account_id: string; bill_id: string; due_date: string; total: number }[];
  receivables: { id: string; titulo: string; valor_restante: number }[];
  expenses: { id: string; descricao: string; valor: number; data: string }[];
  cards: { id: string; nome: string }[];
  history: {
    id: string;
    kind: string;
    source_id: string;
    amount: number;
    created_at: string;
    reverted_at: string | null;
  }[];
};
export const pluggySettlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: z.input<typeof input>) => input.parse(v))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ state?: SettlementState; quote?: SettlementQuote; result?: string }> => {
      const { canUseRealPreview } = await import("./real-preview");
      const roles = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      if (
        roles.error ||
        !canUseRealPreview(
          context.userId,
          (roles.data ?? []).map((r) => r.role),
        )
      )
        throw Error("pluggy_nao_autorizado");
      // Candidate schema is intentionally not present in generated production types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = context.supabase as any;
      const user = context.userId;
      const fail = (r: { error: unknown }) => {
        if (r.error) throw Error("pluggy_conciliacao_indisponivel");
      };
      if (data.action === "apply" || data.action === "undo") {
        if (!PLUGGY_SETTLEMENTS_AUTHORIZED) throw Error("pluggy_conciliacao_bloqueada");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;
        const q = data.action === "apply" ? data.quote : null;
        const r = q
          ? await admin.rpc("pluggy_settlement_apply", {
              p_user_id: user,
              p_account_id: q.accountId,
              p_source_id: q.sourceId,
              p_kind: q.kind,
              p_target_id: q.targetId,
              p_expected: q.targetExpected,
              p_source_expected: q.sourceExpected,
              p_confirmed: true,
            })
          : await admin.rpc("pluggy_settlement_undo", {
              p_user_id: user,
              p_id: (data as { id: string }).id,
            });
        fail(r);
        return { result: String(r.data) };
      }
      const history = await db
        .from("pluggy_settlements")
        .select("id,kind,source_id,amount,created_at,reverted_at")
        .eq("user_id", user)
        .order("created_at", { ascending: false })
        .limit(100);
      if (history.error) {
        if (["42P01", "PGRST205"].includes(history.error.code))
          return {
            state: {
              schemaReady: false,
              released: false,
              accounts: [],
              transactions: [],
              bills: [],
              receivables: [],
              expenses: [],
              cards: [],
              history: [],
            },
          };
        fail(history);
      }
      if (data.action === "status") {
        const items = await db
          .from("pluggy_items")
          .select("item_id")
          .eq("user_id", user)
          .eq("connector_id", 606)
          .eq("is_sandbox", false)
          .is("deleted_at", null);
        fail(items);
        const ids = items.data.map((r: { item_id: string }) => r.item_id);
        const accounts = ids.length
          ? await db
              .from("pluggy_accounts")
              .select("account_id,name")
              .eq("user_id", user)
              .in("item_id", ids)
              .eq("is_sandbox", false)
          : { data: [], error: null };
        fail(accounts);
        const accountIds = accounts.data.map((r: { account_id: string }) => r.account_id);
        const since = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
        const transactions = accountIds.length
          ? await db
              .from("pluggy_transactions")
              .select("account_id,transaction_id,description,amount,date,type")
              .eq("user_id", user)
              .in("account_id", accountIds)
              .eq("status", "POSTED")
              .eq("is_sandbox", false)
              .is("deleted_at", null)
              .gte("date", since)
              .order("date", { ascending: false })
              .limit(300)
          : { data: [], error: null };
        const bills = await db
          .from("pluggy_bill_snapshots")
          .select("account_id,bill_id,due_date,total")
          .eq("user_id", user)
          .order("due_date", { ascending: false })
          .limit(100);
        const receivables = await db
          .from("contas_a_receber")
          .select("id,titulo,valor_restante")
          .eq("user_id", user)
          .neq("status", "cancelado")
          .order("data_prevista", { ascending: false })
          .limit(300);
        const expenses = await db
          .from("gastos")
          .select("id,descricao,valor,data")
          .eq("user_id", user)
          .is("deleted_at", null)
          .order("data", { ascending: false })
          .limit(300);
        const cards = await db.from("cartoes").select("id,nome").eq("user_id", user);
        for (const r of [transactions, bills, receivables, expenses, cards]) fail(r);
        return {
          state: {
            schemaReady: true,
            released: PLUGGY_SETTLEMENTS_AUTHORIZED,
            accounts: accounts.data,
            transactions: transactions.data,
            bills: bills.data,
            receivables: receivables.data,
            expenses: expenses.data,
            cards: cards.data,
            history: history.data,
          },
        };
      }
      let amount: number,
        targetExpected: string | null = null;
      let sourceExpected: Record<string, string>;
      if (data.kind === "bill_payment") {
        const bills = await db
          .from("pluggy_bill_snapshots")
          .select("*")
          .eq("user_id", user)
          .eq("account_id", data.accountId);
        fail(bills);
        const previous = bills.data.find((b: { bill_id: string }) => b.bill_id === data.sourceId);
        if (!previous) throw Error("pluggy_fatura_indisponivel");
        const month = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
        const next = bills.data.filter(
          (b: { due_date: string }) => month(b.due_date) - month(previous.due_date) === 1,
        );
        if (next.length !== 1) throw Error("pluggy_fatura_ambigua");
        const toBill = (b: typeof previous): BankBill => ({
          id: b.bill_id,
          dueDate: b.due_date,
          billClosingDate: b.closing_date,
          totalAmount: Number(b.total),
          totalAmountCurrencyCode: b.currency,
          payments: b.payments,
          financeCharges: b.charges,
        });
        const match = confirmedBillPayment(
          toBill(previous),
          toBill(next[0]),
          new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
        );
        if (!match) throw Error("pluggy_pagamento_requer_revisao");
        amount = match.amount;
        sourceExpected = { previous: previous.updated_at, next: next[0].updated_at };
        const invoice = await db
          .from("faturas_cartao")
          .select("updated_at")
          .eq("user_id", user)
          .eq("cartao_id", data.targetId)
          .eq("ano", Number(previous.due_date.slice(0, 4)))
          .eq("mes", Number(previous.due_date.slice(5, 7)))
          .maybeSingle();
        fail(invoice);
        targetExpected = invoice.data?.updated_at ?? null;
      } else {
        const tx = await db
          .from("pluggy_transactions")
          .select("amount,updated_at,type,operation_type,classification_reason")
          .eq("user_id", user)
          .eq("account_id", data.accountId)
          .eq("transaction_id", data.sourceId)
          .eq("status", "POSTED")
          .is("deleted_at", null)
          .single();
        fail(tx);
        const expectedType = data.kind === "advance_link" ? "DEBIT" : "CREDIT";
        if (tx.data.type !== expectedType) throw Error("pluggy_transacao_invalida");
        amount = Number(tx.data.amount);
        sourceExpected = { transaction: tx.data.updated_at };
        const table = data.kind === "refund" ? "gastos" : "contas_a_receber";
        let query = db.from(table).select("updated_at").eq("user_id", user).eq("id", data.targetId);
        if (table === "gastos") query = query.is("deleted_at", null);
        const target = await query.single();
        fail(target);
        targetExpected = target.data.updated_at;
      }
      return {
        quote: {
          accountId: data.accountId,
          sourceId: data.sourceId,
          kind: data.kind,
          targetId: data.targetId,
          amount,
          targetExpected,
          sourceExpected,
        },
      };
    },
  );
