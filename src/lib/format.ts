import i18n from "@/i18n";

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

/**
 * Parse a date value (string in many formats, or Date) into a Date
 * normalized to the start of the LOCAL day. Returns null if invalid.
 * Accepts: "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", "DD/MM/YY",
 * Date object, or ISO string with time.
 */
export function parseDateLocal(value: string | Date | null | undefined): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (optionally with time)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = +isoMatch[1],
      m = +isoMatch[2],
      d = +isoMatch[3];
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const r = new Date(y, m - 1, d);
    if (r.getFullYear() !== y || r.getMonth() !== m - 1 || r.getDate() !== d) return null;
    return r;
  }

  // DD/MM/YYYY or DD-MM-YYYY (or 2-digit year)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let y = +dmy[3];
    const d = +dmy[1],
      m = +dmy[2];
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const r = new Date(y, m - 1, d);
    if (r.getFullYear() !== y || r.getMonth() !== m - 1 || r.getDate() !== d) return null;
    return r;
  }

  // Fallback: let JS parse, then normalize to local day
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  return null;
}

/** Convert a Date to local YYYY-MM-DD (no timezone shift). */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentDateLocale(): string {
  try {
    const lng = i18n?.language;
    if (lng && lng.toLowerCase().startsWith("en")) return "en-US";
  } catch {
    /* noop */
  }
  return "pt-BR";
}

export function formatDateBR(iso: string | Date): string {
  const d = parseDateLocal(iso);
  if (!d) return "";
  return d.toLocaleDateString(currentDateLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString(currentDateLocale(), { month: "long", year: "numeric" });
}

export function todayISO(): string {
  return toLocalISODate(new Date());
}

export function ymOf(iso: string): { year: number; month: number } {
  const d = parseDateLocal(iso) ?? new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
