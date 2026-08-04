---
name: PWA Audit and Strengthening
description: Detailed audit and secure implementation of PWA for Gasto Inteligente.
type: feature
---

# PWA Audit 2026-08-04

## Initial State
- Manifest: Missing/Incomplete
- Service Worker: Missing
- Icons: Basic favicons exist, but PWA-specific icons needed mapping.
- Offline: No fallback.

## Implementation Details
### 1. Manifest (`/public/manifest.webmanifest`)
- Name: Gasto Inteligente
- Display: standalone
- Orientation: portrait-primary
- Theme Color: #FAFAFB (matching light background)
- Start URL: /
- Scope: /

### 2. Service Worker (`/public/sw.js`)
- Strategy: **Secure Conservative**
- **Cache First**: Versioned JS/CSS, images, fonts, icons.
- **Network First**: Public landing page.
- **Network Only (Strict)**: All /api, /auth, /dashboard, and financial routes.
- **Purge**: Automatic cleanup of old cache versions on activation.

### 3. Offline Fallback (`/public/offline.html`)
- Generic message informing connectivity loss.
- Zero financial data leak (Network Only for data routes ensures no stale/cached private data).

### 4. Registration
- Registered in `src/routes/__root.tsx` via standard navigator.serviceWorker.register.

## Security Controls
- **Zero Sensitive Cache**: Verified that no private routes or API responses are stored in CacheStorage.
- **Role Isolation**: Admin (Joanin/Carrefour) routes are already protected by `owner` role, PWA layer adds no risk.

## Pending Actions
- Official 512x512 maskable icons.
- Automated tests for cache exclusions.
- Lighthouse PWA run in production environment.
