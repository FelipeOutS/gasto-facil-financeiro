import { expect, test, describe } from "bun:test";
import { SECURITY_HEADERS } from "../../src/server/security-headers.server";

describe("Segurança: Cabeçalhos HTTP (P1-01)", () => {
  test("CSP Report-Only deve estar definida", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("X-Frame-Options deve ser DENY para proteção efetiva clickjacking", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  test("Headers de produção obrigatórios devem estar presentes", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBeDefined();
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
