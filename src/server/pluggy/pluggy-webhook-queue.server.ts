/**
 * Fila durável dos webhooks Pluggy (estados: pendente → processando →
 * concluido | falhou → … → esgotado). Módulo puro com dependências injetadas.
 *
 * - `receive`: grava o evento ANTES de responder à Pluggy; não processa nada.
 * - `drain`: reserva eventos devidos via RPC atômica (SKIP LOCKED + lease),
 *   processa e só então finaliza com o mesmo claim_token.
 * - `reconcile`: ressincroniza itens sem sincronização recente (eventos perdidos).
 * A sincronização é idempotente por (user_id, account_id, transaction_id), então
 * reprocessar um evento nunca duplica transações.
 */
import type { PluggyApi } from "./pluggy-api.server";
import type { PluggyStore } from "./pluggy-sync.server";

export type ClaimedEvent = {
  id: string;
  event: string;
  item_id: string | null;
  transaction_ids: string[];
  attempts: number;
  max_attempts: number;
  claim_token: string;
};

export type QueueDb = {
  enqueue(e: { eventId: string; event: string; itemId: string; transactionIds: string[] }): Promise<{ status: string; isNew: boolean }>;
  claim(limit: number, leaseSeconds: number): Promise<ClaimedEvent[]>;
  finish(id: string, claimToken: string, ok: boolean, error: string | null): Promise<string>;
  staleItems(olderThanIso: string, limit: number): Promise<Array<{ userId: string; itemId: string }>>;
};

export type QueueDeps = {
  db: QueueDb;
  store: PluggyStore;
  api: PluggyApi;
  assertAccess: (userId: string) => Promise<unknown>;
  syncItem: (
    deps: { api: PluggyApi; store: PluggyStore },
    input: { userId: string; itemId: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  now?: () => Date;
  importIncremental?: (userId: string) => Promise<unknown>;
};

/** Código de erro curto, sem valores, descrições ou dados pessoais. */
export function safeErrorCode(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "erro_interno";
  // Só códigos internos (sem espaços, letras/dígitos/_:.-); mensagens livres
  // podem conter valores ou nomes e são descartadas.
  return /^[a-z][a-z0-9_:.-]{2,79}$/i.test(raw) && !/\d{5,}/.test(raw) ? raw : "erro_interno";
}

export async function receiveWebhook(
  db: QueueDb,
  e: { eventId: string; event: string; itemId: string; transactionIds?: string[] },
) {
  return db.enqueue({ ...e, transactionIds: e.transactionIds ?? [] });
}

async function processOne(deps: QueueDeps, ev: ClaimedEvent): Promise<void> {
  if (!ev.item_id) throw new Error("evento_sem_item");
  const owner = await deps.store.getItemOwner(ev.item_id);
  if (!owner) {
    // Item desconhecido/removido: nada a sincronizar. Concluir é seguro.
    if (ev.event === "item/deleted") return;
    throw new Error("item_desconhecido");
  }
  await deps.assertAccess(owner.userId); // allowlist + owner relidos a cada evento
  if (ev.event === "item/deleted") {
    await deps.store.markItemDeleted(ev.item_id);
    return;
  }
  if (ev.event === "transactions/deleted") {
    await deps.store.markTransactionsDeleted(owner.userId, ev.transaction_ids);
    const importIncremental = deps.importIncremental ?? (await import("./pluggy-import.server")).runIncrementalAfterSync;
    await importIncremental(owner.userId);
    return;
  }
  const r = await deps.syncItem({ api: deps.api, store: deps.store }, { userId: owner.userId, itemId: ev.item_id });
  if (!r.ok) throw new Error(r.error ?? "sync_falhou");
}

export async function drainWebhooks(deps: QueueDeps, opts: { limit?: number; leaseSeconds?: number } = {}) {
  const claimed = await deps.db.claim(opts.limit ?? 5, opts.leaseSeconds ?? 120);
  const out: Array<{ id: string; status: string }> = [];
  for (const ev of claimed) {
    let ok = true;
    let err: string | null = null;
    try {
      await processOne(deps, ev);
    } catch (e) {
      ok = false;
      err = safeErrorCode(e);
    }
    out.push({ id: ev.id, status: await deps.db.finish(ev.id, ev.claim_token, ok, err) });
  }
  return out;
}

export async function reconcileItems(deps: QueueDeps, opts: { staleHours?: number; limit?: number } = {}) {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.staleHours ?? 24) * 3600_000).toISOString();
  const items = await deps.db.staleItems(cutoff, opts.limit ?? 3);
  const out: Array<{ itemId: string; ok: boolean; error?: string }> = [];
  for (const it of items) {
    try {
      await deps.assertAccess(it.userId);
      const r = await deps.syncItem({ api: deps.api, store: deps.store }, it);
      out.push({ itemId: it.itemId, ok: r.ok, error: r.ok ? undefined : r.error });
    } catch (e) {
      out.push({ itemId: it.itemId, ok: false, error: safeErrorCode(e) });
    }
  }
  return out;
}

/** Implementação real sobre as RPCs service_role da migração candidata. */
export async function createQueueDb(): Promise<QueueDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const fail = () => {
    throw new Error("pluggy_fila_indisponivel");
  };
  return {
    async enqueue(e) {
      const r = await db.rpc("pluggy_webhook_enqueue", {
        p_event_id: e.eventId,
        p_event: e.event,
        p_item_id: e.itemId,
        p_transaction_ids: e.transactionIds,
      });
      if (r.error || !r.data?.[0]) fail();
      return { status: r.data[0].status, isNew: !!r.data[0].is_new };
    },
    async claim(limit, lease) {
      const r = await db.rpc("pluggy_webhook_claim", { p_limit: limit, p_lease_seconds: lease });
      if (r.error) fail();
      return (r.data ?? []) as ClaimedEvent[];
    },
    async finish(id, token, ok, error) {
      const r = await db.rpc("pluggy_webhook_finish", { p_id: id, p_claim_token: token, p_ok: ok, p_error: error });
      if (r.error) fail();
      return String(r.data);
    },
    async staleItems(cutoff, limit) {
      const r = await db
        .from("pluggy_items")
        .select("user_id,item_id,last_synced_at")
        .is("deleted_at", null)
        .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (r.error) fail();
      return (r.data ?? []).map((x: { user_id: string; item_id: string }) => ({ userId: x.user_id, itemId: x.item_id }));
    },
  };
}
