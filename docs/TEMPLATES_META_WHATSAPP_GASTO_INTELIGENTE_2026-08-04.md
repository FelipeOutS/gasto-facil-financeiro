---
name: Auditoria de Templates WhatsApp - Prompt 7A
description: Relatório detalhado da infraestrutura de templates Meta antes da submissão oficial.
type: feature
---

# Auditoria de Templates Meta (2026-08-04)

## 1. Inventário de Templates

| Template | Interno (Código) | Banco (DML) | Meta (Remote) | Idioma | Categoria | Status Oficial |
|---|---|---|---|---|---|---|
| `gi_conta_vencendo_hoje_v1` | ✅ | ✅ | ❓ | pt_BR | UTILITY | `DRAFT LOCAL` |
| `gi_conta_vencendo_amanha_v1` | ✅ | ✅ | ❓ | pt_BR | UTILITY | `DRAFT LOCAL` |
| `gi_conta_atrasada_v1` | ✅ | ✅ | ❓ | pt_BR | UTILITY | `DRAFT LOCAL` |

## 2. Estado da Conta Meta (Somente Leitura)

| Item | Estado | Observação |
|---|---|---|
| Access token presente | ✅ | Configurado em `WHATSAPP_ACCESS_TOKEN` |
| Token aceito pela Meta | ❓ | `WHATSAPP_META_MGMT_ENABLED=false` bloqueia teste real |
| WABA ID presente | ✅ | Configurado em `WHATSAPP_WABA_ID` |
| Phone Number ID presente | ❓ | Não utilizado na gestão de templates |
| Número oficial validado | ✅ | Confirmado em `mem://features/whatsapp-scope` |
| Permissão para consultar | ❓ | Bloqueado por flag de gestão |
| Permissão para submeter | ❌ | Submissão desativada em código |
| Webhook oficial | ❓ | URL presente, mas não validada via Graph API neste prompt |
| Alertas ou restrições | ❓ | Indisponível sem consulta ativa |

## 3. Auditoria `whatsappAdminSyncTemplates`

- **Arquivo:** `src/lib/whatsapp-templates-admin.functions.ts`
- **Função:** `whatsappAdminSyncTemplates`
- **Proteção:** Middleware `requireSupabaseAuth` + Gate `assertAdminMaster` (role `owner`).
- **Entrada:** Nenhuma (vazia).
- **Saída:** Objeto de `SyncResult`.
- **Endpoint Meta:** `GET /<v>/<WABA_ID>/message_templates`
- **Somente consulta:** Sim, mas aceita `applyPatch` opcional para persistir status.
- **Cria/Submete:** Não cria nem submete. Apenas sincroniza status de templates já existentes (diff).
- **Altera banco:** Sim, atualiza a tabela `whatsapp_meta_templates` via `supabaseAdmin`.
- **Idempotência:** Sim, baseada no `last_synced_at` e fingerprint.
- **Rate Limit:** Delegado ao middleware de transport (não implementado explicitamente nesta função).
- **Token/Permissão:** Retorna `ok: false, reason: "remote_error" | "token_missing"`.
- **Envia mensagem:** Não.
- **Publicado:** Sim (infraestrutura presente).

## 4. Conteúdo dos Templates

### gi_conta_vencendo_hoje_v1
- **Categoria:** UTILITY
- **Idioma:** pt_BR
- **Corpo:** Olá! Você tem uma conta com vencimento hoje ({{1}}): {{2}}.\n\nAbra o app Gasto Inteligente para revisar ou dar baixa.\n\nPara parar de receber mensagens, responda PARAR.
- **Variáveis:** {{1}} = data dd/mm/aaaa, {{2}} = rótulo sanitizado.
- **Fluxo:** Lembrete diário de vencimento de contas cadastradas.

### gi_conta_vencendo_amanha_v1
- **Categoria:** UTILITY
- **Idioma:** pt_BR
- **Corpo:** Olá! Você tem uma conta com vencimento amanhã ({{1}}): {{2}}.\n\nAbra o app Gasto Inteligente para revisar ou programar o pagamento.\n\nPara parar de receber mensagens, responda PARAR.
- **Variáveis:** {{1}} = data dd/mm/aaaa, {{2}} = rótulo sanitizado.
- **Fluxo:** Antecipação de vencimentos próximos.

### gi_conta_atrasada_v1
- **Categoria:** UTILITY
- **Idioma:** pt_BR
- **Corpo:** Olá! Identificamos uma conta em atraso desde {{1}}: {{2}}.\n\nAbra o app Gasto Inteligente para regularizar ou registrar o pagamento.\n\nPara parar de receber mensagens, responda PARAR.
- **Variáveis:** {{1}} = data dd/mm/aaaa, {{2}} = rótulo sanitizado.
- **Fluxo:** Cobrança de contas vencidas e não baixadas.

## 5. Necessidade Real

| Template | Necessário | Fluxo Implementado | Correção |
|---|---|---|---|
| `gi_conta_vencendo_hoje_v1` | Sim | Sim (Contas a Pagar) | Nenhuma |
| `gi_conta_vencendo_amanha_v1` | Sim | Sim (Contas a Pagar) | Nenhuma |
| `gi_conta_atrasada_v1` | Sim | Sim (Contas a Pagar) | Nenhuma |

## 6. Estado Atual do WhatsApp

| Controle | Estado |
|---|---|
| `global_enabled` | `false` |
| Inbound | `false` |
| Outbound | `false` |
| Dispatcher | `false` (coluna ausente no config, inferido pelo global) |
| Cron | Inativos |
| Allowlist | Ativa (vazio) |
| Liberação Geral | Pendente |
| Mensagens Enviadas | 0 |

## 7. Próxima Ação
- Ativar `WHATSAPP_META_MGMT_ENABLED=true` em ambiente seguro para validar token.
- Submeter templates via `Prompt 7B`.
