---
name: Checkout de Teste Mercado Pago Sandbox
description: Documentação do estado do E2E Sandbox (Prompt 4B).
type: feature
---
# E2E SANDBOX PARCIAL — BLOQUEADO POR SECRETS

Este documento registra a tentativa de execução do Prompt 4B (E2E Sandbox).

## 1. Checkpoint dos Secrets
| Configuração | Estado |
| --- | --- |
| MERCADO_PAGO_ENVIRONMENT | **AUSENTE** (bloqueador) |
| Access token sandbox (TEST-) | AUSENTE |
| Public key sandbox (TEST-) | AUSENTE |
| Webhook secret sandbox | AUSENTE |
| Base URL sandbox | AUSENTE |
| Token de produção (APP_USR-) | PRESENTE (legacy) |
| Webhook de produção | PRESENTE (legacy) |
| Segredos expostos ao cliente | NÃO |

## 2. Condição de Parada
A execução foi interrompida conforme regra do Prompt 4B: **"Não continue se algum secret sandbox estiver ausente"**. O ambiente fail-closed implementado no Prompt 4A funcionou conforme o esperado, impedindo a criação de checkouts sem a devida configuração de sandbox.

## 3. Próximos Passos
Para prosseguir com o E2E real, é necessário injetar os segredos via Lovable Secrets:
1. `MERCADO_PAGO_ENVIRONMENT = sandbox`
2. `MERCADO_PAGO_SANDBOX_ACCESS_TOKEN = TEST-...`
3. `MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET = ...`
4. `MERCADO_PAGO_SANDBOX_PUBLIC_KEY = TEST-...`
5. `MERCADO_PAGO_SANDBOX_BASE_URL = https://id-preview--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app`

## 4. Auditoria de Regressão
- **Prompt 2 (Dados Fictícios):** Preservado. Constraint ativa, soma operacional estável em R$ 515.757,00.
- **Prompt 3 (Seroval):** Preservado. Versão 1.5.6 ativa.
- **Prompt 4A (Estrutura):** Operacional. Módulos de catálogo, sessão HMAC e reconciliação dry-run ativos.

Documento atualizado em: 2026-08-03 18:40 UTC.
