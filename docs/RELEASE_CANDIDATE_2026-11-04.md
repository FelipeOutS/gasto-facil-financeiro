# Versão candidata — 04/11/2026

## Estado verificado
- Suíte completa: 308 arquivos, 4.496 pass, 0 fail (9 skip).
- SQL descartável: reorganização 114 PASS; exclusão individual v2 + concorrência 25 PASS.
- Varredura de segurança básica: sem achados (04/11/2026).
- Banco real (somente leitura): `gastos` tem `deleted_at`, `updated_at`, `import_batch_id`; faltam `deleted_by`, `deletion_batch_id`, `deletion_source`, trigger `gastos_guard_soft_delete` e constraint `gastos_deletion_consistent_chk` (F2). `receitas` já tem as colunas de soft-delete. `whatsapp_entry_mutate_v2` ausente.

## Travas no código publicado (todas fechadas por padrão)
| Função | Trava | Estado |
|---|---|---|
| Excluir/restaurar individual | secret `WHATSAPP_FINANCIAL_MUTATIONS_VERSION=2` + RPC v2 | fechada (RPC ausente) |
| Exclusão por mês/período | `LOTE_MES_RELEASE_AUTHORIZED` (constante) | fechada |
| Reorganização em massa / combinados / saldo | `WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED` (constante) | fechada |
| Assistente de compras | `WHATSAPP_SHOPPING_ENABLED` | fechada |

## Ordem de implantação
1. Publicar o código (travas fechadas): sem mudança de banco, sem operação destrutiva.
2. Homologar no Draft 2 (banco isolado): aplicar F2 → v2, rodar cenário fictício.
3. Com autorização: backup (More → Database → Manage → Backups / Export) → aplicar `gastos-soft-delete-f2.sql` → `whatsapp-entry-mutations-v2.sql` (ambas aditivas, sem UPDATE/DELETE de dados) → preflight readonly → ligar `WHATSAPP_FINANCIAL_MUTATIONS_VERSION=2` → republicar.
4. Rollback: desligar o secret (efeito imediato na próxima publicação) bloqueia a função sem tocar dados; restauração de backup só em último caso (reverte dados posteriores).

## Permanece bloqueado
Período/mês, meses anteriores, reorganização completa, conciliação/saldo, comandos combinados, cartões/faturas/parcelas/recorrências/importadores: dependem dos writers vinculados e do baseline contábil ainda não implementados.
