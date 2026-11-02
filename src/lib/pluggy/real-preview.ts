/**
 * Prévia REAL (Mercado Pago, conector 606) — somente leitura, puro e testável.
 * Nunca grava: apenas filtra a janela de 7 dias, reaplica as regras atuais de
 * classificação (sem tocar decisões manuais) e agrupa o plano para exibição.
 */
import { categorize, classifyTransaction, PLUGGY_LIVE_CONNECTOR_IDS, type PluggyTx } from "@/lib/pluggy/rules";
import type { PlanAction, PlanTx } from "@/lib/pluggy/import-plan";

/** Apenas a conta Admin Master (Felipe) usa a prévia real nesta etapa. */
export const PLUGGY_REAL_PREVIEW_USER_IDS: readonly string[] = Object.freeze(["3324b9f8-ea68-465c-8e1e-ab1cc8caebf1"]);
export const REAL_PREVIEW_DAYS = 7;

export function canUseRealPreview(userId: string | null | undefined, roles: readonly string[]): boolean {
  return !!userId && PLUGGY_REAL_PREVIEW_USER_IDS.includes(userId) && roles.includes("owner");
}

/** Janela fechada de 7 dias a partir de `from` (YYYY-MM-DD). Datas inválidas são rejeitadas. */
export function realPreviewWindow(from: string, until?: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("periodo_invalido");
  const t = Date.parse(from + "T12:00:00Z");
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== from) throw new Error("periodo_invalido");
  const to = until ?? new Date(t + (REAL_PREVIEW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const end = Date.parse(to + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== to || end < t || end - t > 30 * 86400000) throw new Error("periodo_invalido");
  return { from, to };
}

export type RealItem = { item_id: string; is_sandbox: boolean; connector_id: number | null; deleted_at?: string | null };
export type RealAccount = { account_id: string; item_id: string; type: string; is_sandbox: boolean };
export type RealTxRow = PlanTx & { item_id?: string; is_sandbox: boolean; pluggy_category?: string | null };

/** Só transações reais de itens ativos do conector permitido, contas BANK/CREDIT, dentro da janela. */
export function selectRealTxs(items: readonly RealItem[], accounts: readonly RealAccount[], txs: readonly RealTxRow[], win: { from: string; to: string }): RealTxRow[] {
  const okItems = new Set(items.filter((i) => i.is_sandbox === false && !i.deleted_at && i.connector_id != null && PLUGGY_LIVE_CONNECTOR_IDS.includes(i.connector_id)).map((i) => i.item_id));
  const okAcc = new Map(accounts.filter((a) => a.is_sandbox === false && okItems.has(a.item_id) && (a.type === "BANK" || a.type === "CREDIT")).map((a) => [a.account_id, a.type as "BANK" | "CREDIT"]));
  return txs
    .filter((t) => t.is_sandbox === false && okAcc.has(t.account_id) && t.date >= win.from && t.date <= win.to)
    .map((t) => ({ ...t, account_type: okAcc.get(t.account_id)! }));
}

/**
 * Reaplica as regras atuais (ex.: estorno por operationType) para a prévia.
 * Decisões manuais (review_status, categoria_manual) e coincidências MP são preservadas.
 */
export function reclassifyForPreview(t: RealTxRow): RealTxRow {
  // The staging classifier had paymentData/own document. The preview does not.
  // Reclassifying without that evidence must never revive an own-account transfer.
  if (t.classification_reason === "transferencia_mesma_titularidade") return t;
  const signed = t.amount_original ?? (t.type === "DEBIT" ? -t.amount : t.amount);
  const tx: PluggyTx = { id: t.transaction_id, accountId: t.account_id, description: t.description, amount: t.account_type === "CREDIT" ? signed : t.amount, date: t.date, type: t.type, status: (t.status as PluggyTx["status"]) ?? null, category: t.pluggy_category ?? null, operationType: t.operation_type };
  const c = classifyTransaction(tx, t.account_type);
  const categoria_sugerida = c.kind === "gasto" || c.kind === "receita" ? categorize({ category: t.pluggy_category ?? null, description: t.description }, c.kind) : null;
  return { ...t, classification: c.kind, classification_reason: c.reason, categoria_sugerida };
}

export type RealPreviewLine = {
  transaction_id: string; account_id: string; date: string; description: string | null; amount: number;
  grupo: "gasto" | "receita" | "duplicacao" | "cartao" | "revisao" | "ignorado" | "importado" | "desfeito";
  destino: string; motivo: string | null; categoria: string | null;
};

const DUP = new Set(["possivel_duplicata_mercado_pago", "possivel_duplicata_lancamento_existente"]);

export function groupRealPreview(actions: readonly PlanAction[], txs: readonly RealTxRow[], batch?: readonly PlanAction[]): RealPreviewLine[] {
  const inBatch = batch ? new Set(batch.map((a) => `${a.account_id}|${a.transaction_id}`)) : null;
  const byKey = new Map(txs.map((t) => [`${t.account_id}|${t.transaction_id}`, t]));
  return actions.flatMap((a): RealPreviewLine[] => {
    const t = byKey.get(`${a.account_id}|${a.transaction_id}`);
    if (!t) return [];
    const base = { transaction_id: t.transaction_id, account_id: t.account_id, date: t.date, description: t.description, amount: t.amount, categoria: t.categoria_manual ?? t.categoria_sugerida };
    if (a.op === "insert" && inBatch && !inBatch.has(`${a.account_id}|${a.transaction_id}`)) {
      return [{ ...base, grupo: "revisao" as const, destino: "Não importa (revisão)", motivo: a.table === "gastos" && txs.some((r) => r.classification_reason === "estorno" && Math.round(r.amount * 100) === Math.round(a.row.valor * 100)) ? "gasto_com_estorno_no_periodo" : "fora_do_primeiro_lote" }];
    }
    if (a.op === "insert") return [{ ...base, grupo: a.table === "gastos" ? "gasto" as const : "receita" as const, destino: a.table === "gastos" ? "Gastos" : "Receitas", motivo: null }];
    if (a.op === "review") {
      const grupo = DUP.has(a.reason) ? "duplicacao" as const : a.reason === "cartao_sem_vinculo_confirmado" ? "cartao" as const : "revisao" as const;
      return [{ ...base, grupo, destino: "Não importa (revisão)", motivo: a.reason }];
    }
    if (a.op === "skip") return [{ ...base, grupo: a.reason === "ja_importada_revertido" ? "desfeito" : a.reason === "sem_alteracao" || a.reason === "correspondencia_confirmada" ? "importado" : "ignorado", destino: "Não importa novamente", motivo: a.reason }];
    return [{ ...base, grupo: "revisao" as const, destino: "Não importa (revisão)", motivo: "alteracao_de_importacao_anterior" }];
  });
}

/** Primeiro lote: somente movimentações BANCÁRIAS elegíveis e sem suspeita de duplicação. */
export function firstBatchActions(actions: readonly PlanAction[], txs: readonly RealTxRow[]): PlanAction[] {
  const bank = new Set(txs.filter((t) => t.account_type === "BANK").map((t) => `${t.account_id}|${t.transaction_id}`));
  // Gasto com estorno de mesmo valor em até 7 dias fica fora: importar só a saída superestimaria a despesa.
  const refunds = txs.filter((t) => t.classification_reason === "estorno");
  const refunded = (a: PlanAction) => a.op === "insert" && a.table === "gastos" && refunds.some((r) => Math.round(r.amount * 100) === Math.round(a.row.valor * 100) && Math.abs(Date.parse(r.date) - Date.parse(a.row.data)) <= 7 * 86_400_000);
  return actions.filter((a) => a.op === "insert" && bank.has(`${a.account_id}|${a.transaction_id}`) && (a.table === "receitas" || a.row.cartao_id === null) && !refunded(a));
}

/**
 * Gravação real da primeira operação: BLOQUEADA até autorização final do titular,
 * aplicação do SQL `docs/migrations-candidate/pluggy-real-first-import.sql` e da
 * autorização literal da movimentação. Nunca vem do navegador.
 */
export const PLUGGY_REAL_FIRST_IMPORT_AUTHORIZED = false as const;
/** Primeiro teste: exatamente uma movimentação por confirmação. */
export const REAL_FIRST_IMPORT_MAX = 1;

/** A seleção precisa ser 1 item do primeiro lote revalidado no servidor. */
export function pickRealSelection<T extends { account_id: string; transaction_id: string }>(batch: readonly T[], sel: { accountId: string; transactionId: string }[]): T[] {
  if (sel.length === 0 || sel.length > REAL_FIRST_IMPORT_MAX) throw new Error("selecao_invalida");
  return sel.map((s) => {
    const hit = batch.find((a) => a.account_id === s.accountId && a.transaction_id === s.transactionId);
    if (!hit) throw new Error("movimentacao_nao_elegivel");
    return hit;
  });
}

/**
 * Fase 4 — importação real em LOTE FECHADO: BLOQUEADA até aplicação aprovada de
 * `docs/migrations-candidate/pluggy-real-batch-import.sql` e da autorização literal do lote.
 */
export const PLUGGY_REAL_BATCH_IMPORT_AUTHORIZED = false as const;
export const REAL_BATCH_MAX = 10;
export const PLUGGY_REAL_CARD_IMPORT_AUTHORIZED = false as const;

/** Card purchases join a closed batch only after a separate release. */
export function closedBatchActions(actions: readonly PlanAction[], txs: readonly RealTxRow[], cardsReleased = false): PlanAction[] {
  const bank = firstBatchActions(actions, txs);
  if (!cardsReleased) return bank;
  return [...bank, ...actions.filter(a => a.op === "insert" && a.table === "gastos" && !!a.row.cartao_id && txs.some(t => t.account_id === a.account_id && t.transaction_id === a.transaction_id && t.account_type === "CREDIT" && !!t.bill_id && !!t.bill_due_date) && !txs.some(t => t.account_id === a.account_id && t.classification_reason === "estorno" && Math.round(t.amount*100) === Math.round(a.row.valor*100) && Math.abs(Date.parse(t.date)-Date.parse(a.row.data)) <= 7*86400000))];
}
export type FinancialGrantItem = { account_id: string; transaction_id: string; entry_table: string; valor: number; data: string; categoria_id: string | null; tipo: string | null; cartao_id?: string | null; bill_id?: string | null; bill_due_date?: string | null };
export function validateGrantedActions(actions: readonly PlanAction[], grants: readonly FinancialGrantItem[], txs: readonly PlanTx[] = []): boolean {
  return actions.length > 0 && actions.every(a => {
    if (a.op !== "insert") return false;
    const g = grants.find(g => g.account_id === a.account_id && g.transaction_id === a.transaction_id);
    if (a.table === "gastos" && a.row.cartao_id) {
      const tx = txs.find(t => t.account_id === a.account_id && t.transaction_id === a.transaction_id);
      if (!g || !tx || !g.bill_id || !g.bill_due_date || g.cartao_id !== a.row.cartao_id || tx.bill_id !== g.bill_id || tx.bill_due_date !== g.bill_due_date || a.row.fatura_competencia !== g.bill_due_date.slice(0,7)) return false;
    } else if (g?.cartao_id) return false;
    return !!g && g.entry_table === a.table && Number(g.valor) === a.row.valor && g.data === a.row.data &&
      (a.table === "gastos" ? g.categoria_id === a.row.categoria_id : (g.tipo || "outros") === a.row.tipo);
  });
}

/** Seleção múltipla: 1..10 itens distintos, todos do lote revalidado no servidor. */
export function pickRealBatchSelection<T extends { account_id: string; transaction_id: string }>(batch: readonly T[], sel: { accountId: string; transactionId: string }[]): T[] {
  if (sel.length === 0 || sel.length > REAL_BATCH_MAX) throw new Error("selecao_invalida");
  if (new Set(sel.map((s) => `${s.accountId}|${s.transactionId}`)).size !== sel.length) throw new Error("selecao_repetida");
  return sel.map((s) => {
    const hit = batch.find((a) => a.account_id === s.accountId && a.transaction_id === s.transactionId);
    if (!hit) throw new Error("movimentacao_nao_elegivel");
    return hit;
  });
}

/** A seleção precisa coincidir EXATAMENTE com os itens de uma autorização de lote (sem faltar nem sobrar). */
export function matchBatchGrant(grants: readonly { batch_id: string; items: { account_id: string; transaction_id: string }[] }[], sel: readonly { account_id: string; transaction_id: string }[]): string | null {
  const key = (x: { account_id: string; transaction_id: string }) => `${x.account_id}|${x.transaction_id}`;
  const want = new Set(sel.map(key));
  if (!sel.length || want.size !== sel.length) return null;
  const g = grants.find((g) => g.items.length === want.size && new Set(g.items.map(key)).size === want.size && g.items.every((i) => want.has(key(i))));
  return g?.batch_id ?? null;
}
