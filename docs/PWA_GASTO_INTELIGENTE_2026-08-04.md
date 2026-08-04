# Documentação PWA - Gasto Inteligente

## Auditoria e Implementação (2026-08-04)

### 1. Manifest
- **Local:** `public/manifest.webmanifest`
- **Nome:** Gasto Inteligente
- **Short Name:** Gasto
- **Start URL:** / (Raiz pública)
- **Display:** Standalone (Modo App)
- **Cores:** background #FAFAFB, theme #FAFAFB
- **Icons:**
  - 192x192: `/pwa-192.png` (Válido)
  - 512x512: `/pwa-512.png` (Válido)
  - Maskable 192x192: `/maskable-192.png` (Válido)
  - Maskable 512x512: `/maskable-512.png` (Válido)
- **Apple Touch Icon:** `/apple-touch-icon.png` (180x180, Válido)

### 2. Service Worker (Secure Conservative)
- **Local:** `public/sw.js`
- **Estratégia de Cache:**
  - **Cache First:** Assets estáticos (/assets/, .js, .css, imagens públicas).
  - **Network First:** Landing Page (/) com fallback para offline.html.
  - **Network Only:** Rotas autenticadas, APIs, Supabase, Mercado Pago, WhatsApp, Admin.
- **Privacidade de Dados:**
  - Bloqueio explícito de requisições com header `Authorization`.
  - Bloqueio de respostas com `Set-Cookie`.
  - Bloqueio de cache para `Cache-Control: no-store`.
- **Atualização:**
  - Controlled Update via evento `SKIP_WAITING` do frontend.
  - `skipWaiting()` automático removido.
  - `clients.claim()` automático removido.

### 3. Tela Offline
- **Local:** `public/offline.html`
- **Conteúdo:** Mensagem de segurança "Você está sem conexão. Reconecte-se para acessar e atualizar seus dados financeiros com segurança. Nenhum dado privado é armazenado offline por segurança."
- **Estilo:** Minimalista, em conformidade com a identidade visual.

### 4. Registro e Ciclo de Vida
- **Local:** `src/routes/__root.tsx`
- **Ambiente:** Registrado apenas em produção (`import.meta.env.PROD`).
- **Detecção de Versão:** Emite evento `pwa-update-available` para o frontend oferecer o botão de atualização.

### 5. Validação Técnica
- **Testes PWA:** `tests/pwa.test.ts` (100% PASS)
- **Baseline Global:** 2316 testes aprovados.
- **Build de Produção:** Sucesso (Exit 0).

---

## Verificações de Segurança (Prompt 8B)

| Risco | Bloqueado | Observação |
|---|---|---|
| Dashboard em cache | SIM | Rota bloqueada por padrão em sw.js |
| API financeira em cache | SIM | Padrão /api/ bloqueado e Authorization header bloqueado |
| Auth em cache | SIM | Padrão /auth/ bloqueado e Set-Cookie detectado |
| Dados privados offline | SIM | Service Worker não armazena dados autenticados |
| Atualização durante uso | SIM | Atualização controlada, depende de SKIP_WAITING do usuário |

---

## Próximos Passos
- Implementar interface visual de atualização (Banner/Toaster) no frontend.
- Validar instalação em dispositivo físico iOS (Atualmente: PREPARADO, NÃO VALIDADO).
