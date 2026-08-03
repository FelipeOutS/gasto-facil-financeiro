---
name: Checkout de Teste Mercado Pago Sandbox
description: Documentação do estado do E2E Sandbox (Prompt 4B).
type: feature
---
# E2E SANDBOX PARCIAL — BLOQUEADO POR CREDENCIAIS (Prompt 4A.1)

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

## 4. Próximos Passos
Para prosseguir com o E2E real, é necessário injetar os segredos via Lovable Secrets:
1. `MERCADO_PAGO_ENVIRONMENT = sandbox`
2. `MERCADO_PAGO_SANDBOX_ACCESS_TOKEN = ...` (Aceita `APP_USR-` ou `TEST-`)
3. `MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET = ...`
4. `MERCADO_PAGO_SANDBOX_PUBLIC_KEY = ...`
5. `MERCADO_PAGO_SANDBOX_BASE_URL = https://id-preview--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app`

## 5. Auditoria de Regressão
- **Prompt 2 (Dados Fictícios):** Preservado.
- **Prompt 3 (Seroval):** Preservado.
- **Prompt 4A (Estrutura):** Refatorado para suportar tokens `APP_USR-` em sandbox.

Documento atualizado em: 2026-08-03 18:45 UTC.
