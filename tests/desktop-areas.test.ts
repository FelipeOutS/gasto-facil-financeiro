import { describe, expect, it } from "bun:test";
import {
  DESKTOP_AREAS,
  desktopAreaDestination,
  desktopAreaForPath,
} from "../src/lib/desktop-areas";
import { NAV_GROUPS, filterVisibleGroups } from "../src/lib/nav-groups";
import { planAllowsFeature } from "../src/lib/plans";
describe("desktop direct navigation", () => {
  it("uses the named destination without falling back to a different module", () => {
    expect(DESKTOP_AREAS.map((a) => [a.label, desktopAreaDestination(a, NAV_GROUPS)])).toEqual([
      ["Visão geral", "/app"],
      ["Gastos", "/gastos"],
      ["Cartões", "/cartoes"],
      ["Metas", "/metas"],
      ["Relatórios", "/relatorios"],
    ]);
  });
  it("does not mark overview or another shortcut active on account and other modules", () => {
    for (const path of [
      "/conta",
      "/perfil",
      "/app/ajustes",
      "/app/cofre-pessoal",
      "/empresa",
      "/renda",
      "/orcamento",
    ])
      expect(desktopAreaForPath(path)).toBeUndefined();
    expect(desktopAreaForPath("/app")?.id).toBe("overview");
    expect(desktopAreaForPath("/cartoes/abc")?.id).toBe("cards");
    expect(desktopAreaForPath("/metas/abc")?.id).toBe("goals");
  });
  it("respects visible destinations for each plan", () => {
    for (const plan of ["pessoal_manual", "pessoal_premium", "empresarial"] as const) {
      const visible = filterVisibleGroups(
        NAV_GROUPS.filter((g) => !g.adminMasterOnly),
        (f) => planAllowsFeature(plan, f),
        false,
        "pessoa_fisica",
      );
      for (const area of DESKTOP_AREAS) {
        const to = desktopAreaDestination(area, visible);
        if (to && to !== "/app")
          expect(visible.some((g) => g.items.some((i) => i.to === to))).toBe(true);
      }
    }
  });
  it("never redirects inaccessible cards or reports shortcuts to unrelated pages", () => {
    const visible = filterVisibleGroups(
      NAV_GROUPS.filter((g) => !g.adminMasterOnly),
      () => false,
      false,
      "pessoa_fisica",
    );
    expect(desktopAreaDestination(DESKTOP_AREAS[2], visible)).toBeUndefined();
    expect(desktopAreaDestination(DESKTOP_AREAS[4], visible)).toBeUndefined();
    expect(desktopAreaDestination(DESKTOP_AREAS[3], visible)).toBe("/metas");
  });
});
