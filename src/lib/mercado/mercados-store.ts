/**
 * Mercado Inteligente — E18 + E35/Parte 3
 * Cadastro local de mercados do usuário, agora com sincronização opcional
 * via Supabase (mesmo padrão das outras stores de Mercado).
 *
 * Local-first: continua funcionando 100% offline / sem login. Quando há
 * usuário ativo, mercado-sync.ts injeta hooks de push e troca a chave de
 * localStorage para uma versão por usuário.
 *
 * SSR-safe via useSyncExternalStore + snapshot cacheado por serialização.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

// Chave legada (anônima, pré-sync) — preservada apenas para migração
// one-shot por usuário no primeiro login.
export const MERCADOS_LOCAIS_STORAGE_KEY = "gi:mercado:mercados:v1";
export const MERCADO_MERCADOS_LEGACY_ANON_KEY = MERCADOS_LOCAIS_STORAGE_KEY;

export type MercadoLocal = {
  id: string;
  nome: string;
  cep?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  observacao?: string;
  favorito?: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

export type MercadoLocalInput = {
  nome: string;
  cep?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  observacao?: string;
  favorito?: boolean;
};

// ---------- utils ---------------------------------------------------------

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `mkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

function cleanCep(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const digits = v.replace(/\D/g, "").slice(0, 8);
  return digits ? digits : undefined;
}

function cleanUf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase();
  return t ? t : undefined;
}

export function normalizeMercadoLocal(raw: unknown): MercadoLocal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nome = cleanStr(r.nome);
  if (!nome) return null;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : newId();
  const criadoEm = typeof r.criadoEm === "string" && r.criadoEm ? r.criadoEm : nowIso();
  const atualizadoEm =
    typeof r.atualizadoEm === "string" && r.atualizadoEm ? r.atualizadoEm : criadoEm;
  return {
    id,
    nome,
    cep: cleanCep(r.cep),
    endereco: cleanStr(r.endereco),
    bairro: cleanStr(r.bairro),
    cidade: cleanStr(r.cidade),
    uf: cleanUf(r.uf),
    observacao: cleanStr(r.observacao),
    favorito: Boolean(r.favorito),
    criadoEm,
    atualizadoEm,
  };
}

// ---------- sync wiring (preenchido por mercado-sync.ts) -----------------

let mercadosActiveUserId: string | null = null;

function currentMercadosKey(): string {
  return mercadosActiveUserId
    ? `${MERCADOS_LOCAIS_STORAGE_KEY}:${mercadosActiveUserId}`
    : MERCADOS_LOCAIS_STORAGE_KEY;
}

type MercadosSyncHooks = {
  onUpsertMercado?: (m: MercadoLocal) => void;
  onDeleteMercado?: (id: string) => void;
};
let mercadosSyncHooks: MercadosSyncHooks = {};

export function __setMercadoMercadosSyncHooks(hooks: MercadosSyncHooks) {
  mercadosSyncHooks = hooks;
}

export function __setMercadoMercadosActiveUser(uid: string | null) {
  if (mercadosActiveUserId === uid) return;
  mercadosActiveUserId = uid;
  emit();
}

export function __getMercadoMercadosActiveUserId(): string | null {
  return mercadosActiveUserId;
}

export function __replaceMercadosCache(items: MercadoLocal[]) {
  safeWrite(items);
  emit();
}

// ---------- storage I/O --------------------------------------------------

function safeRead(): MercadoLocal[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(currentMercadosKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MercadoLocal[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const n = normalizeMercadoLocal(item);
      if (!n) continue;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

function safeWrite(next: MercadoLocal[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(currentMercadosKey(), JSON.stringify(next));
  } catch {
    // ignore quota / privacy errors
  }
}

// ---------- listeners ----------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === MERCADOS_LOCAIS_STORAGE_KEY ||
        (e.key &&
          mercadosActiveUserId &&
          e.key === `${MERCADOS_LOCAIS_STORAGE_KEY}:${mercadosActiveUserId}`)
      ) {
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(listener);
}

// ---------- sort estável -------------------------------------------------

function sortMercados(arr: MercadoLocal[]): MercadoLocal[] {
  return [...arr].sort((a, b) => {
    const fa = a.favorito ? 1 : 0;
    const fb = b.favorito ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  });
}

// ---------- push helpers -------------------------------------------------

function pushUpsert(m: MercadoLocal) {
  if (!mercadosSyncHooks.onUpsertMercado) return;
  try {
    mercadosSyncHooks.onUpsertMercado(m);
  } catch {
    /* ignore */
  }
}

