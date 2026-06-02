// Mercado Inteligente — store de listas de compras.
// Fonte de verdade: Supabase (tabela public.mercado_listas) quando há usuário
// autenticado. localStorage funciona como cache por usuário para manter a API
// síncrona (useSyncExternalStore). Quando não há usuário, usa chave anônima
// (uso pré-login e dados que serão migrados no primeiro login).

import { useEffect, useState, useSyncExternalStore } from "react";
import { registrarPrecosDaCompra } from "./precos-history";

export const MERCADO_LISTAS_STORAGE_KEY = "gi:mercado:listas:v1";

// ----- Sync state (preenchido por mercado-sync.ts) -----
let activeUserId: string | null = null;

function currentStorageKey(): string {
  return activeUserId
    ? `${MERCADO_LISTAS_STORAGE_KEY}:${activeUserId}`
    : MERCADO_LISTAS_STORAGE_KEY;
}

type SyncHooks = {
  onUpsertLista?: (lista: MercadoLista) => void;
  onDeleteLista?: (id: string) => void;
};
let syncHooks: SyncHooks = {};

export function __setMercadoSyncHooks(hooks: SyncHooks) {
  syncHooks = hooks;
}

export function __setMercadoActiveUser(uid: string | null) {
  if (activeUserId === uid) return;
  activeUserId = uid;
  emit();
  emitHistorico();
}

export function __replaceListasCache(listas: MercadoLista[]) {
  safeWrite(listas.map(recomputeDerived));
  emit();
}

export function __getMercadoActiveUserId(): string | null {
  return activeUserId;
}

export const MERCADO_LEGACY_ANON_KEY = MERCADO_LISTAS_STORAGE_KEY;

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
  /** Preço estimado/planejado pelo usuário (referência, antes da compra). */
  precoEstimado?: number;
  /**
   * Preço realmente pago no caixa (opcional, futuro).
   * Conceitualmente separado de `precoEstimado` para permitir, no futuro,
   * alimentar um histórico privado de preços por produto. Não usado pela UI
   * atual — apenas reservado no modelo para evolução incremental.
   */
  precoPago?: number;
  /** Categoria opcional do produto (ex.: "hortifruti"). Reservado para futuro. */
  categoria?: string;
  /** Código de barras opcional (EAN/UPC). Reservado para futuro. */
  codigoBarras?: string;
  /** Origem do registro do item. Default: manual. */
  origem?: "manual" | "lista" | "barcode" | "cupom" | "qrcode";
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
            precoPago:
              typeof it.precoPago === "number" && Number.isFinite(it.precoPago)
                ? it.precoPago
                : undefined,
            categoria:
              typeof it.categoria === "string" && it.categoria ? it.categoria : undefined,
            codigoBarras:
              typeof it.codigoBarras === "string" && it.codigoBarras
                ? it.codigoBarras
                : undefined,
            origem:
              it.origem === "manual" ||
              it.origem === "lista" ||
              it.origem === "barcode" ||
              it.origem === "cupom" ||
              it.origem === "qrcode"
                ? it.origem
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
    const raw = window.localStorage.getItem(currentStorageKey());
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
    window.localStorage.setItem(currentStorageKey(), JSON.stringify(next));
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

function pushUpsert(id: string) {
  if (!syncHooks.onUpsertLista) return;
  const fresh = safeRead().find((l) => l.id === id);
  if (fresh) {
    try { syncHooks.onUpsertLista(fresh); } catch { /* ignore */ }
  }
}

function pushDelete(id: string) {
  if (!syncHooks.onDeleteLista) return;
  try { syncHooks.onDeleteLista(id); } catch { /* ignore */ }
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
  pushUpsert(lista.id);
  return lista;
}

