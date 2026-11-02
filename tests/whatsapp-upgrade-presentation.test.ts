import { expect, test } from "bun:test";
import { getLockedNavItems } from "../src/lib/nav-groups";
import { planAllowsFeature } from "../src/lib/plans";

const groups = [{ id: "conexoes", labelKey: "groups.conexoes", items: [{
  to: "/whatsapp", labelKey: "whatsapp", feature: "whatsapp" as const,
  icon: (() => null) as unknown as typeof import("lucide-react").MessageCircle,
}] }];

test("WhatsApp é apresentado como upgrade no gratuito sem conceder acesso", () => {
  expect(planAllowsFeature("free_ads", "whatsapp")).toBe(false);
  expect(getLockedNavItems(groups, f => planAllowsFeature("free_ads", f), false).map(i => i.to)).toEqual(["/whatsapp"]);
});

test("WhatsApp não é apresentado como bloqueado nos quatro planos pagos elegíveis", () => {
  for (const plan of ["pessoal_premium", "mei_essencial", "mei_inteligente", "empresa"] as const) {
    expect(planAllowsFeature(plan, "whatsapp")).toBe(true);
    expect(getLockedNavItems(groups, f => planAllowsFeature(plan, f), false)).toEqual([]);
  }
});