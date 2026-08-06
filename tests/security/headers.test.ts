import { expect, test, describe } from "bun:test";
import { SECURITY_HEADERS } from "../../src/server/security-headers.server";

describe("Segurança: Cabeçalhos HTTP (P1-01)", () => {
  test("CSP Report-Only deve estar configurada no servidor", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("report-uri /api/public/csp-report");
    expect(csp).not.toContain("*");
  });

  test("X-Frame-Options deve ser DENY (Bloqueio Clickjacking)", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  test("X-Content-Type-Options deve ser nosniff", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });

  test("Content-Security-Policy enforce deve estar ausente", () => {
    expect((SECURITY_HEADERS as any)["Content-Security-Policy"]).toBeUndefined();
  });
});
