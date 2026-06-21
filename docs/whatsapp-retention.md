# WhatsApp — Política de retenção (proposta)

Status: **proposta — não aplicada automaticamente.** Apagar dados existentes exige revisão separada.

## Tabelas e dados envolvidos

| Tabela                  | Conteúdo sensível                                                                 |
|-------------------------|------------------------------------------------------------------------------------|
| `whatsapp_messages`     | Texto bruto da mensagem, `parsed` (dados financeiros interpretados), `resposta_sugerida`, `gasto_id`, `external_id`, `telefone`. |
| `whatsapp_links`        | Telefone vinculado ao usuário, consentimento (`opt_in_em`, `opt_in_version`, `opt_in_user_agent`), `revogado_em`. |
| `whatsapp_beta_access`  | Quem tem acesso à beta fechada. Sem PII além do `user_id`.                         |
| `webhook_logs` (provider=whatsapp) | Metadados de processamento, **sem texto, sem telefone, sem payload financeiro**. |

## Prazos sugeridos

- **Sessões concluídas (`status = 'salva'`)**: manter texto bruto por **30 dias**; após isso, anonimizar (`texto = NULL`, `parsed = NULL`, `resposta_sugerida = NULL`), preservando apenas `gasto_id`, `external_id` e `recebida_em` para auditoria e dedupe.
- **Sessões canceladas/expiradas (`cancelada`, `expirada`, `sem_pendencia`)**: apagar a linha após **15 dias**.
- **Sessões pendentes presas (`aguardando_*` há > 48h)**: marcar como `expirada`; entrar no fluxo acima.
- **Mensagens com `nao_elegivel`/`canary_dropped`**: nunca persistidas (já garantido pelo webhook).
- **Logs de webhook (`webhook_logs`)**: manter por **90 dias**; já não contêm PII por contrato.
- **`whatsapp_links` revogados há > 180 dias**: anonimizar `telefone` (hash one-way) e manter `opt_in_em`/`revogado_em` para evidência LGPD.
- **`whatsapp_beta_access` revogados há > 365 dias**: remover linha.

## Princípios LGPD

- Texto bruto é dado pessoal — minimização e prazo curto.
- Consentimento (`opt_in_*`) deve sobreviver à anonimização para prova de base legal.
- Toda limpeza deve gerar entrada em `audit_logs` (resource=`whatsapp_messages`, action=`retention_cleanup`).
- Nenhuma rotina de exclusão roda automaticamente até aprovação explícita.

## Execução recomendada

Job diário via pg_cron (após autorização):

```sql
-- pseudo: a ser revisado antes de aplicar
UPDATE public.whatsapp_messages
SET texto = NULL, parsed = NULL, resposta_sugerida = NULL
WHERE status = 'salva'
  AND recebida_em < now() - interval '30 days'
  AND texto IS NOT NULL;

DELETE FROM public.whatsapp_messages
WHERE status IN ('cancelada','expirada','sem_pendencia')
  AND recebida_em < now() - interval '15 days';
```

> Esta proposta é apenas documental. **Nenhuma migração de limpeza foi aplicada nesta entrega.**
