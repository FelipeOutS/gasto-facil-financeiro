import { describe, it, expect } from "vitest";
import { 
  generateOpaqueExternalReference, 
  verifyOpaqueExternalReference,
  checkoutRefSecret,
  CHECKOUT_REF_PREFIX
} from "../src/server/mercadopago-checkout-session.server";

describe("Mercado Pago Checkout Session - Opaque Reference", () => {
  const mockSecret = "test-webhook-secret-long-enough-for-hmac";

  it("should generate a valid opaque reference", () => {
    const ref = generateOpaqueExternalReference(mockSecret);
    expect(ref.startsWith(CHECKOUT_REF_PREFIX + ".")).toBe(true);
    const parts = ref.split(".");
    expect(parts.length).toBe(3);
  });

  it("should verify a valid reference", () => {
    const ref = generateOpaqueExternalReference(mockSecret);
    expect(verifyOpaqueExternalReference(ref, mockSecret)).toBe(true);
  });

  it("should reject an invalid reference format", () => {
    expect(verifyOpaqueExternalReference("invalid", mockSecret)).toBe(false);
    expect(verifyOpaqueExternalReference("gi1.short.sig", mockSecret)).toBe(false);
  });

  it("should reject a reference with a modified random part", () => {
    const ref = generateOpaqueExternalReference(mockSecret);
    const parts = ref.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("a") ? "b" : "a");
    const tampered = parts.join(".");
    expect(verifyOpaqueExternalReference(tampered, mockSecret)).toBe(false);
  });

  it("should reject a reference with a wrong secret", () => {
    const ref = generateOpaqueExternalReference(mockSecret);
    expect(verifyOpaqueExternalReference(ref, "wrong-secret")).toBe(false);
  });
});
