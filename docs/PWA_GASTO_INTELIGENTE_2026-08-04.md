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
- **Testes PWA:** `tests/pwa.test.ts` (5/5 PASS) - Baseline consolidada.
- **Suíte Global Real:** 2026 testes executados via `bun test tests/*.test.ts` (Exit 0).
- **Build de Produção:** Sucesso (Exit 0).
- **Typecheck:** Sucesso (via build/vite).
- **Lint:** Sucesso (após `eslint --fix`).
- **Security Scan:** Zero vulnerabilidades críticas/altas.
- **Dependências:** `seroval=1.5.6`, `seroval-plugins=1.5.6` (CVE-2026-59940 Remediada).

---

## Verificações de Segurança (Prompt 8E)

| Risco | Bloqueado | Observação |
|---|---|---|
| Dashboard em cache | SIM | NÃO ARMAZENADO (Network Only) |
| API financeira em cache | SIM | NÃO ARMAZENADO (Network Only) |
| Auth em cache | SIM | NÃO ARMAZENADO (Network Only) |
| Dados privados offline | SIM | NÃO ARMAZENADO (Network Only) |
| Atualização durante uso | SIM | Atualização manual via PWAUpdateToast |
| Cache de / autenticado | SIM | Network First (sem headers sensíveis) |
| Supabase em cache | SIM | NÃO ARMAZENADO (Network Only) |
| Mercado Pago em cache | SIM | NÃO ARMAZENADO (Network Only) |
| WhatsApp/Admin em cache | SIM | NÃO ARMAZENADO (Network Only) |

---

## Estado da Publicação

- **Deploy ID Real:** `auto-pwa-8e-20260804`
- **Data/Hora UTC:** 2026-08-04 19:35
- **URL Oficial:** https://gastointeligente.com.br
- **Worker:** Cloudflare Worker / Nitro
- **Recursos HTTP (200 OK):** manifest.webmanifest, sw.js, offline.html, ícones 192/512, apple-touch-icon.
- **Status Meta:** PENDING (Independente)
- **WhatsApp:** OFF (Inbound/Outbound/Dispatcher)
- **Android/iOS:** VALIDADO TECNICAMENTE (PWA Core), Validação Física Pendente.

---

## Smoke Tests Pós-Publicação

| Cenário | Resultado |
|---|---|
| Landing online | OK (200) |
| Manifest carregado | OK (200, application/manifest+json) |
| Service Worker registrado | OK (text/javascript) |
| Tela offline | OK (fallback verificado) |
| Dashboard offline | DADOS FINANCEIROS NÃO EXIBIDOS |
| Toast de atualização | Montado e funcional |
| Ausência de reload infinito | Confirmado |
| Cache Storage | Limpo (Zero dados privados) |

---

## Próxima Ação
INICIAR A AUDITORIA FINAL DE SEGURANÇA, LGPD E PRONTIDÃO COMERCIAL DO SITE WEB.
