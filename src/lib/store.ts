import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type Gasto,
  type Categoria,
  type Limite,
  type AprendizadoCategoria,
  type FormaPagamento,
  type TipoGasto,
  type Receita,
  type TipoReceita,
  type Banco,
  type Guardado,
  type TipoReserva,
  type Meta,
  type MovimentacaoMeta,
  type StatusMeta,
} from "./types";
import { DEFAULT_CATEGORIES, suggestCategoryFromText } from "./categories";

// ---------- localStorage keys (per-user namespacing) ----------
let activeUserId: string | null = null;

const SUFFIXES = {
  gastos: "gastos",
  categorias: "categorias",
  limites: "limites",
  aprendizado: "aprendizado",
  receitas: "receitas",
  bancos: "bancos",
  guardado: "guardado",
  metas: "metas",
  movMetas: "movMetas",
  bootstrapped: "bootstrapped:v2",
} as const;

function ns(suffix: string): string {
  // When no user is logged in, use a sandbox key so we never leak data into anonymous storage.
  const uid = activeUserId ?? "anon";
  return `gf:u:${uid}:${suffix}`;
}

const K = new Proxy({} as Record<keyof typeof SUFFIXES, string>, {
  get(_t, prop: string) {
    const s = (SUFFIXES as Record<string, string>)[prop];
    if (!s) return undefined;
    return ns(s);
  },
});

export function setActiveUserId(uid: string | null) {
  if (activeUserId === uid) return;
  activeUserId = uid;
  invalidateAll();
  emitOnly();
}

/**
 * Migrate legacy global keys (gf:gastos, gf:categorias, ...) into the user namespace,
 * once per user. Safe to call multiple times.
 */
export function migrateLegacyDataToUser(uid: string) {
  if (typeof window === "undefined") return;
  const flagKey = `gf:u:${uid}:migrated:v1`;
  if (localStorage.getItem(flagKey)) return;
  const legacyKeys: Array<[string, keyof typeof SUFFIXES]> = [
    ["gf:gastos", "gastos"],
    ["gf:categorias", "categorias"],
    ["gf:limites", "limites"],
    ["gf:aprendizado", "aprendizado"],
    ["gf:receitas", "receitas"],
    ["gf:bancos", "bancos"],
    ["gf:guardado", "guardado"],
    ["gf:metas", "metas"],
    ["gf:movMetas", "movMetas"],
  ];
  for (const [legacy, suffix] of legacyKeys) {
    const v = localStorage.getItem(legacy);
    const target = `gf:u:${uid}:${suffix}`;
    if (v && !localStorage.getItem(target)) {
      localStorage.setItem(target, v);
    }
  }
  // Mark bootstrapped so we don't overwrite the migrated data.
  if (localStorage.getItem("gf:bootstrapped:v2")) {
    localStorage.setItem(`gf:u:${uid}:bootstrapped:v2`, "1");
  }
  localStorage.setItem(flagKey, "1");
  invalidateAll();
  emitOnly();
}

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
const EMPTY_RECEITAS: Receita[] = [];
const EMPTY_BANCOS: Banco[] = [];
const EMPTY_GUARDADO: Guardado[] = [];
const EMPTY_METAS: Meta[] = [];
const EMPTY_MOV: MovimentacaoMeta[] = [];

// Cached snapshots
let cacheGastos: Gasto[] | null = null;
let cacheCategorias: Categoria[] | null = null;
let cacheLimites: Limite[] | null = null;
let cacheAprendizado: AprendizadoCategoria[] | null = null;
let cacheReceitas: Receita[] | null = null;
let cacheBancos: Banco[] | null = null;
let cacheGuardado: Guardado[] | null = null;
let cacheMetas: Meta[] | null = null;
let cacheMov: MovimentacaoMeta[] | null = null;

