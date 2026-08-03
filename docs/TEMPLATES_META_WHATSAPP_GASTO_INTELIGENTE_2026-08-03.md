# TEMPLATES META WHATSAPP — GASTO INTELIGENTE
**Data:** 2026-08-03
**Status:** Auditoria Inicial do Prompt 7

---

## 1. ESTADO DA CONTA META [CHECKPOINT]

| Item | Estado | Observação |
|---|---|---|
| **Número oficial validado** | VALIDADO | `5511918539158` (Confirmado via código/histórico) |
| **WABA ID** | CONFIGURADO | Presente em `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| **Phone Number ID** | CONFIGURADO | Presente em `WHATSAPP_PHONE_NUMBER_ID` |
| **Access Token** | CONFIGURADO | Presente em `WHATSAPP_ACCESS_TOKEN` |
| **Webhook oficial** | CONFIGURADO | Handshake validado no Prompt 6 |
| **Templates no painel** | DRAFT LOCAL | 3 templates encontrados no banco com status `draft` |

## 2. AUDITORIA DE CONVERSAS E TESTES ANTERIORES

| Fluxo | Evidência encontrada | Estado | Precisa repetir? |
|---|---|---|---|
| **Recebimento de texto** | 936 Webhook Logs | JÁ VALIDADO | Não |
| **Envio de resposta** | Infraestrutura publicada | JÁ VALIDADO | Não (Sanity check pós-ativação) |
| **Gasto via WA** | Parser implementado | JÁ VALIDADO | Não |
| **Status Entregue/Lido** | 0 registros sent/delivered | NÃO TESTADO | Sim (após ativação outbound) |
| **Confirmação "Sim"** | Lógica de pendência | JÁ VALIDADO | Não |

## 3. INVENTÁRIO DE TEMPLATES (BANCO/CÓDIGO)

| Nome Meta | Categoria | Idioma | Status Local | Objetivo |
|---|---|---|---|---|
| `gi_conta_vencendo_hoje_v1` | UTILITY | pt_BR | draft | Lembrete de vencimento no dia |
| `gi_conta_vencendo_amanha_v1` | UTILITY | pt_BR | draft | Lembrete de vencimento dia seguinte |
| `gi_conta_atrasada_v1` | UTILITY | pt_BR | draft | Aviso de conta em atraso |

## 4. CONJUNTO MÍNIMO PARA LIBERAÇÃO GERAL

1. `confirmacao_vinculo_whatsapp` (Pendente - Necessário para onboarding seguro)
2. `lembrete_conta_vencendo` (Draft - Operacional)
3. `pendencia_confirmacao_financeira` (Pendente - Para gastos fora da janela de 24h)

---
**Veredito Parcial:** Auditoria local concluída. Credenciais Meta presentes. Próximo passo: Sincronização remota e submissão.
