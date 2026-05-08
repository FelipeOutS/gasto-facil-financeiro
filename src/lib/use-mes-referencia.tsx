/**
 * Hook global para o filtro "Mês de referência" (competência).
 *
 * Reaproveita a MESMA chave de localStorage usada pela tela /gastos
 * para que a seleção fique sincronizada entre Dashboard, Cartões,
 * Contas a pagar, Relatórios, Calendário e SmartLimite.
 *
 * Valor: "todos" | "YYYY-MM"
 */
import { useCallback, useEffect, useState } from "react";
import { ymFromDate } from "@/lib/mes-referencia";

const STORAGE_KEY = "gf:gastos:selectedReferenceMonth:v1";
const EVENT = "gf:mes-referencia:changed";
export const MES_REF_ALL = "todos";

export function isValidMesRef(value: string | null | undefined): value is string {
  return value === MES_REF_ALL || /^\d{4}-\d{2}$/.test(value ?? "");
}

function readInitial(): string {
  if (typeof window === "undefined") return ymFromDate();
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isValidMesRef(v)) return v;
  } catch {
    /* noop */
  }
  return ymFromDate();
}

export function useMesReferenciaSelecionado() {
  const [value, setValueRaw] = useState<string>(() => readInitial());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !isValidMesRef(e.newValue)) return;
      setValueRaw(e.newValue);
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (isValidMesRef(detail)) setValueRaw(detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onCustom as EventListener);
    };
  }, []);

  const setValue = useCallback((v: string) => {
    if (!isValidMesRef(v)) return;
    setValueRaw(v);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, v);
        window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
      } catch {
        /* noop */
      }
    }
  }, []);

  return [value, setValue] as const;
}
