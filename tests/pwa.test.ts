import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA Validation', () => {
  it('should have a valid manifest.webmanifest', () => {
    const manifestPath = path.resolve(process.cwd(), 'public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('Gasto Inteligente');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  it('should have a service worker file', () => {
    const swPath = path.resolve(process.cwd(), 'public/sw.js');
    expect(fs.existsSync(swPath)).toBe(true);
    const swContent = fs.readFileSync(swPath, 'utf-8');
    expect(swContent).toContain('CACHE_NAME');
    expect(swContent).toContain('SENSITIVE_PATTERNS');
  });

  it('should block sensitive routes from cache in SW', () => {
    const swContent = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf-8');
    expect(swContent).toContain("'/api/'");
    expect(swContent).toContain("'/dashboard'");
    expect(swContent).toContain("'/auth/'");
  });

  it('should have an offline fallback page', () => {
    const offlinePath = path.resolve(process.cwd(), 'public/offline.html');
    expect(fs.existsSync(offlinePath)).toBe(true);
  });
});
