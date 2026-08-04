/**
 * Fila offline de receitas manuais (IndexedDB).
 *
 * - Por usuário (`user_id` é parte do registro e usamos índice).
 * - Salva apenas os dados da receita. Nunca tokens, senhas ou refresh tokens.
 * - Cada item tem um `local_id` único usado como chave primária.
 *
 * Esta fila é usada APENAS pelo cadastro manual de receitas. Importação,
 * OCR, IA, WhatsApp, pagamentos e assinaturas não usam esta fila.
 */

import type { NovaReceitaInput } from "@/lib/store";
import { recordHistoryEvent } from "./offline-sync-history";

const DB_NAME = "gf_offline_income";
const DB_VERSION = 1;
const STORE = "incomes";

export type OfflineIncomeStatus = "pending" | "syncing" | "failed" | "synced";

export type OfflineIncome = {
  local_id: string;
  user_id: string;
  input: NovaReceitaInput;
  descricao: string;
  valor: number;
  data: string;
  tipo: string;
  cliente_id?: string | null;
  created_at: number;
  updated_at: number;
  status: OfflineIncomeStatus;
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

export async function enqueueIncome(
  userId: string,
  input: NovaReceitaInput,
): Promise<OfflineIncome> {
  if (!isBrowser()) throw new Error("offline queue unavailable");
  const now = Date.now();
  const item: OfflineIncome = {
    local_id: genId(),
    user_id: userId,
    input,
    descricao: (input.descricao || "Receita").trim(),
    valor: input.valor,
    data: input.data,
    tipo: input.tipo,
    cliente_id: input.clienteId ?? null,
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
    type: "income",
    action: "created_offline",
    title: item.descricao,
    amount: item.valor,
  });
  return item;
}

export async function listIncomes(userId: string): Promise<OfflineIncome[]> {
  if (!isBrowser()) return [];
  return tx("readonly", (s) => {
    return new Promise<OfflineIncome[]>((resolve, reject) => {
      const out: OfflineIncome[] = [];
      const idx = s.index("user_id");
      const req = idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          const v = cur.value as OfflineIncome;
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

/** Remove sem registrar evento no histórico (uso interno do sync). */
export async function deleteIncomeSilent(localId: string): Promise<void> {
  await tx("readwrite", (s) => {
    s.delete(localId);
  });
  emit();
}

export async function removeIncome(localId: string): Promise<void> {
  let snapshot: OfflineIncome | undefined;
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const g = s.get(localId);
      g.onsuccess = () => {
        snapshot = g.result as OfflineIncome | undefined;
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
      type: "income",
      action: "removed",
      title: snapshot.descricao,
      amount: snapshot.valor,
    });
  }
}

export async function updateIncome(localId: string, patch: Partial<OfflineIncome>): Promise<void> {
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const req = s.get(localId);
      req.onsuccess = () => {
        const current = req.result as OfflineIncome | undefined;
        if (!current) {
          resolve();
          return;
        }
        const merged: OfflineIncome = {
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

/** Marca como em sincronização para evitar processamentos paralelos. */
export async function claimForSync(localId: string): Promise<boolean> {
  let claimed = false;
  await tx("readwrite", (s) => {
    return new Promise<void>((resolve, reject) => {
      const req = s.get(localId);
      req.onsuccess = () => {
        const cur = req.result as OfflineIncome | undefined;
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
