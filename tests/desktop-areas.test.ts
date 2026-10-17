import { describe, expect, it } from "bun:test";
import {
  DESKTOP_AREAS,
  desktopAreaDestination,
  desktopAreaForPath,
} from "../src/lib/desktop-areas";
import { NAV_GROUPS, filterVisibleGroups } from "../src/lib/nav-groups";
import { planAllowsFeature } from "../src/lib/plans";
describe("desktop navigation areas", () => {
  it("maps every existing module, including nested pages, to its area", () => {
    for (const group of NAV_GROUPS)
      for (const item of group.items) {
        const area = desktopAreaForPath(item.to + "/detalhe");
        expect(area.groups.some((id) => id === group.id)).toBe(true);
      }
  });
  it("keeps profile in management and dashboard in overview", () => {
    expect(desktopAreaForPath("/conta").id).toBe("management");
    expect(desktopAreaForPath("/app").id).toBe("overview");
  });
  it("only chooses destinations available to each real plan", () => {
    for (const plan of ["pessoal_manual", "pessoal_premium", "empresarial"] as const) {
      const visible = filterVisibleGroups(
        NAV_GROUPS.filter((g) => !g.adminMasterOnly),
        (f) => planAllowsFeature(plan, f),
        false,
        "pessoa_fisica",
      );
      for (const area of DESKTOP_AREAS) {
        const to = desktopAreaDestination(area, visible);
        if (to && to !== "/app" && to !== "/conta")
          expect(visible.some((g) => g.items.some((i) => i.to === to))).toBe(true);
      }
    }
  });
  it("does not expose premium destinations when no features are available", () => {
    const visible = filterVisibleGroups(
      NAV_GROUPS.filter((g) => !g.adminMasterOnly),
      () => false,
      false,
      "pessoa_fisica",
    );
    expect(desktopAreaDestination(DESKTOP_AREAS[3], visible)).toBe("/bens");
    expect(desktopAreaDestination(DESKTOP_AREAS[4], visible)).toBe("/alertas");
  });
});
