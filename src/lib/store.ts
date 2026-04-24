import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type Gasto,
  type Categoria,
  type Limite,
  type AprendizadoCategoria,
  type FormaPagamento,
  type TipoGasto,
} from "./types";
import { DEFAULT_CATEGORIES, suggestCategoryFromText } from "./categories";

// ---------- localStorage keys ----------
const K = {
  gastos: "gf:gastos",
  categorias: "gf:categorias",
  limites: "gf:limites",
  aprendizado: "gf:aprendizado",
  bootstrapped: "gf:bootstrapped:v1",
};

// ---------- low-level helpers ----------
function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- pub/sub + cached snapshots ----------
const listeners = new Set<() => void>();

// Stable empty arrays for SSR / first render (same reference across calls)
const EMPTY_GASTOS: Gasto[] = [];
const EMPTY_CATEGORIAS: Categoria[] = [];
const EMPTY_LIMITES: Limite[] = [];
const EMPTY_APRENDIZADO: AprendizadoCategoria[] = [];

// Cached snapshots — only re-read from localStorage when invalidated
let cacheGastos: Gasto[] | null = null;
let cacheCategorias: Categoria[] | null = null;
let cacheLimites: Limite[] | null = null;
let cacheAprendizado: AprendizadoCategoria[] | null = null;

function invalidateAll() {
  cacheGastos = null;
  cacheCategorias = null;
  cacheLimites = null;
  cacheAprendizado = null;
}

function emit() {
  invalidateAll();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ---------- bootstrap ----------
export function bootstrapStore() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(K.bootstrapped)) {
    invalidateAll();
    return;
  }
  const cats: Categoria[] = DEFAULT_CATEGORIES.map((c) => ({
    id: c.id,
    nome: c.nome,
    iconName: c.iconName,
    colorVar: c.colorVar,
    criadaPeloUsuario: false,
  }));
  writeJSON(K.categorias, cats);
  writeJSON(K.gastos, [] as Gasto[]);
  writeJSON(K.limites, [] as Limite[]);
  writeJSON(K.aprendizado, [] as AprendizadoCategoria[]);
  localStorage.setItem(K.bootstrapped, "1");
  invalidateAll();
}

// ---------- selectors / mutators ----------
export function getGastos(): Gasto[] {
  if (typeof window === "undefined") return EMPTY_GASTOS;
  if (cacheGastos === null) cacheGastos = readJSON<Gasto[]>(K.gastos, EMPTY_GASTOS);
  return cacheGastos;
}
export function getCategorias(): Categoria[] {
  if (typeof window === "undefined") return EMPTY_CATEGORIAS;
  if (cacheCategorias === null)
    cacheCategorias = readJSON<Categoria[]>(K.categorias, EMPTY_CATEGORIAS);
  return cacheCategorias;
}
export function getLimites(): Limite[] {
  if (typeof window === "undefined") return EMPTY_LIMITES;
  if (cacheLimites === null) cacheLimites = readJSON<Limite[]>(K.limites, EMPTY_LIMITES);
  return cacheLimites;
}
export function getAprendizado(): AprendizadoCategoria[] {
  if (typeof window === "undefined") return EMPTY_APRENDIZADO;
  if (cacheAprendizado === null)
    cacheAprendizado = readJSON<AprendizadoCategoria[]>(K.aprendizado, EMPTY_APRENDIZADO);
  return cacheAprendizado;
}

export function getCategoriaById(id: string): Categoria | undefined {
  return getCategorias().find((c) => c.id === id);
}

// ---------- Gastos ----------
export type NovoGastoInput = {
  descricao?: string;
  valor: number;
  data: string;
  estabelecimento?: string;
  categoriaId: string;
  formaPagamento: FormaPagamento;
  observacao?: string;
  imagemUrl?: string;
  tipoGasto?: TipoGasto;
  totalParcelas?: number; // when tipoGasto = parcelado
  recorrenteMeses?: number; // when tipoGasto = recorrente, optional cap
};

