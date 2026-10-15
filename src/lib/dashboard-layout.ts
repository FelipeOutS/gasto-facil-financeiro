export const DASHBOARD_BLOCKS = [
  { id: "radar", label: "Fluxo de caixa e resumo" },
  { id: "economia", label: "Saúde financeira e economia" },
  { id: "categorias", label: "Categorias e cartões" },
  { id: "visao", label: "Transações, metas e calendário" },
  { id: "orcamento", label: "Resumo e limite inteligente" },
  { id: "controle", label: "Controle e planejamento" },
] as const;
export type DashboardBlockId = (typeof DASHBOARD_BLOCKS)[number]["id"];
export type DashboardLayout = { version: 1; order: DashboardBlockId[]; hidden: DashboardBlockId[] };
export const defaultDashboardLayout = (): DashboardLayout => ({ version: 1, order: DASHBOARD_BLOCKS.map(b => b.id), hidden: [] });
const known = (id: unknown): id is DashboardBlockId => DASHBOARD_BLOCKS.some(b => b.id === id);
export function normalizeDashboardLayout(value: unknown): DashboardLayout {
  if (!value || typeof value !== "object" || (value as DashboardLayout).version !== 1) return defaultDashboardLayout();
  const input = value as DashboardLayout;
  const order = Array.isArray(input.order) ? [...new Set(input.order.filter(known))] : [];
  return { version: 1, order: [...order, ...DASHBOARD_BLOCKS.map(b => b.id).filter(id => !order.includes(id))],
    hidden: Array.isArray(input.hidden) ? [...new Set(input.hidden.filter(known))] : [] };
}
export const dashboardLayoutKey = (userId: string) => `gi.dashboard.layout.v1:${userId}`;
export function readDashboardLayout(storage: Pick<Storage, "getItem">, userId: string): DashboardLayout {
  try { return normalizeDashboardLayout(JSON.parse(storage.getItem(dashboardLayoutKey(userId)) ?? "null")); }
  catch { return defaultDashboardLayout(); }
}
export function saveDashboardLayout(storage: Pick<Storage, "setItem">, userId: string, layout: DashboardLayout) {
  if (!userId) throw new Error("Usuário necessário");
  storage.setItem(dashboardLayoutKey(userId), JSON.stringify(normalizeDashboardLayout(layout)));
}
export function moveDashboardBlock(layout: DashboardLayout, id: DashboardBlockId, direction: -1 | 1): DashboardLayout {
  const order = [...layout.order];
  const index = order.indexOf(id), target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return layout;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}
