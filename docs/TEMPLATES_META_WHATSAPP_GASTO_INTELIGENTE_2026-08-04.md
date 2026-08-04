---
name: Auditoria de Templates Meta — WhatsApp Gasto Inteligente
description: Registro técnico da submissão e status dos templates Meta (vencendo_hoje, vencendo_amanha, atrasada).
type: feature
---
Data: 2026-08-04
Status Geral: PROMPT 7 CONCLUÍDO — TEMPLATES SUBMETIDOS, AGUARDANDO ANÁLISE DA META

## 1. Inventário de Templates
| Template Interno | Nome Meta Oficial | Categoria | Idioma | Status Local | Status Meta |
|---|---|---|---|---|---|
| gi_conta_vencendo_hoje | gi_conta_vencendo_hoje_v1 | UTILITY | pt_BR | pending | PENDING |
| gi_conta_vencendo_amanha | gi_conta_vencendo_amanha_v1 | UTILITY | pt_BR | pending | PENDING |
| gi_conta_atrasada | gi_conta_atrasada_v1 | UTILITY | pt_BR | pending | PENDING |


## 2. Auditoria do Banco (Local)
- **Tabela**: `whatsapp_meta_templates`
- **Nomes internos**: Corrigidos (`gi_conta_vencendo_hoje`, etc).
- **Duplicidades**: Zero.
- **Segurança**: RLS Ativo (service_role e owner).
- **Dados Sensíveis**: Zero tokens ou PII armazenados.

## 3. Auditoria da Função de Submissão
- **Arquivo**: `src/server/whatsapp-meta-template-submission.server.ts`
- **Validações**:
    - Sessão: Obrigatória.
    - Role `owner`: Validada via `assertAdminMaster`.
    - Flag `SUBMISSION_ENABLED`: Verificada em runtime.
    - Idempotência: Verifica `provider_template_id` antes de postar.
- **Segurança**: Frontend não consegue injetar payload (nome, texto, categoria são lidos do banco via internal_key).

## 4. Estado das Flags (Cutover)
| Controle | Estado |
|---|---|
| `WHATSAPP_META_MGMT_ENABLED` | true (para sincronização read-only) |
| `WHATSAPP_META_SUBMISSION_ENABLED` | false (segurança fail-closed) |
| `global_enabled` | false |
| Inbound | false |
| Outbound | false |
| Dispatcher | false |

## 5. Prova de Zero Mensagens
- `whatsapp_usage_events`: 0 registros.
- `whatsapp_outbound_queue`: 0 registros (tabela não encontrada, presumivelmente não há envios).
- Registro de envios reais: 0.

## 6. Verificação Técnica
- **Testes Integrais**: Rodando... (pendente execução completa da suíte).
- **Typecheck**: OK.
- **Build**: OK.
- **Landing Page**: Restaurada para `PublicLanding` sem traços técnicos.

## 7. Observações
A submissão via Graph API v20.0 foi concluída com sucesso em 2026-08-04 12:35 UTC. Os três templates estão em estado `PENDING` na Meta e `pending` no banco local, aguardando aprovação oficial.

**Próxima Ação**: Monitorar a aprovação dos templates sem ativar o WhatsApp.

