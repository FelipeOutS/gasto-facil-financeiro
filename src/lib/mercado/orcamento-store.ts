// Local-only store for the Mercado Inteligente monthly budget.
// Isolated from listas-store; persists to localStorage under its own key.
// NO Supabase, NO API. Reads historico from listas-store for the monthly summary.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useMercadoHistorico,
  type MercadoCompraHistorico,
} from "./listas-store";

export const MERCADO_ORCAMENTO_STORAGE_KEY = "gi:mercado:orcamento:v1";

export type MercadoOrcamento = {
  valorMensal: number;
  /** YYYY-MM (mês de referência configurado pelo usuário). */
  mesReferencia: string;
  atualizadoEm: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function currentMonthKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function normalize(raw: unknown): MercadoOrcamento | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const valor = typeof r.valorMensal === "number" && Number.isFinite(r.valorMensal)
    ? Math.max(0, r.valorMensal)
    : 0;
  const mes = typeof r.mesReferencia === "string" && /^\d{4}-\d{2}$/.test(r.mesReferencia)
    ? r.mesReferencia
    : currentMonthKey();
  const upd = typeof r.atualizadoEm === "string" ? r.atualizadoEm : new Date().toISOString();
  return { valorMensal: valor, mesReferencia: mes, atualizadoEm: upd };
}

function safeRead(): MercadoOrcamento | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(MERCADO_ORCAMENTO_STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function safeWrite(next: MercadoOrcamento) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MERCADO_ORCAMENTO_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

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

export function getOrcamentoMercado(): MercadoOrcamento {
  return (
    safeRead() ?? {
      valorMensal: 0,
      mesReferencia: currentMonthKey(),
      atualizadoEm: new Date().toISOString(),
    }
  );
}

export function setOrcamentoMercado(input: {
  valorMensal: number;
  mesReferencia?: string;
}): MercadoOrcamento {
  const next: MercadoOrcamento = {
    valorMensal:
      Number.isFinite(input.valorMensal) && input.valorMensal > 0
        ? Number(input.valorMensal)
        : 0,
    mesReferencia:
      input.mesReferencia && /^\d{4}-\d{2}$/.test(input.mesReferencia)
        ? input.mesReferencia
        : currentMonthKey(),
    atualizadoEm: new Date().toISOString(),
  };
  safeWrite(next);
  emit();
  return next;
}

export type MercadoBudgetStatus = "sem_orcamento" | "dentro" | "atencao" | "excedido";

export type ResumoOrcamentoMercado = {
  orcamento: number;
  mesReferencia: string;
  hasBudget: boolean;
  gastoMes: number;
  saldoRestante: number;
  percentualUsado: number; // 0..N
  status: MercadoBudgetStatus;
  comprasDoMes: MercadoCompraHistorico[];
};

function isInMonth(iso: string, monthKey: string): boolean {
  // iso = "2026-05-12T..."; monthKey = "2026-05"
  return typeof iso === "string" && iso.startsWith(monthKey + "-");
}

export function getResumoOrcamentoMercado(
  historico: MercadoCompraHistorico[],
  orcamento?: MercadoOrcamento,
): ResumoOrcamentoMercado {
  const orc = orcamento ?? getOrcamentoMercado();
  const monthKey = orc.mesReferencia || currentMonthKey();
  const comprasDoMes = historico.filter((h) => isInMonth(h.concluidaEm, monthKey));
  const gastoMes = comprasDoMes.reduce((a, h) => a + (h.totalEstimado || 0), 0);
  const hasBudget = orc.valorMensal > 0;
  const saldoRestante = hasBudget ? orc.valorMensal - gastoMes : 0;
  const percentualUsado = hasBudget ? Math.round((gastoMes / orc.valorMensal) * 100) : 0;
  let status: MercadoBudgetStatus = "sem_orcamento";
  if (hasBudget) {
    if (percentualUsado > 100) status = "excedido";
    else if (percentualUsado > 80) status = "atencao";
    else status = "dentro";
  }
  return {
    orcamento: hasBudget ? orc.valorMensal : 0,
    mesReferencia: monthKey,
    hasBudget,
    gastoMes,
    saldoRestante,
    percentualUsado,
    status,
    comprasDoMes,
  };
}

// --- React hooks ---------------------------------------------------------

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser()) {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MERCADO_ORCAMENTO_STORAGE_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(listener);
}

let cached: MercadoOrcamento | null = null;
let cachedSerialized = "";

function getSnapshot(): MercadoOrcamento {
  const fresh = getOrcamentoMercado();
  const s = JSON.stringify(fresh);
  if (s !== cachedSerialized) {
    cachedSerialized = s;
    cached = fresh;
  }
  return cached!;
}

function getServerSnapshot(): MercadoOrcamento {
  return {
    valorMensal: 0,
    mesReferencia: currentMonthKey(),
    atualizadoEm: new Date(0).toISOString(),
  };
}

export function useMercadoOrcamento(): MercadoOrcamento {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted
    ? data
    : {
        valorMensal: 0,
        mesReferencia: currentMonthKey(),
        atualizadoEm: new Date(0).toISOString(),
      };
}

export function useResumoOrcamentoMercado(): ResumoOrcamentoMercado {
  const historico = useMercadoHistorico();
  const orc = useMercadoOrcamento();
  return getResumoOrcamentoMercado(historico, orc);
}

export function getCurrentMonthKey(): string {
  return currentMonthKey();
}
