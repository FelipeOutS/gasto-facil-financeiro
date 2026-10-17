import type { NavGroup } from "./nav-groups";

// Direct shortcuts: labels always describe their destination, never the first allowed module.
export const DESKTOP_AREAS = [
  { id: "overview", label: "Visão geral", to: "/app" },
  { id: "activity", label: "Gastos", to: "/gastos" },
  { id: "cards", label: "Cartões", to: "/cartoes" },
  { id: "goals", label: "Metas", to: "/metas" },
  { id: "reports", label: "Relatórios", to: "/relatorios" },
] as const;

export function desktopAreaForPath(path: string) {
  return DESKTOP_AREAS.find(
    (area) => path === area.to || (area.id !== "overview" && path.startsWith(area.to + "/")),
  );
}

export function desktopAreaDestination(area: (typeof DESKTOP_AREAS)[number], visible: NavGroup[]) {
  if (area.id === "overview") return area.to;
  return visible.some((group) => group.items.some((item) => item.to === area.to))
    ? area.to
    : undefined;
}
