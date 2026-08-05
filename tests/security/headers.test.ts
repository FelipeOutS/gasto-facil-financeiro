import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("Segurança: Cabeçalhos HTTP (P1-01)", () => {
  test("Root route deve conter meta tags de segurança", () => {
    const rootContent = readFileSync(join(process.cwd(), "src/routes/__root.tsx"), "utf-8");
    
    expect(rootContent).toContain("Content-Security-Policy-Report-Only");
    expect(rootContent).toContain("X-Frame-Options");
    expect(rootContent).toContain("DENY");
    expect(rootContent).toContain("default-src 'self'");
    expect(rootContent).toContain("frame-ancestors 'none'");
  });
});
