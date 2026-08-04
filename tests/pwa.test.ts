import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("PWA 8B Validation", () => {
  it("should have a valid manifest.webmanifest with 192/512 icons", () => {
    const manifestPath = path.resolve(process.cwd(), "public/manifest.webmanifest");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.some((i) => i.sizes === "192x192" && !i.purpose)).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "512x512" && !i.purpose)).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.lang).toBe("pt-BR");
    expect(manifest.display).toBe("standalone");
  });

  it("should have real icon files", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "public/pwa-192.png"))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), "public/pwa-512.png"))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), "public/maskable-192.png"))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), "public/maskable-512.png"))).toBe(true);
  });

  it("should have controlled update in sw.js", () => {
    const swContent = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf-8");
    const installBlock =
      swContent.match(/self\.addEventListener\('install'[\s\S]*?\}\);/)?.[0] || "";

    // Filtra comentários para verificar se a chamada está ativa
    const activeLines = installBlock
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    expect(activeLines).not.toContain("self.skipWaiting()");
    expect(swContent).toContain("event.data === 'SKIP_WAITING'");
  });

  it("should block all sensitive patterns and auth headers", () => {
    const swContent = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf-8");
    expect(swContent).toContain("'mercadopago.com'");
    expect(swContent).toContain("request.headers.has('Authorization')");
    expect(swContent).toContain("const isSensitive = SENSITIVE_PATTERNS.some");
  });

  it("should have a secure offline page", () => {
    const offlineContent = fs.readFileSync(
      path.resolve(process.cwd(), "public/offline.html"),
      "utf-8",
    );
    expect(offlineContent).toContain('lang="pt-BR"');
    expect(offlineContent).toContain(
      "Reconecte-se para acessar e atualizar seus dados financeiros com segurança",
    );
  });
});
