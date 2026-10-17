import { NAV_GROUPS, type NavGroup } from "./nav-groups";

export const DESKTOP_AREAS = [
  { id: "overview", label: "Visão Geral", groups: [] as string[] },
  { id: "activity", label: "Atividades", groups: ["financeiro"] },
  { id: "management", label: "Gestão", groups: ["empresa", "conexoes", "conta", "admin"] },
  { id: "planning", label: "Planejamento", groups: ["planejamento"] },
  { id: "reports", label: "Relatórios", groups: ["insights"] },
] as const;

export function desktopAreaForPath(path: string) {
  if (path === "/conta" || path === "/perfil") return DESKTOP_AREAS[2];
  const group = NAV_GROUPS.find((group) =>
    group.items.some((item) => path === item.to || path.startsWith(item.to + "/")),
  );
  return (
    DESKTOP_AREAS.find((area) => area.groups.some((id) => id === group?.id)) ?? DESKTOP_AREAS[0]
  );
}

export function desktopAreaDestination(area: (typeof DESKTOP_AREAS)[number], visible: NavGroup[]) {
  if (area.id === "overview") return "/app";
  if (area.id === "management") return "/conta";
  return area.groups.flatMap((id) => visible.find((group) => group.id === id)?.items ?? [])[0]?.to;
}