export function addItemLista(
  listaId: string,
  input: {
    nome: string;
    quantidade?: number;
    unidade?: string;
    precoEstimado?: number;
    codigoBarras?: string;
    origem?: ListaItem["origem"];
  },
): ListaItem | null {
  const nome = input.nome.trim();
  if (!nome) return null;
  const now = new Date().toISOString();
  const barcode =
    typeof input.codigoBarras === "string"
      ? input.codigoBarras.replace(/\D/g, "")
      : "";
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
    codigoBarras: barcode ? barcode : undefined,
    origem: input.origem ?? "manual",
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
  pushUpsert(listaId);
  return item;
}

/**
 * Adiciona múltiplos itens a uma lista em UMA única mutação,
 * recomputando derivados, atualizando updatedAt e disparando pushUpsert
 * apenas uma vez. Aditiva — não substitui addItemLista.
 *
 * Sanitização por item:
 * - nome: trim; se vazio, item ignorado.
 * - quantidade: número finito > 0; caso contrário, 1.
 * - precoEstimado: número finito > 0; caso contrário, undefined (sem NaN/Infinity).
 * - codigoBarras: apenas dígitos; vazio vira undefined.
 * - origem: preservada quando válida; default "manual".
 */
export function addItensLista(
  listaId: string,
  inputs: Array<{
    nome: string;
    quantidade?: number;
    unidade?: string;
    precoEstimado?: number;
    codigoBarras?: string;
    origem?: ListaItem["origem"];
  }>,
): MercadoLista | null {
  if (!listaId || !Array.isArray(inputs) || inputs.length === 0) return null;
  const atuais = safeRead();
  const idx = atuais.findIndex((l) => l.id === listaId);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const validOrigens: NonNullable<ListaItem["origem"]>[] = [
    "manual",
    "lista",
    "barcode",
    "cupom",
    "qrcode",
  ];

  const novos: ListaItem[] = [];
  for (const input of inputs) {
    if (!input || typeof input.nome !== "string") continue;
    const nome = input.nome.trim();
    if (!nome) continue;
    const quantidade =
      typeof input.quantidade === "number" &&
      Number.isFinite(input.quantidade) &&
      input.quantidade > 0
        ? input.quantidade
        : 1;
    const precoEstimado =
      typeof input.precoEstimado === "number" &&
      Number.isFinite(input.precoEstimado) &&
      input.precoEstimado > 0
        ? input.precoEstimado
        : undefined;
    const barcode =
      typeof input.codigoBarras === "string"
        ? input.codigoBarras.replace(/\D/g, "")
        : "";
    const origem: ListaItem["origem"] =
      input.origem && validOrigens.includes(input.origem) ? input.origem : "manual";
    novos.push({
      id: genId("itm"),
      nome,
      quantidade,
      unidade: input.unidade?.trim() || undefined,
      precoEstimado,
      codigoBarras: barcode ? barcode : undefined,
      origem,
      comprado: false,
      criadoEm: now,
      atualizadoEm: now,
    });
  }

  if (novos.length === 0) return atuais[idx];

  const prev = atuais[idx];
  const updated = recomputeDerived({
    ...prev,
    entries: [...prev.entries, ...novos],
    updatedAt: now,
  });
  const copy = atuais.slice();
  copy[idx] = updated;
  safeWrite(copy);
  emit();
  pushUpsert(listaId);
  return updated;
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
  pushUpsert(listaId);
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
  pushUpsert(listaId);
}

/**
 * Atualiza dados gerais da lista (nome, tipo, estimativa, observação).
 * NÃO toca em entries/items/progress/status — recomputeDerived mantém consistência.
 * Retorna a lista atualizada ou null se id inexistente / nome vazio.
 */