export function addGasto(input: NovoGastoInput): Gasto[] {
  const now = new Date().toISOString();
  const gastos = getGastos();
  const baseDate = new Date(input.data + "T00:00:00");
  const tipo = input.tipoGasto ?? "unico";
  const created: Gasto[] = [];

  if (tipo === "parcelado" && (input.totalParcelas ?? 0) > 1) {
    const total = input.totalParcelas!;
    const valorParcela = Math.round((input.valor / total) * 100) / 100;
    const grupo = uid();
    for (let i = 0; i < total; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      created.push({
        id: uid(),
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: valorParcela,
        data: iso,
        estabelecimento: input.estabelecimento || "",
        categoriaId: input.categoriaId,
        formaPagamento: input.formaPagamento,
        observacao: input.observacao,
        imagemUrl: input.imagemUrl,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
        confirmado: true,
        tipoGasto: "parcelado",
        parcelaAtual: i + 1,
        totalParcelas: total,
        grupoParcelamentoId: grupo,
        criadoEm: now,
        atualizadoEm: now,
      });
    }
  } else if (tipo === "recorrente") {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = uid();
    for (let i = 0; i < meses; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      created.push({
        id: uid(),
        descricao: input.descricao || input.estabelecimento || "Gasto",
        valor: input.valor,
        data: iso,
        estabelecimento: input.estabelecimento || "",
        categoriaId: input.categoriaId,
        formaPagamento: input.formaPagamento,
        observacao: input.observacao,
        imagemUrl: input.imagemUrl,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
        confirmado: true,
        tipoGasto: "recorrente",
        recorrenciaId: recId,
        criadoEm: now,
        atualizadoEm: now,
      });
    }
  } else {
    created.push({
      id: uid(),
      descricao: input.descricao || input.estabelecimento || "Gasto",
      valor: input.valor,
      data: input.data,
      estabelecimento: input.estabelecimento || "",
      categoriaId: input.categoriaId,
      formaPagamento: input.formaPagamento,
      observacao: input.observacao,
      imagemUrl: input.imagemUrl,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      confirmado: true,
      tipoGasto: "unico",
      criadoEm: now,
      atualizadoEm: now,
    });
  }

  const next = [...gastos, ...created];
  writeJSON(K.gastos, next);

  // learn
  if (input.estabelecimento) {
    rememberCategoryFor(input.estabelecimento, input.categoriaId);
  }

  emit();
  return created;
}

export function updateGasto(id: string, patch: Partial<Gasto>) {
  const gastos = [...getGastos()];
  const idx = gastos.findIndex((g) => g.id === id);
  if (idx < 0) return;
  const updated = { ...gastos[idx], ...patch, atualizadoEm: new Date().toISOString() };
  if (patch.data) {
    const d = new Date(patch.data + "T00:00:00");
    updated.mes = d.getMonth() + 1;
    updated.ano = d.getFullYear();
  }
  gastos[idx] = updated;
  writeJSON(K.gastos, gastos);
  emit();
}

export function deleteGasto(id: string) {
  const gastos = getGastos().filter((g) => g.id !== id);
  writeJSON(K.gastos, gastos);
  emit();
}

export function findPossibleDuplicate(
  valor: number,
  data: string,
  estabelecimento?: string,
): Gasto | undefined {
  const gastos = getGastos();
  return gastos.find(
    (g) =>
      Math.abs(g.valor - valor) < 0.01 &&
      g.data === data &&
      (estabelecimento
        ? g.estabelecimento.trim().toLowerCase() === estabelecimento.trim().toLowerCase()
        : true),
  );
}

// ---------- Categorias ----------
export function addCategoria(c: Omit<Categoria, "id" | "criadaPeloUsuario">): Categoria {
  const novo: Categoria = { ...c, id: uid(), criadaPeloUsuario: true };
  writeJSON(K.categorias, [...getCategorias(), novo]);
  emit();
  return novo;
}
export function updateCategoria(id: string, patch: Partial<Categoria>) {
  const list = getCategorias().map((c) => (c.id === id ? { ...c, ...patch } : c));
  writeJSON(K.categorias, list);
  emit();
}
export function deleteCategoria(id: string) {
  const list = getCategorias().filter((c) => c.id !== id);
  writeJSON(K.categorias, list);
  emit();
}

// ---------- Limites ----------
export function setLimite(tipo: "total" | string, valor: number, mes: number, ano: number) {
  const list = [...getLimites()];
  const idx = list.findIndex((l) => l.tipo === tipo && l.mes === mes && l.ano === ano);
  if (idx >= 0) {
    list[idx] = { ...list[idx], valor };
  } else {
    list.push({ id: uid(), tipo, valor, mes, ano });
  }
  writeJSON(K.limites, list);
  emit();
}
export function getLimite(tipo: "total" | string, mes: number, ano: number): number | undefined {
  return getLimites().find((l) => l.tipo === tipo && l.mes === mes && l.ano === ano)?.valor;
}

// ---------- Aprendizado ----------
export function rememberCategoryFor(estabelecimento: string, categoriaId: string) {
  const key = estabelecimento.trim().toLowerCase();
  if (!key) return;
  const list = [...getAprendizado()];
  const idx = list.findIndex((a) => a.estabelecimento === key);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...list[idx], categoriaId, criadoEm: now };
  } else {
    list.push({ id: uid(), estabelecimento: key, categoriaId, criadoEm: now });
  }
  writeJSON(K.aprendizado, list);
  invalidateAll();
}

export function suggestCategory(text: string): string {
  const key = text.trim().toLowerCase();
  if (key) {
    const learned = getAprendizado().find((a) => key.includes(a.estabelecimento));
    if (learned) return learned.categoriaId;
  }
  return suggestCategoryFromText(text);
}

// ---------- React hooks ----------
export function useStore<T>(selector: () => T): T {
  return useSyncExternalStore(
    subscribe,
    selector,
    selector,
  );
}

/** Ensures bootstrap runs once on the client. */
export function useBootstrap() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    bootstrapStore();
    setReady(true);
  }, []);
  return ready;
}
