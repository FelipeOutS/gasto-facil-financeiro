/**
 * Fila offline de gastos manuais (IndexedDB).
 *
 * - Por usuário (`user_id` é parte do registro e usamos índice).
 * - Salva apenas os dados do gasto. Nunca tokens, senhas ou refresh tokens.
 * - Cada item tem um `local_id` único usado como chave primária.
 *
 * Esta fila é usada APENAS pelo cadastro manual de gastos. Importação,
 * OCR, IA, WhatsApp, pagamentos e assinaturas não usam esta fila.
 */

import type { NovoGastoInput } from "@/lib/store";
import { recordHistoryEvent } from "./offline-sync-history";
import { validateFinancialAmount } from "../financial-limits";
import { isValidOfflineDate } from "./offline-validation";

const DB_NAME = "gf_offline";
const DB_VERSION = 1;
const STORE = "expenses";

export type OfflineExpenseStatus = "pending" | "syncing" | "failed" | "synced";

export type OfflineExpense = {
  local_id: string;
  /** Immutable destination owner. */
  user_id: string;
  /** Authenticated creator; legacy items belong to user_id. */
  actor_id?: string;
  input: NovoGastoInput;
  /** Descrição visível na lista de pendências */
  descricao: string;
  valor: number;
  data: string;
  forma_pagamento: string;
  cartao_id?: string;
  observacao?: string;
  created_at: number;
  updated_at: number;
  status: OfflineExpenseStatus;
  attempts: number;
  error_message?: string;
  technical_error?: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "local_id" });
        store.createIndex("user_id", "user_id", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch((error) => {
        try {
          t.abort();
        } catch {
          /* already complete */
        }
        reject(error);
      });
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
    t.onabort = () => {
      db.close();
      reject(t.error);
    };
  });
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* noop */
    }
  }
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueExpense(
  userId: string,
  input: NovoGastoInput,
  actorId = userId,
): Promise<OfflineExpense> {
  if (!isBrowser()) throw new Error("offline queue unavailable");
  if (
    !userId ||
    !actorId ||
    !validateFinancialAmount(input.valor).ok ||
    !isValidOfflineDate(input.data)
  )
    throw new Error("Informe uma conta, data e valor válidos.");
  const now = Date.now();
  const item: OfflineExpense = {
    local_id: genId(),
    user_id: userId,
    actor_id: actorId,
    input,
    descricao: (input.descricao || input.estabelecimento || "Gasto").trim(),
    valor: input.valor,
    data: input.data,
    forma_pagamento: input.formaPagamento,
    cartao_id: input.cartaoId,
    observacao: input.observacao,
    created_at: now,
    updated_at: now,
    status: "pending",
    attempts: 0,
  };
  await tx("readwrite", (s) => {
    s.add(item);
  });
  emit();
  void recordHistoryEvent({
    user_id: userId,
    type: "expense",
    action: "created_offline",
    title: item.descricao,
    amount: item.valor,
  });
  return item;
}

