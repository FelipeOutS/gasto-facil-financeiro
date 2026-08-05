---
name: SEGURANÇA_HEADERS_CSP_REPORT_ONLY_2026-08-05
description: Correção P1-01: Substituição de meta tags ineficazes por headers HTTP reais e endpoint de report.
type: design
---

# Auditoria de Cabeçalhos de Segurança (P1-01) - CORREÇÃO

## Estado Anterior (Erro Técnico)
- X-Frame-Options e CSP-Report-Only implementados via `<meta http-equiv>`, sem efeito real para as diretivas `frame-ancestors` e `report-uri`.

## Mudanças Implementadas (Fase D)
- **Headers HTTP Reais**: Centralizados em `src/server/security-headers.server.ts`.
- **Proteção Anti-Clickjacking**: `X-Frame-Options: DENY` aplicado via header de resposta.
- **CSP Report-Only**: Aplicada via header com inventário de origens validado.
- **Endpoint de Report**: Criado em `/api/public/csp-report` (POST, sanitizado, rate-limited).

## Inventário de Origens Revalidado
| Origem | Diretiva | Uso | Evidência | Mantida |
|---|---|---|---|---|
| 'self' | default-src | Core | Interno | Sim |
| googletagmanager.com | script-src | GTM | src/lib/cookie-consent.tsx | Sim |
| mercadopago.com | script-src | Pagamentos | src/lib/mercado | Sim |
| fonts.googleapis.com | style-src | Tipografia | src/routes/__root.tsx | Sim |
| *.supabase.co | connect-src | Backend | client.ts | Sim |
| ai.gateway.lovable.dev | connect-src | IA | createServerFn | Sim |

## Erros Corrigidos
A PRIMEIRA IMPLEMENTAÇÃO UTILIZOU META TAGS INCOMPATÍVEIS COM OS CONTROLES PRETENDIDOS E FOI SUBSTITUÍDA POR HEADERS HTTP REAIS.

## Próximos Passos
- Monitorar `/api/public/csp-report` para falsos positivos.
- Migrar para CSP Enforce no Prompt 12B.
