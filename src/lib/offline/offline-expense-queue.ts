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

const DB_NAME = "gf_offline";
const DB_VERSION = 1;
const STORE = "expenses";

export type OfflineExpenseStatus = "pending" | "syncing" | "failed" | "synced";

export type OfflineExpense = {
  local_id: string;
  user_id: string;
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
      .catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
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
): Promise<OfflineExpense> {
  if (!isBrowser()) throw new Error("offline queue unavailable");
  const now = Date.now();
  const item: OfflineExpense = {
    local_id: genId(),
    user_id: userId,
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
  return item;
}

export async function listExpenses(userId: string): Promise<OfflineExpense[]> {
  if (!isBrowser()) return [];
  return tx("readonly", (s) => {
    return new Promise<OfflineExpense[]>((resolve, reject) => {
      const out: OfflineExpense[] = [];
      const idx = s.index("user_id");
      const req = idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          const v = cur.value as OfflineExpense;
          if (v.status !== "synced") out.push(v);
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

export async function removeExpense(localId: string): Promise<void> {
  await tx("readwrite", (s) => {
    s.delete(localId);
  });
  emit();
}

export async function updateExpense(
  localId: string,
  patch: Partial<OfflineExpense>,
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
        const merged: OfflineExpense = {
          ...current,
          ...patch,
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
export async function claimForSync(localId: string): Promise<boolean> {
  let claimed = false;
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const req = s.get(localId);
      req.onsuccess = () => {
        const cur = req.result as OfflineExpense | undefined;
        if (!cur) return resolve();
        if (cur.status === "syncing") return resolve();
        cur.status = "syncing";
        cur.updated_at = Date.now();
        const put = s.put(cur);
        put.onsuccess = () => {
          claimed = true;
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
