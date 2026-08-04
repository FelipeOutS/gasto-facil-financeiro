# Checklist de Lançamento Web - Gasto Inteligente

## 1. Segurança (P0/P1)
- [x] RLS Ativo em todas as tabelas
- [x] SECURITY DEFINER auditado
- [x] Zero secrets no frontend
- [x] Validação de Ownership em rotas de escrita
- [x] Proteção contra Seroval CVE-2026-59940

## 2. Conformidade LGPD
- [x] Termos de Uso publicados
- [x] Política de Privacidade publicada
- [x] Fluxo de Exclusão de Conta funcional
- [x] Registro de consentimento de cookies
- [x] Mapa de Dados e Terceiros concluído

## 3. Qualidade Técnica
- [x] Suíte Global (2026 testes) PASS
- [x] Build de Produção sem erros
- [x] Typecheck sem erros
- [x] Lint sem erros
- [x] Service Worker PWA configurado

## 4. Bloqueadores Externos
- [ ] Secrets oficiais do Mercado Pago (CLIENT_ID/SECRET)
- [ ] Aprovação de Templates da Meta (WhatsApp)

## 5. Prontidão Comercial
- [x] Landing Page funcional
- [x] Plano free_ads configurado para novos usuários
- [x] Gate de quotas financeiras ativo