function invalidateAll() {
  cacheGastos = null;
  cacheCategorias = null;
  cacheLimites = null;
  cacheAprendizado = null;
  cacheReceitas = null;
  cacheBancos = null;
  cacheGuardado = null;
  cacheMetas = null;
  cacheMov = null;
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

// ---------- bancos default ----------
const BANCOS_PADRAO: Array<{ nome: string; colorHex: string }> = [
  { nome: "Nubank", colorHex: "#820ad1" },
  { nome: "Mercado Pago", colorHex: "#00b1ea" },
  { nome: "Itaú", colorHex: "#ec7000" },
  { nome: "Bradesco", colorHex: "#cc092f" },
  { nome: "Santander", colorHex: "#ec0000" },
  { nome: "Banco do Brasil", colorHex: "#fae128" },
  { nome: "Caixa", colorHex: "#1c5aa8" },
  { nome: "Inter", colorHex: "#ff7a00" },
  { nome: "C6 Bank", colorHex: "#3a3a3a" },
  { nome: "PicPay", colorHex: "#21c25e" },
  { nome: "PagBank", colorHex: "#048b3a" },
  { nome: "BTG Pactual", colorHex: "#0f2a4a" },
  { nome: "XP", colorHex: "#000000" },
  { nome: "Neon", colorHex: "#00d8c0" },
  { nome: "Will Bank", colorHex: "#0f9b5e" },
  { nome: "Original", colorHex: "#1d8b4e" },
  { nome: "Sicredi", colorHex: "#3aaa35" },
  { nome: "Sicoob", colorHex: "#003d2b" },
];

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
  const bancos: Banco[] = BANCOS_PADRAO.map((b) => ({
    id: b.nome.toLowerCase().replace(/\s+/g, "-"),
    nome: b.nome,
    colorHex: b.colorHex,
    criadoPeloUsuario: false,
    criadoEm: new Date().toISOString(),
  }));
  writeJSON(K.categorias, cats);
  writeJSON(K.gastos, [] as Gasto[]);
  writeJSON(K.limites, [] as Limite[]);
  writeJSON(K.aprendizado, [] as AprendizadoCategoria[]);
  writeJSON(K.receitas, [] as Receita[]);
  writeJSON(K.bancos, bancos);
  writeJSON(K.guardado, [] as Guardado[]);
  writeJSON(K.metas, [] as Meta[]);
  writeJSON(K.movMetas, [] as MovimentacaoMeta[]);
  localStorage.setItem(K.bootstrapped, "1");
  invalidateAll();
}

// ---------- selectors ----------
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
export function getReceitas(): Receita[] {
  if (typeof window === "undefined") return EMPTY_RECEITAS;
  if (cacheReceitas === null) cacheReceitas = readJSON<Receita[]>(K.receitas, EMPTY_RECEITAS);
  return cacheReceitas;
}
export function getBancos(): Banco[] {
  if (typeof window === "undefined") return EMPTY_BANCOS;
  if (cacheBancos === null) cacheBancos = readJSON<Banco[]>(K.bancos, EMPTY_BANCOS);
  return cacheBancos;
}
export function getGuardado(): Guardado[] {
  if (typeof window === "undefined") return EMPTY_GUARDADO;
  if (cacheGuardado === null) cacheGuardado = readJSON<Guardado[]>(K.guardado, EMPTY_GUARDADO);
  return cacheGuardado;
}
export function getMetas(): Meta[] {
  if (typeof window === "undefined") return EMPTY_METAS;
  if (cacheMetas === null) cacheMetas = readJSON<Meta[]>(K.metas, EMPTY_METAS);
  return cacheMetas;
}
export function getMovimentacoesMeta(): MovimentacaoMeta[] {
  if (typeof window === "undefined") return EMPTY_MOV;
  if (cacheMov === null) cacheMov = readJSON<MovimentacaoMeta[]>(K.movMetas, EMPTY_MOV);
  return cacheMov;
}

export function getCategoriaById(id: string): Categoria | undefined {
  return getCategorias().find((c) => c.id === id);
}
export function getBancoById(id: string): Banco | undefined {
  return getBancos().find((b) => b.id === id);
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
  totalParcelas?: number;
  recorrenteMeses?: number;
  essencial?: boolean;
  gastoFixo?: boolean;
};

export function addGasto(input: NovoGastoInput): Gasto[] {
  const now = new Date().toISOString();
  const gastos = getGastos();
  const baseDate = new Date(input.data + "T00:00:00");
  const tipo = input.tipoGasto ?? "unico";
  const created: Gasto[] = [];
  const fixoFlag = input.gastoFixo ?? tipo === "recorrente";

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
        essencial: input.essencial,
        gastoFixo: input.gastoFixo,
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
        essencial: input.essencial,
        gastoFixo: fixoFlag,
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
      essencial: input.essencial,
      gastoFixo: input.gastoFixo,
      criadoEm: now,
      atualizadoEm: now,
    });
  }

  const next = [...gastos, ...created];
  writeJSON(K.gastos, next);

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

// ---------- Receitas ----------
export type NovaReceitaInput = {
  descricao: string;
  valor: number;
  data: string;
  tipo: TipoReceita;
  recorrente?: boolean;
  recorrenteMeses?: number;
};

export function addReceita(input: NovaReceitaInput): Receita[] {
  const now = new Date().toISOString();
  const baseDate = new Date(input.data + "T00:00:00");
  const created: Receita[] = [];
  if (input.recorrente) {
    const meses = Math.max(1, input.recorrenteMeses ?? 12);
    const recId = uid();
    for (let i = 0; i < meses; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const iso = d.toISOString().slice(0, 10);
      created.push({
        id: uid(),
        descricao: input.descricao,
        valor: input.valor,
        data: iso,
        tipo: input.tipo,
        recorrente: true,
        recorrenciaId: recId,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
        criadoEm: now,
        atualizadoEm: now,
      });
    }
  } else {
    created.push({
      id: uid(),
      descricao: input.descricao,
      valor: input.valor,
      data: input.data,
      tipo: input.tipo,
      recorrente: false,
      mes: baseDate.getMonth() + 1,
      ano: baseDate.getFullYear(),
      criadoEm: now,
      atualizadoEm: now,
    });
  }
  writeJSON(K.receitas, [...getReceitas(), ...created]);
  emit();
  return created;
}

