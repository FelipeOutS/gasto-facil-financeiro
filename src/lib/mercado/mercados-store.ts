/**
 * Mercado Inteligente — E18
 * Cadastro LOCAL de mercados do usuário.
 *
 * 100% localStorage. Sem Supabase, sem rede, sem API externa.
 * Isolado dos demais stores do Mercado (listas, preços).
 *
 * SSR-safe via useSyncExternalStore + snapshot cacheado por serialização
 * (mesmo padrão de `precos-history.ts`).
 */

import { useEffect, useState, useSyncExternalStore } from "react";

export const MERCADOS_LOCAIS_STORAGE_KEY = "gi:mercado:mercados:v1";

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

function normalize(raw: unknown): MercadoLocal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nome = cleanStr(r.nome);
  if (!nome) return null;
  const id =
    typeof r.id === "string" && r.id.trim() ? r.id : newId();
  const criadoEm =
    typeof r.criadoEm === "string" && r.criadoEm ? r.criadoEm : nowIso();
  const atualizadoEm =
    typeof r.atualizadoEm === "string" && r.atualizadoEm ? r.atualizadoEm : criadoEm;
  return {
    id,
    nome,
    endereco: cleanStr(r.endereco),
    bairro: cleanStr(r.bairro),
    cidade: cleanStr(r.cidade),
    observacao: cleanStr(r.observacao),
    favorito: Boolean(r.favorito),
    criadoEm,
    atualizadoEm,
  };
}

function safeRead(): MercadoLocal[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MERCADOS_LOCAIS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MercadoLocal[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const n = normalize(item);
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
    window.localStorage.setItem(MERCADOS_LOCAIS_STORAGE_KEY, JSON.stringify(next));
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
      if (e.key === MERCADOS_LOCAIS_STORAGE_KEY) listener();
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
    endereco: cleanStr(input.endereco),
    bairro: cleanStr(input.bairro),
    cidade: cleanStr(input.cidade),
    observacao: cleanStr(input.observacao),
    favorito: Boolean(input.favorito),
    criadoEm: now,
    atualizadoEm: now,
  };
  safeWrite([novo, ...atuais]);
  emit();
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
    endereco:
      input.endereco !== undefined ? cleanStr(input.endereco) : prev.endereco,
    bairro: input.bairro !== undefined ? cleanStr(input.bairro) : prev.bairro,
    cidade: input.cidade !== undefined ? cleanStr(input.cidade) : prev.cidade,
    observacao:
      input.observacao !== undefined ? cleanStr(input.observacao) : prev.observacao,
    favorito: input.favorito !== undefined ? Boolean(input.favorito) : prev.favorito,
    atualizadoEm: nowIso(),
  };
  const copy = atuais.slice();
  copy[idx] = next;
  safeWrite(copy);
  emit();
  return next;
}

export function removeMercadoLocal(id: string): boolean {
  if (!id) return false;
  const atuais = safeRead();
  const next = atuais.filter((m) => m.id !== id);
  if (next.length === atuais.length) return false;
  safeWrite(next);
  emit();
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
