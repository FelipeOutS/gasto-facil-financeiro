// Helpers compartilhados para o campo "Mês de referência" (YYYY-MM).
// Mostra sempre como "Abril de 2026" no UI, salva como "2026-04" no banco.

const NOMES_MESES = [
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

export function ymToLabel(ym: string | undefined | null): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return "";
  const [y, m] = ym.split("-").map(Number);
  if (!m || m < 1 || m > 12) return "";
  return `${NOMES_MESES[m - 1]} de ${y}`;
}

export function mesAnoToLabel(mes: number, ano: number): string {
  if (!mes || mes < 1 || mes > 12) return "";
  return `${NOMES_MESES[mes - 1]} de ${ano}`;
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
    opts.push({ value: ym, label: `${NOMES_MESES[m - 1]} de ${y}` });
  }
  return opts;
}