export function updateListaDados(
  id: string,
  input: { name?: string; tipo?: ListaTipo; estimate?: number | null; observation?: string | null },
): MercadoLista | null {
  if (!id) return null;
  const atuais = safeRead();
  const idx = atuais.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const prev = atuais[idx];

  const nextName =
    input.name !== undefined ? input.name.trim() : prev.name;
  if (!nextName) return null;

  const validTipos: ListaTipo[] = ["compraMes", "reposicao", "churrasco", "farmacia", "outros"];
  const nextTipo: ListaTipo =
    input.tipo !== undefined && validTipos.includes(input.tipo) ? input.tipo : prev.tipo;

  let nextEstimate: number | undefined = prev.estimate;
  if (input.estimate !== undefined) {
    if (input.estimate === null) {
      nextEstimate = undefined;
    } else if (
      typeof input.estimate === "number" &&
      Number.isFinite(input.estimate) &&
      input.estimate > 0
    ) {
      nextEstimate = input.estimate;
    } else {
      nextEstimate = undefined;
    }
  }

  let nextObservation: string | undefined = prev.observation;
  if (input.observation !== undefined) {
    if (input.observation === null) {
      nextObservation = undefined;
    } else {
      const trimmed = input.observation.trim();
      nextObservation = trimmed ? trimmed : undefined;
    }
  }

  const updated: MercadoLista = recomputeDerived({
    ...prev,
    name: nextName,
    tipo: nextTipo,
    estimate: nextEstimate,
    observation: nextObservation,
    updatedAt: new Date().toISOString(),
  });

  const copy = atuais.slice();
  copy[idx] = updated;
  safeWrite(copy);
  emit();
  pushUpsert(updated.id);
  return updated;
}

/**
 * Remove apenas a lista informada do localStorage `gi:mercado:listas:v1`.
 * NÃO toca em histórico de compras, histórico de preços, cesta padrão,
 * mercados cadastrados ou orçamento de mercado (stores isolados).
 * Retorna true se removeu, false se id inexistente/inválido.
 */
