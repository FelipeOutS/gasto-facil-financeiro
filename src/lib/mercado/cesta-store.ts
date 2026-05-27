// Local-only store for Mercado Inteligente "Cesta padrão" (recurring baskets).
// 100% localStorage. NO Supabase, NO API, NO Dashboard integration.
// Independent from listas-store, but uses its public helpers (addLista,
// addItemLista) when generating a new shopping list from a basket.

import { useEffect, useState, useSyncExternalStore } from "react";
import { addItemLista, addLista, type MercadoLista } from "./listas-store";

export const MERCADO_CESTA_STORAGE_KEY = "gi:mercado:cesta:v1";

export type CestaTipo =
  | "compraMes"
  | "reposicao"
  | "limpeza"
  | "farmacia"
  | "churrasco"
  | "outros";

export type MercadoCestaItem = {
  id: string;
  nome: string;
  quantidade: number;
  unidade?: string;
  precoEstimado?: number;
  criadoEm: string;
  atualizadoEm: string;
};

export type MercadoCestaPadrao = {
  id: string;
  nome: string;
  tipo: CestaTipo;
  descricao?: string;
  itens: MercadoCestaItem[];
  criadoEm: string;
  atualizadoEm: string;
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

const TIPOS: ReadonlySet<CestaTipo> = new Set([
  "compraMes",
  "reposicao",
  "limpeza",
  "farmacia",
  "churrasco",
  "outros",
]);

function normalizeTipo(value: unknown): CestaTipo {
  return typeof value === "string" && TIPOS.has(value as CestaTipo)
    ? (value as CestaTipo)
    : "outros";
}

function normalizeItem(raw: unknown): MercadoCestaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  if (typeof it.id !== "string" || typeof it.nome !== "string") return null;
  const now = new Date().toISOString();
  return {
    id: it.id,
    nome: it.nome,
    quantidade:
      typeof it.quantidade === "number" && Number.isFinite(it.quantidade) && it.quantidade > 0
        ? it.quantidade
        : 1,
    unidade: typeof it.unidade === "string" && it.unidade ? it.unidade : undefined,
    precoEstimado:
      typeof it.precoEstimado === "number" &&
      Number.isFinite(it.precoEstimado) &&
      it.precoEstimado > 0
        ? it.precoEstimado
        : undefined,
    criadoEm: typeof it.criadoEm === "string" ? it.criadoEm : now,
    atualizadoEm: typeof it.atualizadoEm === "string" ? it.atualizadoEm : now,
  };
}

function normalize(raw: unknown): MercadoCestaPadrao | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const now = new Date().toISOString();
  const itens: MercadoCestaItem[] = Array.isArray(r.itens)
    ? (r.itens as unknown[])
        .map(normalizeItem)
        .filter((x): x is MercadoCestaItem => x !== null)
    : [];
  return {
    id: r.id,
    nome: typeof r.nome === "string" ? r.nome : "",
    tipo: normalizeTipo(r.tipo),
    descricao: typeof r.descricao === "string" && r.descricao ? r.descricao : undefined,
    itens,
    criadoEm: typeof r.criadoEm === "string" ? r.criadoEm : now,
    atualizadoEm: typeof r.atualizadoEm === "string" ? r.atualizadoEm : now,
  };
}

function safeRead(): MercadoCestaPadrao[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MERCADO_CESTA_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((x): x is MercadoCestaPadrao => x !== null);
  } catch {
    return [];
  }
}

