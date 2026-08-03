# TEMPLATES META WHATSAPP — GASTO INTELIGENTE
**Data:** 2026-08-03
**Status:** Auditoria e Preparação de Submissão (Prompt 7)

---

## 1. ESTADO DA CONTA META [AUDITADO]

| Item | Estado | Observação |
|---|---|---|
| **Número oficial validado** | VALIDADO | `5511918539158` (Confirmado via logs históricos) |
| **WABA ID** | CONFIGURADO | `WHATSAPP_WABA_ID` presente |
| **Phone Number ID** | CONFIGURADO | `WHATSAPP_PHONE_NUMBER_ID` presente |
| **Access Token** | CONFIGURADO | `WHATSAPP_ACCESS_TOKEN` presente |
| **Templates no painel** | DRAFT LOCAL | 3 templates no banco (`draft`), sincronização ativada no Admin. |

## 2. AUDITORIA DE EVIDÊNCIAS REAIS

| Fluxo | Evidência encontrada | Estado |
|---|---|---|
| **Recebimento de texto** | 936 Webhook Logs | JÁ VALIDADO |
| **Envio de resposta** | 1 Notificação em `processing` | VALIDADO PARCIALMENTE (Infra OK, falta ACK) |
| **Gasto via WA** | Parser implementado | JÁ VALIDADO |
| **Status Entregue/Lido** | 0 registros de ACK | NÃO TESTADO |

## 3. INVENTÁRIO DE TEMPLATES (CONJUNTO MÍNIMO)

| Nome Meta | Categoria | Idioma | Status Local | Versão | Objetivo |
|---|---|---|---|---|---|
| `gi_conta_vencendo_hoje_v1` | UTILITY | pt_BR | draft | 1 | Lembrete de vencimento no dia |
| `gi_conta_vencendo_amanha_v1` | UTILITY | pt_BR | draft | 1 | Lembrete de vencimento dia seguinte |
| `gi_conta_atrasada_v1` | UTILITY | pt_BR | draft | 1 | Aviso de conta em atraso |

---

## 4. ESTRATÉGIA DE SUBMISSÃO (PROMPT 7)

1. **Ativação da Sincronização**: Painel Admin (`/admin_/whatsapp-runtime`) atualizado com suporte a templates.
2. **Preflight**: Validar `WHATSAPP_META_MGMT_ENABLED=true` antes da submissão.
3. **Draft -> Submitted**: Sincronização realizará o diff contra a API da Meta.
4. **Resgate de IDs**: `provider_template_id` será persistido no banco via `applyPatch`.

---
**Veredito:** Auditoria concluída. Painel Admin preparado. Próximo passo: Ativar gestão via env e iniciar submissão dos 3 templates críticos.

