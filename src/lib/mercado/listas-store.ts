// Local-only store for Mercado Inteligente shopping lists (E3).
// Persists to localStorage under an isolated key. NO Supabase, NO API.

import { useEffect, useState, useSyncExternalStore } from "react";

export const MERCADO_LISTAS_STORAGE_KEY = "gi:mercado:listas:v1";

export type ListaTipo =
  | "compraMes"
  | "reposicao"
  | "churrasco"
  | "farmacia"
  | "outros";

export type MercadoLista = {
  id: string;
  name: string;
  tipo: ListaTipo;
  observation?: string;
  estimate?: number; // optional budget estimate
  status: "planning" | "ongoing" | "done";
  items: number;
  progress: number; // 0-100
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

type Listener = () => void;
const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeRead(): MercadoLista[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MERCADO_LISTAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is MercadoLista => !!x && typeof x.id === "string");
  } catch {
    return [];
  }
}

function safeWrite(next: MercadoLista[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MERCADO_LISTAS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy errors
  }
}

function emit() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

export function getListas(): MercadoLista[] {
  return safeRead();
}

export function addLista(input: {
  name: string;
  tipo: ListaTipo;
  observation?: string;
  estimate?: number;
}): MercadoLista {
  const now = new Date().toISOString();
  const lista: MercadoLista = {
    id:
      isBrowser() && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `lst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    tipo: input.tipo,
    observation: input.observation?.trim() || undefined,
    estimate:
      typeof input.estimate === "number" && Number.isFinite(input.estimate) && input.estimate > 0
        ? input.estimate
        : undefined,
    status: "planning",
    items: 0,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  const next = [lista, ...safeRead()];
  safeWrite(next);
  emit();
  return lista;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MERCADO_LISTAS_STORAGE_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(listener);
}

// useSyncExternalStore with snapshot caching to avoid SSR/hydration mismatches.
let cachedSnapshot: MercadoLista[] = [];
let cachedSerialized = "[]";

function getSnapshot(): MercadoLista[] {
  const fresh = safeRead();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedSerialized) {
    cachedSerialized = serialized;
    cachedSnapshot = fresh;
  }
  return cachedSnapshot;
}

function getServerSnapshot(): MercadoLista[] {
  return [];
}

export function useMercadoListas(): MercadoLista[] {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Guard against hydration mismatch: render empty until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}