function pushDelete(id: string) {
  if (!mercadosSyncHooks.onDeleteMercado) return;
  try {
    mercadosSyncHooks.onDeleteMercado(id);
  } catch {
    /* ignore */
  }
}

// ---------- API pública --------------------------------------------------

export function getMercadosLocais(): MercadoLocal[] {
  return sortMercados(safeRead());
}

export function getMercadoLocalById(id: string): MercadoLocal | null {
  if (!id) return null;
  return safeRead().find((m) => m.id === id) ?? null;
}

export function addMercadoLocal(input: MercadoLocalInput): MercadoLocal | null {
  const nome = cleanStr(input?.nome);
  if (!nome) return null;
  const atuais = safeRead();
  const now = nowIso();
  const novo: MercadoLocal = {
    id: newId(),
    nome,
    cep: cleanCep(input.cep),
    endereco: cleanStr(input.endereco),
    bairro: cleanStr(input.bairro),
    cidade: cleanStr(input.cidade),
    uf: cleanUf(input.uf),
    observacao: cleanStr(input.observacao),
    favorito: Boolean(input.favorito),
    criadoEm: now,
    atualizadoEm: now,
  };
  safeWrite([novo, ...atuais]);
  emit();
  pushUpsert(novo);
  return novo;
}

export function updateMercadoLocal(
  id: string,
  input: Partial<MercadoLocalInput>,
): MercadoLocal | null {
  if (!id) return null;
  const atuais = safeRead();
  const idx = atuais.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const prev = atuais[idx];
  const nome = input.nome !== undefined ? cleanStr(input.nome) : prev.nome;
  if (!nome) return null;
  const next: MercadoLocal = {
    ...prev,
    nome,
    cep: input.cep !== undefined ? cleanCep(input.cep) : prev.cep,
    endereco: input.endereco !== undefined ? cleanStr(input.endereco) : prev.endereco,
    bairro: input.bairro !== undefined ? cleanStr(input.bairro) : prev.bairro,
    cidade: input.cidade !== undefined ? cleanStr(input.cidade) : prev.cidade,
    uf: input.uf !== undefined ? cleanUf(input.uf) : prev.uf,
    observacao: input.observacao !== undefined ? cleanStr(input.observacao) : prev.observacao,
    favorito: input.favorito !== undefined ? Boolean(input.favorito) : prev.favorito,
    atualizadoEm: nowIso(),
  };
  const copy = atuais.slice();
  copy[idx] = next;
  safeWrite(copy);
  emit();
  pushUpsert(next);
  return next;
}

export function removeMercadoLocal(id: string): boolean {
  if (!id) return false;
  const atuais = safeRead();
  const next = atuais.filter((m) => m.id !== id);
  if (next.length === atuais.length) return false;
  safeWrite(next);
  emit();
  pushDelete(id);
  return true;
}

export function toggleMercadoFavorito(id: string): MercadoLocal | null {
  const m = getMercadoLocalById(id);
  if (!m) return null;
  return updateMercadoLocal(id, { favorito: !m.favorito });
}

// ---------- hook (SSR-safe, snapshot cacheado) ---------------------------

let cached: MercadoLocal[] = [];
let cachedSerialized = "[]";

function getSnapshot(): MercadoLocal[] {
  const fresh = getMercadosLocais();
  const serialized = JSON.stringify(fresh);
  if (serialized !== cachedSerialized) {
    cachedSerialized = serialized;
    cached = fresh;
  }
  return cached;
}

function getServerSnapshot(): MercadoLocal[] {
  return [];
}

export function useMercadosLocais(): MercadoLocal[] {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? data : [];
}
