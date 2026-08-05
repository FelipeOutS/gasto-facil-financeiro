---
name: SEGURANÇA_HEADERS_CSP_REPORT_ONLY_2026-08-05
description: Registro da implementação inicial de CSP Report-Only e proteção contra Clickjacking (P1-01).
type: design
---

# Auditoria de Cabeçalhos de Segurança (P1-01)

## Estado Anterior
- Strict-Transport-Security: Presente
- Referrer-Policy: Presente
- X-Content-Type-Options: Presente
- Cache-Control: Presente
- CSP / CSP-Report-Only: Ausente
- X-Frame-Options: Ausente

## Mudanças Implementadas
- **CSP Report-Only**: Implementada via meta tag em `src/routes/__root.tsx`.
- **X-Frame-Options**: Implementado como `DENY` via meta tag para proteção contra Clickjacking.

## Inventário de Origens
- **Self**: 'self'
- **Scripts**: Google Tag Manager, Google Ads, Mercado Pago.
- **Estilos**: Google Fonts, Inline Styles (Tailwind/Shadcn).
- **Fontes**: Google Fonts, Gstatic.
- **Imagens**: Logo.dev, Unsplash, Favicon services, Mercado Pago, Open Food Facts.
- **Conexões**: Lovable Cloud, Supabase, Mercado Pago, Google APIs, BrasilAPI, BCB, Facebook Graph, Pwned Passwords.

## Resultados de Testes
- Suíte Global: 2330 pass, 0 fail (Baseline mantida).
- Typecheck: Passou.
- Build: Passou.

## Próximos Passos (Prompt 12B)
- Analisar violações reportadas no console em produção.
- Migrar para CSP Enforce (Content-Security-Policy header real).
- Implementar Permissions-Policy.
