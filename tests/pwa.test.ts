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

  it("sw.js está em PWA STABILITY MODE (worker de limpeza, sem fetch handler)", () => {
    const swContent = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf-8");

    // Incidente P0 2026-08-07: o worker publicado apenas se remove.
    expect(swContent).toContain("self.registration.unregister()");
    expect(swContent).toContain("self.skipWaiting()");
    expect(swContent).not.toContain('addEventListener("fetch"');
    expect(swContent).not.toContain("cache.addAll");
  });

  it("apaga apenas caches do app, preservando caches de terceiros", () => {
    const swContent = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf-8");
    expect(swContent).toContain('const APP_CACHE_PREFIX = "gi-"');
    expect(swContent).toContain("isAppOwnedCache");
    // Nunca um caches.delete indiscriminado.
    expect(swContent).not.toMatch(/cacheNames\.map\(\(name\) => caches\.delete\(name\)\)/);
  });

  it("o app não registra mais Service Worker", () => {
    const root = fs.readFileSync(path.resolve(process.cwd(), "src/routes/__root.tsx"), "utf-8");
    expect(root).not.toContain('serviceWorker.register("/sw.js")');
    expect(root).toContain("cleanupLegacyServiceWorkers");
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
