export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

export function formatBRLCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(value);
  }
  return formatBRL(value);
}

export function parseBRLInput(input: string): number {
  if (!input) return 0;
  const cleaned = input
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatDateBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ymOf(iso: string): { year: number; month: number } {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