export function deleteReceita(id: string) {
  writeJSON(
    K.receitas,
    getReceitas().filter((r) => r.id !== id),
  );
  emit();
}

// ---------- Bancos ----------
export function addBanco(input: { nome: string; colorHex: string }): Banco {
  const novo: Banco = {
    id: uid(),
    nome: input.nome.trim(),
    colorHex: input.colorHex,
    criadoPeloUsuario: true,
    criadoEm: new Date().toISOString(),
  };
  writeJSON(K.bancos, [...getBancos(), novo]);
  emit();
  return novo;
}

export function updateBanco(id: string, patch: Partial<Banco>) {
  const list = getBancos().map((b) => (b.id === id ? { ...b, ...patch } : b));
  writeJSON(K.bancos, list);
  emit();
}

export function deleteBanco(id: string) {
  writeJSON(
    K.bancos,
    getBancos().filter((b) => b.id !== id),
  );
  // remover guardado vinculado
  writeJSON(
    K.guardado,
    getGuardado().filter((g) => g.bancoId !== id),
  );
  emit();
}

// ---------- Guardado ----------
export type NovoGuardadoInput = {
  bancoId: string;
  valor: number;
  tipoReserva: TipoReserva;
  observacao?: string;
};

export function addGuardado(input: NovoGuardadoInput): Guardado {
  const now = new Date().toISOString();
  const novo: Guardado = {
    id: uid(),
    bancoId: input.bancoId,
    valor: input.valor,
    tipoReserva: input.tipoReserva,
    observacao: input.observacao,
    dataAtualizacao: now.slice(0, 10),
    criadoEm: now,
    atualizadoEm: now,
  };
  writeJSON(K.guardado, [...getGuardado(), novo]);
  emit();
  return novo;
}

export function updateGuardado(id: string, patch: Partial<Guardado>) {
  const now = new Date().toISOString();
  const list = getGuardado().map((g) =>
    g.id === id
      ? { ...g, ...patch, atualizadoEm: now, dataAtualizacao: now.slice(0, 10) }
      : g,
  );
  writeJSON(K.guardado, list);
  emit();
}

export function deleteGuardado(id: string) {
  writeJSON(
    K.guardado,
    getGuardado().filter((g) => g.id !== id),
  );
  emit();
}

// ---------- Metas ----------
export type NovaMetaInput = {
  nome: string;
  valorObjetivo: number;
  valorAtual?: number;
  prazo?: string;
  descricao?: string;
  colorHex: string;
  bancoId?: string;
};

export function addMeta(input: NovaMetaInput): Meta {
  const now = new Date().toISOString();
  const novo: Meta = {
    id: uid(),
    nome: input.nome.trim(),
    valorObjetivo: input.valorObjetivo,
    valorAtual: input.valorAtual ?? 0,
    prazo: input.prazo,
    descricao: input.descricao,
    colorHex: input.colorHex,
    bancoId: input.bancoId,
    criadoEm: now,
    atualizadoEm: now,
  };
  writeJSON(K.metas, [...getMetas(), novo]);
  emit();
  return novo;
}

export function updateMeta(id: string, patch: Partial<Meta>) {
  const list = getMetas().map((m) =>
    m.id === id ? { ...m, ...patch, atualizadoEm: new Date().toISOString() } : m,
  );
  writeJSON(K.metas, list);
  emit();
}

export function deleteMeta(id: string) {
  writeJSON(
    K.metas,
    getMetas().filter((m) => m.id !== id),
  );
  writeJSON(
    K.movMetas,
    getMovimentacoesMeta().filter((mv) => mv.metaId !== id),
  );
  emit();
}

export function addMovimentacaoMeta(input: {
  metaId: string;
  valor: number;
  bancoId?: string;
  observacao?: string;
}) {
  const now = new Date().toISOString();
  const meta = getMetas().find((m) => m.id === input.metaId);
  if (!meta) return;
  const mov: MovimentacaoMeta = {
    id: uid(),
    metaId: input.metaId,
    valor: input.valor,
    data: now.slice(0, 10),
    bancoId: input.bancoId,
    observacao: input.observacao,
    criadoEm: now,
  };
  writeJSON(K.movMetas, [...getMovimentacoesMeta(), mov]);
  // atualizar valorAtual da meta
  updateMeta(input.metaId, { valorAtual: meta.valorAtual + input.valor });
  // emit já chamado dentro de updateMeta
}

// ---------- Helpers para metas ----------
export function statusMeta(meta: Meta): StatusMeta {
  const pct = meta.valorObjetivo > 0 ? (meta.valorAtual / meta.valorObjetivo) * 100 : 0;
  if (pct >= 100) return "concluida";
  if (pct >= 80) return "quase";
  if (pct > 0) return "em_andamento";
  return "nao_iniciada";
}

// ---------- React hooks ----------
export function useStore<T>(selector: () => T): T {
  return useSyncExternalStore(subscribe, selector, selector);
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
