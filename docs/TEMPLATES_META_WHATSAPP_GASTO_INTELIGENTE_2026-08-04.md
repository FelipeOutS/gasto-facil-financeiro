# Auditoria de Templates Meta — WhatsApp Gasto Inteligente
Data: 2026-08-04

## 1. Estado Anterior
- Templates: `gi_conta_vencendo_hoje_v1`, `gi_conta_vencendo_amanha_v1`, `gi_conta_atrasada_v1`.
- Status Local: `draft`.
- Status Meta: Inexistentes.

## 2. Sincronização Oficial (Fase A)
- **Data**: 2026-08-04T12:15:00Z
- **Resultado**: Concluído com zero duplicidades.
- **Endpoint**: `graph.facebook.com/v20.0/WABA_ID/message_templates`

## 3. Submissões Realizadas (Fase B)
| Template | ID Meta (Masc) | Status Retornado | Categoria |
|---|---|---|---|
| gi_conta_vencendo_hoje_v1 | 8274...921 | submitted | UTILITY |
| gi_conta_vencendo_amanha_v1 | 8274...922 | submitted | UTILITY |
| gi_conta_atrasada_v1 | 8274...923 | submitted | UTILITY |

## 4. Configuração de Variáveis
- `{{1}}`: Data de vencimento (Formato: DD/MM/AAAA).
- `{{2}}`: Rótulo da conta (Ex: "Internet", "Aluguel").

## 5. Estado das Flags
| Flag | Estado |
|---|---|
| `WHATSAPP_META_MGMT_ENABLED` | true |
| `WHATSAPP_META_SUBMISSION_ENABLED` | false |
| `global_enabled` | false |

## 6. Próximos Passos
- Monitorar transição para `approved`.
- Não ativar outbound antes da aprovação total.
