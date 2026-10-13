import { test, expect } from "bun:test";
import { buildInteractiveFromReply, replyIdToTexto } from "../src/server/whatsapp-interactive.server";
import { formatOffers } from "../src/server/shopping/shopping-assistant";
import { detectShoppingFollowup } from "../src/server/shopping/shopping-followup";

const longo = "https://www.google.com/search?ibp=oshop&q=" + "x".repeat(400);
const of = (p: number, t: string, s: string) => ({ priceCents: p, title: t, store: s, link: longo }) as any;
const offers = [
  of(780218, "Apple MacBook Air 13\" M4 16GB SSD 256GB", "Next Computer"),
  of(949000, "Apple MacBook Air 15\" M4 16GB SSD 512GB", "B&W Store"),
  of(1119900, "MacBook Air M4 16GB", "Mercado Livre"),
];
const at = "2026-10-13T03:00:00Z";

test("compras com 3 ofertas → botões shopping_link_1..3, nunca opt_", () => {
  const ir = buildInteractiveFromReply(formatOffers("macbook air m4 16gb", offers, at))!;
  expect(ir.type).toBe("button");
  const ids = (ir as any).buttons.map((b: any) => b.id);
  expect(ids).toEqual(["shopping_link_1", "shopping_link_2", "shopping_link_3"]);
  expect(JSON.stringify(ir)).not.toContain("opt_");
});

test("1 e 2 ofertas", () => {
  for (const k of [1, 2]) {
    const ir: any = buildInteractiveFromReply(formatOffers("macbook", offers.slice(0, k), at));
    expect(ir.buttons.map((b: any) => b.id)).toEqual(Array.from({ length: k }, (_, i) => `shopping_link_${i + 1}`));
  }
});

test("texto de compras malformado → só texto (null)", () => {
  expect(buildInteractiveFromReply("🛍️ *X*\n\n1. Algo\n2. Outro\n🔗 Para abrir, responda *link 1*")).toBeNull();
  expect(buildInteractiveFromReply("🛍️ *X*\n*1. R$ 10,00* — A\n*3. R$ 20,00* — B\n🔗 Para abrir, responda *link 1*")).toBeNull();
});

test("replyIdToTexto: shopping_link_N → 'link N' e follow-up de link", () => {
  for (const n of [1, 2, 3]) {
    const t = replyIdToTexto(`shopping_link_${n}`);
    expect(t).toBe(`link ${n}`);
    expect(detectShoppingFollowup(t)).toEqual({ kind: "link", index: n - 1 });
  }
  expect(replyIdToTexto("shopping_link_4", "x")).toBe("x");
});

test("opt_1 genérico preservado", () => {
  expect(replyIdToTexto("opt_1")).toBe("1");
});
