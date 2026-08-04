/**
 * Histórico local de eventos da sincronização offline (gastos e receitas).
 *
 * Armazena no IndexedDB os últimos 100 eventos por usuário.
 * Nunca salva tokens, senhas, access_token, refresh_token ou dados de sessão.
 */

const DB_NAME = "gf_offline_history";
const DB_VERSION = 1;
const STORE = "events";
const MAX_PER_USER = 100;

export type OfflineHistoryType = "expense" | "income";
export type OfflineHistoryAction = "created_offline" | "edited" | "synced" | "failed" | "removed";

export type OfflineHistoryEvent = {
  id: string;
  user_id: string;
  type: OfflineHistoryType;
  action: OfflineHistoryAction;
  title: string;
  amount: number;
  created_at: number;
  metadata?: Record<string, string | number | boolean | null>;
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
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("user_id", "user_id", { unique: false });
        s.createIndex("created_at", "created_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(s))
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

export function subscribeHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sanitiza metadata removendo chaves perigosas. Nunca aceita tokens,
 * senhas, cookies ou dados de sessão.
 */
const FORBIDDEN_KEYS = [
  "token",
  "access_token",
  "refresh_token",
  "password",
  "senha",
  "session",
  "jwt",
  "secret",
  "cookie",
  "authorization",
];

function sanitizeMetadata(
  meta?: Record<string, unknown>,
): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_KEYS.some((bad) => lower.includes(bad))) continue;
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v ?? null;
    }
  }
  return out;
}

export async function recordHistoryEvent(input: {
  user_id: string;
  type: OfflineHistoryType;
  action: OfflineHistoryAction;
  title: string;
  amount: number;
  metadata?: Record<string, unknown>;
  error_message?: string;
  technical_error?: string;
}): Promise<void> {
  if (!isBrowser() || !input.user_id) return;
  const event: OfflineHistoryEvent = {
    id: genId(),
    user_id: input.user_id,
    type: input.type,
    action: input.action,
    title: (input.title || "").slice(0, 200),
    amount: Number.isFinite(input.amount) ? input.amount : 0,
    created_at: Date.now(),
    metadata: sanitizeMetadata(input.metadata),
    error_message: input.error_message,
    technical_error: input.technical_error,
  };
  try {
    await tx("readwrite", (s) => {
      s.add(event);
    });
    await trimUserHistory(input.user_id);
    emit();
  } catch {
    /* noop — histórico nunca deve quebrar o fluxo */
  }
}

export async function listHistory(userId: string): Promise<OfflineHistoryEvent[]> {
  if (!isBrowser() || !userId) return [];
  return tx("readonly", (s) => {
    return new Promise<OfflineHistoryEvent[]>((resolve, reject) => {
      const out: OfflineHistoryEvent[] = [];
      const idx = s.index("user_id");
      const req = idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          out.push(cur.value as OfflineHistoryEvent);
          cur.continue();
        } else {
          out.sort((a, b) => b.created_at - a.created_at);
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function clearHistoryForUser(userId: string): Promise<void> {
  if (!isBrowser() || !userId) return;
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

async function trimUserHistory(userId: string): Promise<void> {
  const all = await listHistory(userId);
  if (all.length <= MAX_PER_USER) return;
  const toDelete = all.slice(MAX_PER_USER); // já ordenado desc
  await tx("readwrite", (s) => {
    for (const ev of toDelete) s.delete(ev.id);
  });
}