export async function listExpenses(
  userId: string,
  actorId = userId,
  allOwners = false,
): Promise<OfflineExpense[]> {
  if (!isBrowser()) return [];
  return tx("readonly", (s) => {
    return new Promise<OfflineExpense[]>((resolve, reject) => {
      const out: OfflineExpense[] = [];
      const idx = s.index("user_id");
      const req = allOwners ? s.openCursor() : idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          const v = cur.value as OfflineExpense;
          if (v.status !== "synced" && (v.actor_id ?? v.user_id) === actorId) out.push(v);
          cur.continue();
        } else {
          out.sort((a, b) => a.created_at - b.created_at);
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function countPending(userId: string): Promise<number> {
  const all = await listExpenses(userId);
  return all.filter((e) => e.status !== "synced").length;
}

/** Remove sem registrar evento no histórico (uso interno do sync). */
export async function deleteExpenseSilent(
  localId: string,
  userId: string,
  attempt: number,
  actorId = userId,
): Promise<void> {
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const request = s.get(localId);
      request.onsuccess = () => {
        const current = request.result as OfflineExpense | undefined;
        if (
          current?.user_id === userId &&
          (current.actor_id ?? current.user_id) === actorId &&
          current.attempts === attempt &&
          current.status === "syncing"
        )
          s.delete(localId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  emit();
}

export async function removeExpense(
  localId: string,
  userId: string,
  actorId = userId,
): Promise<void> {
  let snapshot: OfflineExpense | undefined;
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const g = s.get(localId);
      g.onsuccess = () => {
        snapshot = g.result as OfflineExpense | undefined;
        if (
          snapshot &&
          (snapshot.user_id !== userId || (snapshot.actor_id ?? snapshot.user_id) !== actorId)
        ) {
          reject(new Error("Este gasto pertence a outra conta."));
          return;
        }
        if (snapshot && (snapshot.status === "syncing" || snapshot.attempts > 0)) {
          reject(
            new Error(
              "Este envio precisa ser conferido antes de remover. Tente sincronizar novamente.",
            ),
          );
          return;
        }
        s.delete(localId);
        resolve();
      };
      g.onerror = () => reject(g.error);
    });
  });
  emit();
  if (snapshot) {
    void recordHistoryEvent({
      user_id: snapshot.user_id,
      type: "expense",
      action: "removed",
      title: snapshot.descricao,
      amount: snapshot.valor,
    });
  }
}

export async function updateExpense(
  localId: string,
  patch: Partial<OfflineExpense>,
  userId: string,
  expectedAttempt?: number,
  actorId = userId,
): Promise<void> {
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const req = s.get(localId);
      req.onsuccess = () => {
        const current = req.result as OfflineExpense | undefined;
        if (!current) {
          resolve();
          return;
        }
        if (current.user_id !== userId || (current.actor_id ?? current.user_id) !== actorId) {
          reject(new Error("Este gasto pertence a outra conta."));
          return;
        }
        if (
          expectedAttempt !== undefined &&
          (current.attempts !== expectedAttempt || current.status !== "syncing")
        ) {
          resolve();
          return;
        }
        if (
          patch.input &&
          (!validateFinancialAmount(patch.input.valor).ok || !isValidOfflineDate(patch.input.data))
        ) {
          reject(new Error("Informe uma data e valor válidos."));
          return;
        }
        if (patch.input && (current.status === "syncing" || current.attempts > 0)) {
          reject(new Error("Este envio precisa ser conferido antes de editar."));
          return;
        }
        const merged: OfflineExpense = {
          ...current,
          ...patch,
          local_id: current.local_id,
          user_id: current.user_id,
          actor_id: current.actor_id,
          attempts: current.attempts,
          input: patch.input ?? current.input,
          updated_at: Date.now(),
        };
        const put = s.put(merged);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  emit();
}

export async function clearForUser(userId: string): Promise<void> {
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const idx = s.index("user_id");
      const req = idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          cur.delete();
          cur.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
  emit();
}

/** Marca um item como em sincronização para evitar processamentos paralelos. */
export async function claimForSync(
  localId: string,
  userId: string,
  actorId = userId,
): Promise<OfflineExpense | null> {
  let claimed: OfflineExpense | null = null;
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const req = s.get(localId);
      req.onsuccess = () => {
        const cur = req.result as OfflineExpense | undefined;
        if (
          !cur ||
          cur.user_id !== userId ||
          (cur.actor_id ?? cur.user_id) !== actorId ||
          cur.status === "synced"
        )
          return resolve();
        if (cur.status === "syncing" && Date.now() - cur.updated_at < 120000) return resolve();
        cur.status = "syncing";
        cur.attempts += 1;
        cur.updated_at = Date.now();
        const put = s.put(cur);
        put.onsuccess = () => {
          claimed = cur;
          resolve();
        };
        put.onerror = () => reject(put.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  if (claimed) emit();
  return claimed;
}
