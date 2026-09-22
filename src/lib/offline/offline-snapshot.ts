import type { Categoria, Gasto } from "../types";
import { isValidOfflineDate } from "./offline-validation";
export type OfflineSnapshot = {
  savedAt: number;
  categories: Pick<Categoria, "id" | "nome">[];
  expenses: Pick<Gasto, "id" | "descricao" | "valor" | "data">[];
};
export function saveOfflineSnapshot(
  userId: string,
  categories: Categoria[],
  expenses: Gasto[],
): void {
  if (typeof window === "undefined") return;
  try {
    const value: OfflineSnapshot = {
      savedAt: Date.now(),
      categories: categories.map(({ id, nome }) => ({ id, nome })),
      expenses: [...expenses]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 150)
        .map(({ id, descricao, valor, data }) => ({ id, descricao, valor, data })),
    };
    localStorage.setItem(`gi:offline:snapshot:${userId}`, JSON.stringify(value));
  } catch {
    /* Snapshot is optional; it must never prevent saving a queued expense. */
  }
}
export function readOfflineSnapshot(userId: string): OfflineSnapshot | null {
  try {
    const raw = localStorage.getItem(`gi:offline:snapshot:${userId}`);
    const value = raw ? JSON.parse(raw) : null;
    if (
      !value ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt <= 0 ||
      !Array.isArray(value.categories) ||
      !Array.isArray(value.expenses)
    )
      return null;
    if (
      !value.categories.every(
        (item: OfflineSnapshot["categories"][number]) =>
          item && typeof item.id === "string" && typeof item.nome === "string",
      ) ||
      !value.expenses.every(
        (item: OfflineSnapshot["expenses"][number]) =>
          item &&
          typeof item.id === "string" &&
          typeof item.descricao === "string" &&
          typeof item.valor === "number" &&
          Number.isFinite(item.valor) &&
          isValidOfflineDate(item.data),
      )
    )
      return null;
    return {
      savedAt: value.savedAt,
      categories: value.categories,
      expenses: value.expenses.slice(0, 150),
    };
  } catch {
    return null;
  }
}