export function removeLista(id: string): boolean {
  if (!id) return false;
  const atuais = safeRead();
  const next = atuais.filter((l) => l.id !== id);
  if (next.length === atuais.length) return false;
  safeWrite(next);
  emit();
  pushDelete(id);
  return true;
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

export type OrcamentoLista = {
  hasBudget: boolean;
  budget: number;
  totalEstimado: number;
  diferenca: number; // budget - totalEstimado (positive = remaining)
  percentualUsado: number; // 0..N (can exceed 100)
  overBudget: boolean;
};

export function computeOrcamentoLista(l: MercadoLista): OrcamentoLista {
  const totalEstimado = l.entries.reduce(
    (a, e) => a + (e.precoEstimado ?? 0) * (e.quantidade || 1),
    0,
  );
  const rawBudget = l.estimate;
  const hasBudget =
    typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0;
  const budget = hasBudget ? (rawBudget as number) : 0;
  const diferenca = budget - totalEstimado;
  const percentualUsado = hasBudget ? Math.round((totalEstimado / budget) * 100) : 0;
  return {
    hasBudget,
    budget,
    totalEstimado,
    diferenca,
    percentualUsado,
    overBudget: hasBudget && totalEstimado > budget,
  };
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(MERCADO_LISTAS_STORAGE_KEY)) listener();
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

// ----------------------------------------------------------------------------
// Historico local de compras finalizadas
// (Cache local por usuário, sincronizado com Supabase via mercado-sync)
// ----------------------------------------------------------------------------

export const MERCADO_HISTORICO_STORAGE_KEY = "gi:mercado:historico:v1";
export const MERCADO_HISTORICO_LEGACY_ANON_KEY = MERCADO_HISTORICO_STORAGE_KEY;

function currentHistoricoKey(): string {
  return activeUserId
    ? `${MERCADO_HISTORICO_STORAGE_KEY}:${activeUserId}`
    : MERCADO_HISTORICO_STORAGE_KEY;
}

type HistoricoSyncHooks = {
  onUpsertHistorico?: (h: MercadoCompraHistorico) => void;
  onDeleteHistorico?: (id: string) => void;
};
let historicoSyncHooks: HistoricoSyncHooks = {};

export function __setMercadoHistoricoSyncHooks(hooks: HistoricoSyncHooks) {
  historicoSyncHooks = hooks;
}

export function __replaceHistoricoCache(items: MercadoCompraHistorico[]) {
  safeWriteHistorico(items);
  emitHistorico();
}

export type MercadoCompraHistorico = {
  id: string;
  listaId: string;
  nome: string;
  tipo: ListaTipo;
  concluidaEm: string;
  totalItens: number;
  itensComprados: number;
  itensPendentes: number;
  totalEstimado: number;
  totalCompradoEstimado: number;
  orcamento?: number;
  percentualConcluido: number;
  economiaOuEstouro: number; // positive = saved (under budget), negative = over
  itensSnapshot: ListaItem[];
  /** E15: nome do mercado/estabelecimento informado opcionalmente. Pode estar ausente em compras antigas. */
  mercadoNome?: string;
  /** E34: observação livre fornecida ao registrar a compra. */
  observacao?: string;
};


const historicoListeners = new Set<Listener>();

export function normalizeHistorico(raw: unknown): MercadoCompraHistorico | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.listaId !== "string") return null;
  const itensSnapshot: ListaItem[] = Array.isArray(r.itensSnapshot)
    ? (r.itensSnapshot as unknown[])
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
            precoPago:
              typeof it.precoPago === "number" && Number.isFinite(it.precoPago)
                ? it.precoPago
                : undefined,
            categoria:
              typeof it.categoria === "string" && it.categoria ? it.categoria : undefined,
            codigoBarras:
              typeof it.codigoBarras === "string" && it.codigoBarras
                ? it.codigoBarras
                : undefined,
            origem:
              it.origem === "manual" ||
              it.origem === "lista" ||
              it.origem === "barcode" ||
              it.origem === "cupom" ||
              it.origem === "qrcode"
                ? it.origem
                : undefined,
            comprado: Boolean(it.comprado),
            criadoEm: typeof it.criadoEm === "string" ? it.criadoEm : new Date().toISOString(),
            atualizadoEm:
              typeof it.atualizadoEm === "string" ? it.atualizadoEm : new Date().toISOString(),
          };
        })
        .filter((e): e is ListaItem => e !== null)
    : [];
  const num = (v: unknown, fallback = 0) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    id: r.id,
    listaId: r.listaId,
    nome: typeof r.nome === "string" ? r.nome : "",
    tipo: (r.tipo as ListaTipo) ?? "outros",
    concluidaEm: typeof r.concluidaEm === "string" ? r.concluidaEm : new Date().toISOString(),
    totalItens: num(r.totalItens),
    itensComprados: num(r.itensComprados),
    itensPendentes: num(r.itensPendentes),
    totalEstimado: num(r.totalEstimado),
    totalCompradoEstimado: num(r.totalCompradoEstimado),
    orcamento:
      typeof r.orcamento === "number" && Number.isFinite(r.orcamento) && r.orcamento > 0
        ? r.orcamento
        : undefined,
    percentualConcluido: num(r.percentualConcluido),
    economiaOuEstouro: num(r.economiaOuEstouro),
    itensSnapshot,
    mercadoNome:
      typeof r.mercadoNome === "string" && r.mercadoNome.trim() ? r.mercadoNome.trim() : undefined,
    observacao:
      typeof r.observacao === "string" && r.observacao.trim() ? r.observacao.trim() : undefined,
  };
}


function safeReadHistorico(): MercadoCompraHistorico[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(currentHistoricoKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeHistorico)
      .filter((x): x is MercadoCompraHistorico => x !== null);
  } catch {
    return [];
  }
}

