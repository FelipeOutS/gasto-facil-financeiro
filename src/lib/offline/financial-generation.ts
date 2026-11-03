/** Cache is a UX hint only. The candidate database trigger is the authority. */
export function cachedFinancialGeneration(ownerId: string): number | null {
  try {
    const raw = localStorage.getItem(`gi:financial:generation:${ownerId}`);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
}
export function rememberFinancialGeneration(ownerId: string, generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("invalid_generation");
  try {
    const previous = cachedFinancialGeneration(ownerId);
    if (previous !== null && generation < previous) return;
    localStorage.setItem(`gi:financial:generation:${ownerId}`, String(generation));
    if (previous !== null && previous !== generation) localStorage.removeItem(`gi:offline:snapshot:${ownerId}`);
  } catch { /* No storage: queued items remain unversioned and fail closed after reset. */ }
}