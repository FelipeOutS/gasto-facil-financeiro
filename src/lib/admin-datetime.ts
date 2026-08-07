/**
 * Formatação de data/hora administrativa.
 * Fonte canônica: auth.users.created_at (timestamp UTC).
 * Sempre exibido em America/Sao_Paulo, independente do timezone do navegador.
 */

const TZ = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** "07/08/2026" ou "—" */
export function formatAdminDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? dateFmt.format(d) : "—";
}

/** "01:48" ou "" */
export function formatAdminTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? timeFmt.format(d) : "";
}

/** "07/08/2026 às 01:48" ou "—" */
export function formatAdminDateTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return `${dateFmt.format(d)} às ${timeFmt.format(d)}`;
}

/** Tooltip administrativo com o timestamp original (sem dados sensíveis). */
export function adminDateTimeTooltip(iso: string | null | undefined, label = "Cadastro"): string {
  const d = toDate(iso);
  if (!d) return `${label}: —`;
  return `${label}: ${formatAdminDateTime(iso)}\nTimestamp original: ${d.toISOString()}`;
}

/** Ordena do mais recente para o mais antigo usando o timestamp real. */
export function compareCreatedAtDesc(
  a: { created_at: string | null },
  b: { created_at: string | null },
): number {
  const ta = toDate(a.created_at)?.getTime() ?? -Infinity;
  const tb = toDate(b.created_at)?.getTime() ?? -Infinity;
  return tb - ta;
}
