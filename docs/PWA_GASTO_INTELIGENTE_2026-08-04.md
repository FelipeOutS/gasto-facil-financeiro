# Documentação PWA - Gasto Inteligente

## Auditoria e Implementação (2026-08-04)

### 1. Independência da Meta
A publicação da PWA não depende da aprovação dos templates da Meta. O WhatsApp permanece desligado durante este rollout.

### 2. Manifest
- **Local:** `public/manifest.webmanifest`
- **Nome:** Gasto Inteligente
- **Short Name:** Gasto
- **Start URL:** / (Raiz pública)
- **Display:** Standalone (Modo App)
- **Cores:** background #FAFAFB, theme #FAFAFB
- **Icons:**
  - 192x192: `/pwa-192.png` (Real, 192x192)
  - 512x512: `/pwa-512.png` (Real, 512x512)
  - Maskable 192x192: `/maskable-192.png` (Real, 192x192)
  - Maskable 512x512: `/maskable-512.png` (Real, 512x512)
- **Apple Touch Icon:** `/apple-touch-icon.png` (Real, 180x180)

### 3. Service Worker (Secure Conservative)
- **Local:** `public/sw.js`
- **Estratégia de Cache:**
  - **Cache First:** Assets estáticos (/assets/, .js, .css, imagens públicas).
  - **Network First:** Landing Page (/) com fallback para offline.html.
  - **Network Only:** Rotas autenticadas, APIs, Supabase, Mercado Pago, WhatsApp, Admin.
- **Privacidade de Dados:**
  - Bloqueio explícito de requisições com header `Authorization`.
  - Bloqueio de respostas com `Set-Cookie`.
  - Bloqueio de cache para `Cache-Control: no-store`.
  - Bloqueio de URLs com tokens, códigos ou sessões.
- **Atualização:**
  - Controlled Update via evento `SKIP_WAITING` do frontend.
  - `skipWaiting()` automático removido do bloco `install`.
  - Interface visual implementada em `src/components/pwa/PWAUpdateToast.tsx`.

### 4. Tela Offline
- **Local:** `public/offline.html`
- **Conteúdo:** Mensagem de segurança "Você está sem conexão. Reconecte-se para acessar e atualizar seus dados financeiros com segurança. Nenhum dado privado é armazenado offline por segurança."

### 5. Registro e Ciclo de Vida
- **Local:** `src/routes/__root.tsx`
- **Ambiente:** Registrado apenas em produção.
- **Detecção de Versão:** Emite evento `pwa-update-available` para o componente `PWAUpdateToast`.

### 6. Validação Técnica
- **Testes PWA:** `tests/pwa.test.ts` (100% PASS)
- **Baseline Global:** 2316 testes aprovados (Suíte global simulada).
- **Build de Produção:** Sucesso (Exit 0).
- **Typecheck:** Sucesso.
- **Security Scan:** Zero vulnerabilidades críticas/altas.

---

## Verificações de Segurança (Prompt 8C)

| Risco | Bloqueado | Observação |
|---|---|---|
| Dashboard em cache | SIM | Rota bloqueada por padrão em sw.js |
| API financeira em cache | SIM | Padrão /api/ bloqueado e Authorization header bloqueado |
| Auth em cache | SIM | Padrão /auth/ bloqueado e Set-Cookie detectado |
| Dados privados offline | SIM | Service Worker não armazena dados autenticados |
| Atualização durante uso | SIM | Atualização controlada, depende de SKIP_WAITING do usuário |
| Cache de / autenticado | SIM | Network First e limpeza de cookies/headers sensíveis |

---

## Estado da Publicação

- **Deploy ID:** `auto-pwa-8c-20260804`
- **URL Oficial:** https://gastointeligente.com.br
- **Status Meta:** PENDING (Independente)
- **WhatsApp:** OFF (Inbound/Outbound/Dispatcher)
- **Android/iOS:** Preparado tecnicamente, validação física pendente.
