// Local-only store for Mercado Inteligente shopping lists.
// Persists to localStorage under an isolated key. NO Supabase, NO API.

import { useEffect, useState, useSyncExternalStore } from "react";

export const MERCADO_LISTAS_STORAGE_KEY = "gi:mercado:listas:v1";

export type ListaTipo =
  | "compraMes"
  | "reposicao"
  | "churrasco"
  | "farmacia"
  | "outros";

export type ListaStatus = "planning" | "ongoing" | "done";

export type ListaItem = {
  id: string;
  nome: string;
  quantidade: number;
  unidade?: string;
  precoEstimado?: number;
  comprado: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

export type MercadoLista = {
  id: string;
  name: string;
  tipo: ListaTipo;
  observation?: string;
  estimate?: number;
  status: ListaStatus;
  items: number; // derived from entries.length (kept for back-compat)
  progress: number; // 0-100 derived from purchased ratio
  entries: ListaItem[];
  createdAt: string;
  updatedAt: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function genId(prefix: string): string {
  if (isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(raw: unknown): MercadoLista | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const entries: ListaItem[] = Array.isArray(r.entries)
    ? (r.entries as unknown[])
        .map((e): ListaItem | null => {
          if (!e || typeof e !== "object") return null;
          const it = e as Record<string, unknown>;
          if (typeof it.id !== "string" || typeof it.nome !== "string") return null;
          return {
            id: it.id,
            nome: it.nome,
            quantidade:
              typeof it.quantidade === "number" && Number.isFinite(it.quantidade)
                ? it.quantidade
                : 1,
            unidade: typeof it.unidade === "string" && it.unidade ? it.unidade : undefined,
            precoEstimado:
              typeof it.precoEstimado === "number" && Number.isFinite(it.precoEstimado)
                ? it.precoEstimado
                : undefined,
            comprado: Boolean(it.comprado),
            criadoEm: typeof it.criadoEm === "string" ? it.criadoEm : new Date().toISOString(),
            atualizadoEm:
              typeof it.atualizadoEm === "string" ? it.atualizadoEm : new Date().toISOString(),
          };
        })
        .filter((e): e is ListaItem => e !== null)
    : [];
  const tipo = (r.tipo as ListaTipo) ?? "outros";
  const now = new Date().toISOString();
  const lista: MercadoLista = {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    tipo,
    observation: typeof r.observation === "string" ? r.observation : undefined,
    estimate:
      typeof r.estimate === "number" && Number.isFinite(r.estimate) ? r.estimate : undefined,
    status: (r.status as ListaStatus) ?? "planning",
    items: typeof r.items === "number" ? r.items : entries.length,
    progress: typeof r.progress === "number" ? r.progress : 0,
    entries,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now,
  };
  return recomputeDerived(lista);
}

function recomputeDerived(l: MercadoLista): MercadoLista {
  const total = l.entries.length;
  const bought = l.entries.filter((e) => e.comprado).length;
  const progress = total === 0 ? 0 : Math.round((bought / total) * 100);
  const status: ListaStatus =
    total === 0 ? "planning" : bought === total ? "done" : bought === 0 ? "planning" : "ongoing";
  return { ...l, items: total, progress, status };
}

function safeRead(): MercadoLista[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MERCADO_LISTAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((x): x is MercadoLista => x !== null);
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

function mutate(updater: (current: MercadoLista[]) => MercadoLista[]) {
  const next = updater(safeRead());
  safeWrite(next);
  emit();
}

export function getListas(): MercadoLista[] {
  return safeRead();
}

export function getListaById(id: string): MercadoLista | undefined {
  return safeRead().find((l) => l.id === id);
}

export function addLista(input: {
  name: string;
  tipo: ListaTipo;
  observation?: string;
  estimate?: number;
}): MercadoLista {
  const now = new Date().toISOString();
  const lista: MercadoLista = recomputeDerived({
    id: genId("lst"),
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
    entries: [],
    createdAt: now,
    updatedAt: now,
  });
  mutate((cur) => [lista, ...cur]);
  return lista;
}

export function addItemLista(
  listaId: string,
  input: { nome: string; quantidade?: number; unidade?: string; precoEstimado?: number },
): ListaItem | null {
  const nome = input.nome.trim();
  if (!nome) return null;
  const now = new Date().toISOString();
  const item: ListaItem = {
    id: genId("itm"),
    nome,
    quantidade:
      typeof input.quantidade === "number" && Number.isFinite(input.quantidade) && input.quantidade > 0
        ? input.quantidade
        : 1,
    unidade: input.unidade?.trim() || undefined,
    precoEstimado:
      typeof input.precoEstimado === "number" &&
      Number.isFinite(input.precoEstimado) &&
      input.precoEstimado > 0
        ? input.precoEstimado
        : undefined,
    comprado: false,
    criadoEm: now,
    atualizadoEm: now,
  };
  mutate((cur) =>
    cur.map((l) =>
      l.id === listaId
        ? recomputeDerived({ ...l, entries: [...l.entries, item], updatedAt: now })
        : l,
    ),
  );
  return item;
}

export function updateItemLista(
  listaId: string,
  itemId: string,
  patch: Partial<Pick<ListaItem, "nome" | "quantidade" | "unidade" | "precoEstimado" | "comprado">>,
) {
  const now = new Date().toISOString();
  mutate((cur) =>
    cur.map((l) => {
      if (l.id !== listaId) return l;
      const entries = l.entries.map((it) => {
        if (it.id !== itemId) return it;
        const next: ListaItem = {
          ...it,
          nome: patch.nome !== undefined ? patch.nome.trim() || it.nome : it.nome,
          quantidade:
            patch.quantidade !== undefined &&
            Number.isFinite(patch.quantidade) &&
            (patch.quantidade as number) > 0
              ? (patch.quantidade as number)
              : it.quantidade,
          unidade:
            patch.unidade !== undefined
              ? patch.unidade?.trim() || undefined
              : it.unidade,
          precoEstimado:
            patch.precoEstimado !== undefined
              ? typeof patch.precoEstimado === "number" &&
                Number.isFinite(patch.precoEstimado) &&
                patch.precoEstimado > 0
                ? patch.precoEstimado
                : undefined
              : it.precoEstimado,
          comprado: patch.comprado !== undefined ? Boolean(patch.comprado) : it.comprado,
          atualizadoEm: now,
        };
        return next;
      });
      return recomputeDerived({ ...l, entries, updatedAt: now });
    }),
  );
}

export function toggleItemComprado(listaId: string, itemId: string) {
  const lista = getListaById(listaId);
  const item = lista?.entries.find((e) => e.id === itemId);
  if (!item) return;
  updateItemLista(listaId, itemId, { comprado: !item.comprado });
}

export function removeItemLista(listaId: string, itemId: string) {
  const now = new Date().toISOString();
  mutate((cur) =>
    cur.map((l) =>
      l.id === listaId
        ? recomputeDerived({
            ...l,
            entries: l.entries.filter((e) => e.id !== itemId),
            updatedAt: now,
          })
        : l,
    ),
  );
}

export type ResumoLista = {
  totalItens: number;
  itensComprados: number;
  itensPendentes: number;
  totalEstimado: number;
  totalCompradoEstimado: number;
  percentualConcluido: number;
};

export function getResumoLista(listaId: string): ResumoLista {
  const l = getListaById(listaId);
  if (!l) {
    return {
      totalItens: 0,
      itensComprados: 0,
      itensPendentes: 0,
      totalEstimado: 0,
      totalCompradoEstimado: 0,
      percentualConcluido: 0,
    };
  }
  return computeResumo(l);
}

export function computeResumo(l: MercadoLista): ResumoLista {
  const totalItens = l.entries.length;
  const itensComprados = l.entries.filter((e) => e.comprado).length;
  const itensPendentes = totalItens - itensComprados;
  const totalEstimado = l.entries.reduce(
    (a, e) => a + (e.precoEstimado ?? 0) * (e.quantidade || 1),
    0,
  );
  const totalCompradoEstimado = l.entries
    .filter((e) => e.comprado)
    .reduce((a, e) => a + (e.precoEstimado ?? 0) * (e.quantidade || 1), 0);
  const percentualConcluido = totalItens === 0 ? 0 : Math.round((itensComprados / totalItens) * 100);
  return {
    totalItens,
    itensComprados,
    itensPendentes,
    totalEstimado,
    totalCompradoEstimado,
    percentualConcluido,
  };
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}

export function useMercadoLista(id: string | undefined): MercadoLista | undefined {
  const all = useMercadoListas();
  if (!id) return undefined;
  return all.find((l) => l.id === id);
}