function safeWrite(next: MercadoCestaPadrao[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MERCADO_CESTA_STORAGE_KEY, JSON.stringify(next));
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

function mutate(updater: (current: MercadoCestaPadrao[]) => MercadoCestaPadrao[]) {
  const next = updater(safeRead());
  safeWrite(next);
  emit();
}

export function getCestasPadrao(): MercadoCestaPadrao[] {
  return safeRead();
}

export function getCestaPadraoById(id: string): MercadoCestaPadrao | undefined {
  return safeRead().find((c) => c.id === id);
}

export function addCestaPadrao(input: {
  nome: string;
  tipo: CestaTipo;
  descricao?: string;
}): MercadoCestaPadrao {
  const now = new Date().toISOString();
  const cesta: MercadoCestaPadrao = {
    id: genId("cst"),
    nome: input.nome.trim(),
    tipo: normalizeTipo(input.tipo),
    descricao: input.descricao?.trim() || undefined,
    itens: [],
    criadoEm: now,
    atualizadoEm: now,
  };
  mutate((cur) => [cesta, ...cur]);
  return cesta;
}

export function updateCestaPadrao(
  id: string,
  patch: Partial<Pick<MercadoCestaPadrao, "nome" | "tipo" | "descricao">>,
) {
  const now = new Date().toISOString();
  mutate((cur) =>
    cur.map((c) => {
      if (c.id !== id) return c;
      return {
        ...c,
        nome: patch.nome !== undefined ? patch.nome.trim() || c.nome : c.nome,
        tipo: patch.tipo !== undefined ? normalizeTipo(patch.tipo) : c.tipo,
        descricao:
          patch.descricao !== undefined ? patch.descricao?.trim() || undefined : c.descricao,
        atualizadoEm: now,
      };
    }),
  );
}

export function removeCestaPadrao(id: string) {
  mutate((cur) => cur.filter((c) => c.id !== id));
}

export function addItemCesta(
  cestaId: string,
  input: { nome: string; quantidade?: number; unidade?: string; precoEstimado?: number },
): MercadoCestaItem | null {
  const nome = input.nome.trim();
  if (!nome) return null;
  const now = new Date().toISOString();
  const item: MercadoCestaItem = {
    id: genId("citm"),
    nome,
    quantidade:
      typeof input.quantidade === "number" &&
      Number.isFinite(input.quantidade) &&
      input.quantidade > 0
        ? input.quantidade
        : 1,
    unidade: input.unidade?.trim() || undefined,
    precoEstimado:
      typeof input.precoEstimado === "number" &&
      Number.isFinite(input.precoEstimado) &&
      input.precoEstimado > 0
        ? input.precoEstimado
        : undefined,
    criadoEm: now,
    atualizadoEm: now,
  };
  mutate((cur) =>
    cur.map((c) =>
      c.id === cestaId ? { ...c, itens: [...c.itens, item], atualizadoEm: now } : c,
    ),
  );
  return item;
}

export function updateItemCesta(
  cestaId: string,
  itemId: string,
  patch: Partial<Pick<MercadoCestaItem, "nome" | "quantidade" | "unidade" | "precoEstimado">>,
) {
  const now = new Date().toISOString();
  mutate((cur) =>
    cur.map((c) => {
      if (c.id !== cestaId) return c;
      const itens = c.itens.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          nome: patch.nome !== undefined ? patch.nome.trim() || it.nome : it.nome,
          quantidade:
            patch.quantidade !== undefined &&
            Number.isFinite(patch.quantidade) &&
            (patch.quantidade as number) > 0
              ? (patch.quantidade as number)
              : it.quantidade,
          unidade:
            patch.unidade !== undefined ? patch.unidade?.trim() || undefined : it.unidade,
          precoEstimado:
            patch.precoEstimado !== undefined
              ? typeof patch.precoEstimado === "number" &&
                Number.isFinite(patch.precoEstimado) &&
                patch.precoEstimado > 0
                ? patch.precoEstimado
                : undefined
              : it.precoEstimado,
          atualizadoEm: now,
        };
      });
      return { ...c, itens, atualizadoEm: now };
    }),
  );
}

export function removeItemCesta(cestaId: string, itemId: string) {
  const now = new Date().toISOString();
  mutate((cur) =>
    cur.map((c) =>
      c.id === cestaId
        ? { ...c, itens: c.itens.filter((it) => it.id !== itemId), atualizadoEm: now }
        : c,
    ),
  );
}

export function computeCestaTotal(c: MercadoCestaPadrao): number {
  return c.itens.reduce((a, it) => a + (it.precoEstimado ?? 0) * (it.quantidade || 1), 0);
}

/**
 * Cria uma nova lista de compras a partir de uma cesta padrão.
 * A cesta original NÃO é alterada — funciona como modelo.
 * Retorna a lista criada ou null se a cesta não existir.
 */
export function gerarListaAPartirDaCesta(cestaId: string): MercadoLista | null {
  const cesta = getCestaPadraoById(cestaId);
  if (!cesta) return null;
  // Mapeia o tipo da cesta para um tipo de lista compatível.
  const tipoLista =
    cesta.tipo === "compraMes" || cesta.tipo === "reposicao"
      ? cesta.tipo
      : cesta.tipo === "churrasco"
        ? "churrasco"
        : cesta.tipo === "farmacia"
          ? "farmacia"
          : "outros";
  const estimate = computeCestaTotal(cesta);
  const lista = addLista({
    name: cesta.nome,
    tipo: tipoLista,
    observation: cesta.descricao,
    estimate: estimate > 0 ? estimate : undefined,
  });
  for (const it of cesta.itens) {
    addItemLista(lista.id, {
      nome: it.nome,
      quantidade: it.quantidade,
      unidade: it.unidade,
      precoEstimado: it.precoEstimado,
    });
  }
  // Return the created list reference (entries são persistidas no listas-store).
  return { ...lista };
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MERCADO_CESTA_STORAGE_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(listener);
}

let cachedSnapshot: MercadoCestaPadrao[] = [];
let cachedSerialized = "[]";

function getSnapshot(): MercadoCestaPadrao[] {
  const fresh = safeRead();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedSerialized) {
    cachedSerialized = serialized;
    cachedSnapshot = fresh;
  }
  return cachedSnapshot;
}

function getServerSnapshot(): MercadoCestaPadrao[] {
  return [];
}

export function useCestasPadrao(): MercadoCestaPadrao[] {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}
