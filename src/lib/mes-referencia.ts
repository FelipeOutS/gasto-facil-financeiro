// Helpers compartilhados para o campo "Mês de referência" (YYYY-MM).
// Locale-aware: usa Intl com o idioma ativo do i18n (pt-BR ou en).

import i18n from "@/i18n";

const NOMES_MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const NOMES_MESES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isEn(): boolean {
  try {
    return (i18n?.language ?? "pt").toLowerCase().startsWith("en");
  } catch {
    return false;
  }
}

function monthName(monthIdx0: number): string {
  return isEn() ? NOMES_MESES_EN[monthIdx0] : NOMES_MESES_PT[monthIdx0];
}

function formatMesAno(monthIdx0: number, ano: number): string {
  return isEn() ? `${monthName(monthIdx0)} ${ano}` : `${monthName(monthIdx0)} de ${ano}`;
}

export function ymToLabel(ym: string | undefined | null): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return "";
  const [y, m] = ym.split("-").map(Number);
  if (!m || m < 1 || m > 12) return "";
  return formatMesAno(m - 1, y);
}

export function mesAnoToLabel(mes: number, ano: number): string {
  if (!mes || mes < 1 || mes > 12) return "";
  return formatMesAno(mes - 1, ano);
}

export function ymFromDate(iso?: string): string {
  if (!iso) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // iso pode ser YYYY-MM-DD
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Gera uma lista de opções de mês de referência centradas no mês "base".
 * Por padrão: 12 meses para trás, mês atual e 6 para frente.
 */
export function mesReferenciaOpcoes(
  base?: string,
  back = 12,
  forward = 6,
): Array<{ value: string; label: string }> {
  const baseYm = ymFromDate(base);
  const [by, bm] = baseYm.split("-").map(Number);
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = -back; i <= forward; i++) {
    const d = new Date(by, bm - 1 + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    opts.push({ value: ym, label: formatMesAno(m - 1, y) });
  }
  return opts;
}
