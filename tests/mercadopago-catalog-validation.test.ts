import { describe, it, expect } from "vitest";
import { resolveCatalogOffer } from "../src/server/mercadopago-plan-catalog.server";

describe("Mercado Pago Plan Catalog - Server-Side Validation", () => {
  it("should resolve a valid plan and periodicity", () => {
    const result = resolveCatalogOffer({
      planKey: "pessoal_premium",
      periodicity: "anual",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.amountCents).toBe(48000); // 5000 * 12 * 0.8
      expect(result.offer.currency).toBe("BRL");
      expect(result.offer.months).toBe(12);
    }
  });

  it("should reject an invalid plan key", () => {
    const result = resolveCatalogOffer({
      planKey: "non_existent_plan",
      periodicity: "mensal",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_plan");
  });

  it("should reject an invalid periodicity", () => {
    const result = resolveCatalogOffer({
      planKey: "pessoal_premium",
      periodicity: "daily",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_period");
  });

  it("should reject a plan not allowed for new subscriptions", () => {
    const result = resolveCatalogOffer({
      planKey: "pessoal_manual", // allowNew: false
      periodicity: "mensal",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_unavailable");
  });
});
