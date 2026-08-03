---
name: Ativação Oficial do Mercado Pago em Produção
description: Registro da transição para produção oficial e cancelamento do ambiente sandbox.
type: feature
---
# ATIVAÇÃO OFICIAL DO MERCADO PAGO EM PRODUÇÃO (Prompt 4)

## ESTADO: SANDBOX CANCELADO / PRODUÇÃO PREPARADA

Este documento registra a decisão estratégica de pular o ambiente sandbox e ativar a integração oficial do Mercado Pago diretamente em produção.

Este documento registra a correção da premissa de detecção de ambiente e o estado atual do E2E Sandbox.

## 1. Correção de Premissa (Prompt 4A.1)
Anteriormente, o sistema rejeitava tokens com prefixo `APP_USR-` no modo sandbox, presumindo serem de produção. 
**Correção:** Credenciais de teste oficiais do Mercado Pago para Checkout Pro podem utilizar o prefixo `APP_USR-`.
**Nova Regra:** O ambiente é determinado exclusivamente pelas variáveis `MERCADO_PAGO_ENVIRONMENT` e pela origem do secret (`SANDBOX_*` vs `PRODUCTION_*`). Bloqueios cruzados agora são baseados na vinculação do secret ao ambiente, não no prefixo (exceto `TEST-`, que nunca é produção).

## 2. Checkpoint dos Secrets
| Configuração | Estado |
| --- | --- |
| MERCADO_PAGO_ENVIRONMENT | **AUSENTE** (bloqueador) |
| Access token sandbox | AUSENTE |
| Public key sandbox | AUSENTE |
| Webhook secret sandbox | AUSENTE |
| Base URL sandbox | AUSENTE |
| Token de produção (APP_USR-) | PRESENTE (legacy) |
| Webhook de produção | PRESENTE (legacy) |
| Segredos expostos ao cliente | NÃO |

## 3. Bloqueios Preservados
- **Fallback de Produção no Sandbox:** Proibido. Se `MERCADO_PAGO_ENVIRONMENT=sandbox`, o sistema não lê segredos legados ou de produção.
- **URL de Produção em Preview:** Proibido em modo produção.
- **Token TEST- em Produção:** Bloqueado via `classifyTokenPrefix`.

## 4. Próximos Passos (PRODUÇÃO)
Para ativar o checkout real no domínio oficial, é necessário injetar os segredos de produção via Lovable Secrets:
1. `MERCADO_PAGO_ENVIRONMENT = production`
2. `MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN = ...`
3. `MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET = ...`
4. `MERCADO_PAGO_PRODUCTION_PUBLIC_KEY = ...`
5. `MERCADO_PAGO_PRODUCTION_BASE_URL = https://gastointeligente.com.br`

## 5. Auditoria de Prontidão
- **Sandbox:** CANCELADO por decisão oficial.
- **Produção:** PREPARADA com infraestrutura fail-closed.
- **Domínio Oficial:** https://gastointeligente.com.br (Único autorizado).
- **Webhook:** /api/public/webhooks/mercadopago
- **Estado:** AGUARDANDO PRIMEIRA TRANSAÇÃO OFICIAL.

Documento atualizado em: 2026-08-03 18:46 UTC.
