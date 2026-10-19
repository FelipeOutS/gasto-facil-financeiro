/**
 * Motor de sincronização Pluggy (injeção de dependências para testes).
 * Fase 2: grava SOMENTE nas tabelas isoladas pluggy_* — nunca em gastos/receitas.
 */
import {
  accessStateFromHttp,
  assertConnectorAllowed,
  categorize,
  classifyTransaction,
  pluggyDedupeKey,
  reconcileWithMercadoPago,
  type AccessState,
  type MpCandidate,
  type PluggyTx,
} from "@/lib/pluggy/rules";
import { PluggyHttpError, type PluggyAccount, type PluggyApi, type PluggyItem } from "./pluggy-api.server";

export type PluggySettings = { autoImport: boolean; autoCategorize: boolean; historyDays: number; accessState: AccessState };

export type TxRow = {
  user_id: string;
  item_id: string;
  account_id: string;
  transaction_id: string;
  dedupe_key: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  status: string;
  type: string;
  pluggy_category: string | null;
  operation_type: string | null;
  installment_number: number | null;
  total_installments: number | null;
  classification: string;
  classification_reason: string;
  categoria_sugerida: string | null;
  mp_match_ids: string[] | null;
  is_sandbox: boolean;
};

export interface PluggyStore {
  getSettings(userId: string): Promise<PluggySettings>;
  setAccessState(userId: string, state: AccessState, reason: string | null): Promise<void>;
  getItemOwner(itemId: string): Promise<{ userId: string; isSandbox: boolean } | null>;
  upsertItem(userId: string, item: PluggyItem): Promise<void>;
  markItemDeleted(itemId: string): Promise<void>;
  upsertAccounts(userId: string, accounts: PluggyAccount[], isSandbox: boolean): Promise<void>;
  upsertTransactions(rows: TxRow[]): Promise<void>;
  markTransactionsDeleted(userId: string, ids: string[]): Promise<void>;
  mpCandidates(userId: string, from: string, to: string): Promise<MpCandidate[]>;
}

export type SyncResult =
  | { ok: true; accounts: number; transactions: number; revisao: number; ignorados: number }
  | { ok: false; error: string };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function syncItem(
  deps: { api: PluggyApi; store: PluggyStore; now?: () => Date },
  input: { userId: string; itemId: string },
): Promise<SyncResult> {
  const { api, store } = deps;
  const now = deps.now?.() ?? new Date();
  const settings = await store.getSettings(input.userId);
  if (settings.accessState === "pausado_acesso") return { ok: false, error: "sincronizacao_pausada" };

  const owner = await store.getItemOwner(input.itemId);
  if (!owner || owner.userId !== input.userId) return { ok: false, error: "item_de_outro_usuario" };

  try {
    const item = await api.item(input.itemId);
    if (item.clientUserId && item.clientUserId !== input.userId) return { ok: false, error: "item_de_outro_usuario" };
    assertConnectorAllowed(item.connector);
    await store.upsertItem(input.userId, item);
    const isSandbox = item.connector.isSandbox === true;

    const { results: accounts } = await api.accounts(item.id);
    await store.upsertAccounts(input.userId, accounts, isSandbox);

    const fromD = new Date(now.getTime() - settings.historyDays * 86_400_000);
    const from = isoDate(fromD);
    const mp = await store.mpCandidates(input.userId, from, isoDate(now));
    const rows: TxRow[] = [];
    let revisao = 0;
    let ignorados = 0;

    for (const acc of accounts) {
      const ownDoc = acc.taxNumber ?? null;
      for (let page = 1, total = 1; page <= total && page <= 40; page++) {
        const r = await api.transactionsPage(acc.id, from, page);
        total = r.totalPages || 1;
        for (const raw of r.results as PluggyTx[]) {
          const tx = { ...raw, accountId: acc.id };
          let cls = classifyTransaction(tx, acc.type, ownDoc);
          let matchIds: string[] | null = null;
          if (cls.kind === "gasto" || cls.kind === "receita") {
            const rec = reconcileWithMercadoPago(tx, mp);
            if (rec.status === "revisao") {
              matchIds = rec.matchIds;
              cls = { kind: "revisao", reason: "possivel_duplicata_mercado_pago" };
            }
          }
          if (cls.kind === "revisao") revisao++;
          if (cls.kind === "ignorado") ignorados++;
          const kindForCat = cls.kind === "receita" ? "receita" : tx.type === "CREDIT" && acc.type === "BANK" ? "receita" : "gasto";
          rows.push({
            user_id: input.userId,
            item_id: item.id,
            account_id: acc.id,
            transaction_id: tx.id,
            dedupe_key: pluggyDedupeKey(item.id, acc.id, tx.id),
            description: tx.description ?? null,
            amount: Math.abs(tx.amount),
            currency: acc.currencyCode ?? "BRL",
            date: tx.date.slice(0, 10),
            status: tx.status ?? "POSTED",
            type: tx.type,
            pluggy_category: tx.category ?? null,
            operation_type: tx.operationType ?? null,
            installment_number: tx.creditCardMetadata?.installmentNumber ?? null,
            total_installments: tx.creditCardMetadata?.totalInstallments ?? null,
            classification: cls.kind,
            classification_reason: cls.reason,
            categoria_sugerida: settings.autoCategorize && cls.kind !== "ignorado" ? categorize(tx, kindForCat) : null,
            mp_match_ids: matchIds,
            is_sandbox: isSandbox,
          });
        }
      }
    }
    // Upsert por (user_id, transaction_id): o mesmo id da Pluggy nunca duplica,
    // e colunas do usuário (categoria_manual, review_status) não são enviadas.
    if (rows.length) await store.upsertTransactions(rows);
    await store.setAccessState(input.userId, "ok", null);
    return { ok: true, accounts: accounts.length, transactions: rows.length, revisao, ignorados };
  } catch (e) {
    if (e instanceof PluggyHttpError) {
      const st = accessStateFromHttp(e.status);
      if (st !== "ok") {
        await store.setAccessState(input.userId, st, `http_${e.status}`);
        return { ok: false, error: "acesso_pluggy_suspenso" };
      }
      return { ok: false, error: e.status === 0 ? e.code : `pluggy_http_${e.status}` };
    }
    const msg = e instanceof Error ? e.message : "erro";
    if (msg.startsWith("pluggy_")) return { ok: false, error: msg };
    throw e;
  }
}
