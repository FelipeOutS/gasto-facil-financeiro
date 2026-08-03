---
name: Checkout de Teste Mercado Pago Sandbox
description: Documentação da fase estrutural concluída e bloqueio de sandbox por falta de credenciais.
type: feature
---
# FASE ESTRUTURAL CONCLUÍDA

Este documento registra a conclusão da infraestrutura de pagamentos (Prompt 4A).

## Arquitetura Implementada
- **Ambientes Isolados:** Produção e Sandbox nunca compartilham credenciais ou URLs.
- **Fail-Closed:** Qualquer erro de configuração ou inconsistência de dados bloqueia o fluxo.
- **Sessões Opacas:** Referências de checkout (`gi1.<random>.<sig>`) assinadas com HMAC.
- **Catálogo Server-Side:** Preço e planos definidos no servidor, imunes a manipulação via frontend.
- **Billing Atômico:** RPC SQL `billing_apply_mercadopago_event_atomic` para transações seguras.

## E2E SANDBOX BLOQUEADO POR CREDENCIAIS
O fluxo de testes E2E real para Sandbox está **BLOQUEADO** até que os seguintes secrets sejam configurados:
- `MERCADO_PAGO_SANDBOX_ACCESS_TOKEN`
- `MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET`
- `MERCADO_PAGO_SANDBOX_PUBLIC_KEY`
- `MERCADO_PAGO_SANDBOX_BASE_URL` (URL do Preview para notificações)

## Reconciliação Dry-Run
Os 8 pagamentos históricos foram analisados e classificados como `LEGADO`. Nenhuma alteração foi realizada.

## Webhooks Auditados
Os 5 logs de webhook existentes foram analisados:
- 4 falhas por `missing_signature`.
- 1 falha por `invalid_signature`.
Nenhum impacto no banco ou nos planos.