function safeWriteHistorico(next: MercadoCompraHistorico[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(currentHistoricoKey(), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function emitHistorico() {
  for (const l of Array.from(historicoListeners)) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

export function getHistoricoCompras(): MercadoCompraHistorico[] {
  return safeReadHistorico().sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));
}

export function getCompraHistoricoById(id: string): MercadoCompraHistorico | undefined {
  return safeReadHistorico().find((h) => h.id === id);
}

export function removerCompraHistorico(id: string): boolean {
  if (!id) return false;
  const current = safeReadHistorico();
  const next = current.filter((h) => h.id !== id);
  if (next.length === current.length) return false;
  safeWriteHistorico(next);
  emitHistorico();
  if (historicoSyncHooks.onDeleteHistorico) {
    try { historicoSyncHooks.onDeleteHistorico(id); } catch { /* ignore */ }
  }
  return true;
}

export function finalizarListaCompra(
  listaId: string,
  opts: { mercadoNome?: string } = {},
): MercadoCompraHistorico | null {
  const lista = getListaById(listaId);
  if (!lista) return null;
  const resumo = computeResumo(lista);
  const orc = computeOrcamentoLista(lista);
  const mercadoNome =
    typeof opts.mercadoNome === "string" && opts.mercadoNome.trim()
      ? opts.mercadoNome.trim()
      : undefined;
  const entry: MercadoCompraHistorico = {
    id: genId("hst"),
    listaId: lista.id,
    nome: lista.name,
    tipo: lista.tipo,
    concluidaEm: new Date().toISOString(),
    totalItens: resumo.totalItens,
    itensComprados: resumo.itensComprados,
    itensPendentes: resumo.itensPendentes,
    totalEstimado: resumo.totalEstimado,
    totalCompradoEstimado: resumo.totalCompradoEstimado,
    orcamento: orc.hasBudget ? orc.budget : undefined,
    percentualConcluido: resumo.percentualConcluido,
    economiaOuEstouro: orc.hasBudget ? orc.diferenca : 0,
    itensSnapshot: lista.entries.map((e) => ({ ...e })),
    mercadoNome,
  };
  const current = safeReadHistorico();
  safeWriteHistorico([entry, ...current]);
  emitHistorico();

  // Push para Supabase (best-effort, não bloqueia o fluxo local).
  if (historicoSyncHooks.onUpsertHistorico) {
    try { historicoSyncHooks.onUpsertHistorico(entry); } catch { /* ignore */ }
  }

  // E13: registra preços no histórico local de preços por produto.
  // Operação isolada, dedupada por historicoId. Falhas não afetam o fluxo.
  try {
    registrarPrecosDaCompra(entry);
  } catch {
    // ignore — store local não pode quebrar a finalização da compra
  }

  // Mark the source list as done (snapshot already saved).
  mutate((all) =>
    all.map((l) =>
      l.id === listaId
        ? recomputeDerived({ ...l, status: "done", updatedAt: new Date().toISOString() })
        : l,
    ),
  );

  return entry;
}

/**
 * E34: Registra uma compra finalizada diretamente a partir de itens já
 * revisados (ex.: cupom fiscal). NÃO cria lista ativa em /mercado/listas
 * (usa um listaId sintético) e marca todos os itens como comprados para
 * alimentar o histórico de preços via registrarPrecosDaCompra.
 *
 * Sanitização por item: igual a addItensLista.
 * Retorna a entrada de histórico criada, ou null se nenhum item for válido.
 */
export function registrarCompraFinalizadaDoCupom(input: {
  nome: string;
  mercadoNome?: string;
  concluidaEm?: string;
  observacao?: string;
  itens: Array<{
    nome: string;
    quantidade?: number;
    unidade?: string;
    precoEstimado?: number;
    codigoBarras?: string;
    origem?: "cupom" | "qrcode";
  }>;
}): MercadoCompraHistorico | null {
  if (!input || !Array.isArray(input.itens) || input.itens.length === 0) return null;

  const now = new Date().toISOString();
  const concluidaEm =
    typeof input.concluidaEm === "string" && input.concluidaEm.trim()
      ? input.concluidaEm
      : now;

  const validOrigens: NonNullable<ListaItem["origem"]>[] = [
    "manual",
    "lista",
    "barcode",
    "cupom",
    "qrcode",
  ];

  const snapshot: ListaItem[] = [];
  for (const it of input.itens) {
    if (!it || typeof it.nome !== "string") continue;
    const nome = it.nome.trim();
    if (!nome) continue;
    const quantidade =
      typeof it.quantidade === "number" && Number.isFinite(it.quantidade) && it.quantidade > 0
        ? it.quantidade
        : 1;
    const precoEstimado =
      typeof it.precoEstimado === "number" &&
      Number.isFinite(it.precoEstimado) &&
      it.precoEstimado > 0
        ? it.precoEstimado
        : undefined;
    const barcode =
      typeof it.codigoBarras === "string" ? it.codigoBarras.replace(/\D/g, "") : "";
    const origem: ListaItem["origem"] =
      it.origem && validOrigens.includes(it.origem) ? it.origem : "cupom";
    snapshot.push({
      id: genId("itm"),
      nome,
      quantidade,
      unidade: it.unidade?.trim() || undefined,
      precoEstimado,
      codigoBarras: barcode ? barcode : undefined,
      origem,
      comprado: true,
      criadoEm: now,
      atualizadoEm: now,
    });
  }

  if (snapshot.length === 0) return null;

  const totalEstimado = snapshot.reduce(
    (acc, e) => acc + (e.precoEstimado ?? 0) * (e.quantidade || 1),
    0,
  );

  const mercadoNome =
    typeof input.mercadoNome === "string" && input.mercadoNome.trim()
      ? input.mercadoNome.trim()
      : undefined;
  const observacao =
    typeof input.observacao === "string" && input.observacao.trim()
      ? input.observacao.trim()
      : undefined;

  const entry: MercadoCompraHistorico = {
    id: genId("hst"),
    // listaId sintético — NÃO referencia nenhuma MercadoLista ativa,
    // mantendo o registro fora de /mercado/listas.
    listaId: genId("cupom"),
    nome: (input.nome || "").trim() || "Compra importada do cupom",
    tipo: "outros",
    concluidaEm,
    totalItens: snapshot.length,
    itensComprados: snapshot.length,
    itensPendentes: 0,
    totalEstimado,
    totalCompradoEstimado: totalEstimado,
    orcamento: undefined,
    percentualConcluido: 100,
    economiaOuEstouro: 0,
    itensSnapshot: snapshot,
    mercadoNome,
    observacao,
  };

  const current = safeReadHistorico();
  safeWriteHistorico([entry, ...current]);
  emitHistorico();

  // Push para Supabase (best-effort).
  if (historicoSyncHooks.onUpsertHistorico) {
    try { historicoSyncHooks.onUpsertHistorico(entry); } catch { /* ignore */ }
  }

  // Alimenta histórico local de preços (dedup por historicoId).
  try {
    registrarPrecosDaCompra(entry);
  } catch {
    // ignore — store de preços não pode quebrar o registro
  }

  return entry;
}


function subscribeHistorico(listener: Listener): () => void {
  historicoListeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(MERCADO_HISTORICO_STORAGE_KEY)) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      historicoListeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => historicoListeners.delete(listener);
}

let cachedHistorico: MercadoCompraHistorico[] = [];
let cachedHistoricoSerialized = "[]";

function getHistoricoSnapshot(): MercadoCompraHistorico[] {
  const fresh = getHistoricoCompras();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedHistoricoSerialized) {
    cachedHistoricoSerialized = serialized;
    cachedHistorico = fresh;
  }
  return cachedHistorico;
}

function getHistoricoServerSnapshot(): MercadoCompraHistorico[] {
  return [];
}

export function useMercadoHistorico(): MercadoCompraHistorico[] {
  const data = useSyncExternalStore(
    subscribeHistorico,
    getHistoricoSnapshot,
    getHistoricoServerSnapshot,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}
