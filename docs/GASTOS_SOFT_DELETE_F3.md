# F3 — Leitores de `gastos` filtram `deleted_at IS NULL` (NÃO PUBLICAR)

Status: código preparado no repositório. F2 (`docs/migrations-candidate/gastos-soft-delete-f2.sql`)
NÃO aplicada. **Este código não pode ser publicado antes da coluna existir** — sem ela, toda
leitura de gastos retorna erro (fail-closed; não há fallback que reexiba excluídos).

## Matriz de leitores (`.from("gastos")` em src/)

| Arquivo | Uso | Classe | F3 |
|---|---|---|---|
| lib/store.ts hydrate (Promise.all) | carga site/cache/offline | READ | filtrado |
| lib/store.ts refreshFinancialEntity | realtime/foco | READ | filtrado |
| lib/store.ts reclassificarCategoriasExistentes | leitura → UPDATE | READ | filtrado |
| lib/store.ts persistOfflineRows (offline_client_id) | dedupe offline | READ | EXCEÇÃO (precisa ver excluídos) |
| server/cartao-fatura (3 buscas + loadParcelasDoUsuario) | fatura/parcelas/limite | READ/AGG | filtrado |
| server/whatsapp-consultas, -consultas-especificas | consultas | READ/AGG | filtrado |
| server/finance-ai | análise IA | READ/AGG | filtrado |
| server/whatsapp-research | folga p/ compras | AGG | filtrado |
| server/whatsapp-comprovantes (sugestão categoria) | READ | filtrado |
| server/whatsapp-proactive-alerts, -finance-brief (dinâmico) | AGG | filtrado (gastos e receitas) |
| server/whatsapp-postlaunch (readFinancial, grupo, recibo) | READ | filtrado |
| server/whatsapp-fatura-escolha (gasto pendente) | READ→UPDATE | filtrado |
| server/whatsapp.server verificarGastoExiste | existência | filtrado (excluído = inexistente) |
| server/whatsapp.server dedupe 23505 | id determinístico | EXCEÇÃO |
| server/whatsapp-parcelamento readback | parcelas recém-criadas | EXCEÇÃO |
| server/upsell-eligibility (count) | critério de uso | EXCEÇÃO (excluído conta, como cota free_ads) |
| lib/privacy.functions (count LGPD) | exclusão definitiva | EXCEÇÃO |
| lib/contas.functions vínculo conta↔gasto | READ→UPDATE/DELETE | EXCEÇÃO PENDENTE F4 (filtrar duplicaria após restaurar) |
| routes/whatsapp.tsx duplicados / verEmGastos | READ | filtrado |
| lib/user-activity.functions (admin, tabela dinâmica) | histórico | EXCEÇÃO (atividade) — fora da guarda literal |

Escritores (insert/update/delete/upsert), hard-delete legado, undo e LGPD: inalterados.

## SQL NÃO VERIFICADO (definições remotas podem divergir do repositório)
`tg_free_ads_quota_gastos`/`assert_free_ads_quota` (devem continuar contando excluídos),
`execute_data_deletion_atomic` (deve apagar tudo), `import_extrato_atomic`,
`whatsapp_undo_recent_action`, `whatsapp_edit_recent_action`, `whatsapp_get_usage_snapshot`,
`create_installment_purchase`, `whatsapp_baixa_conta_atomic`. Revisar antes da F5.

## Tipos
`src/integrations/supabase/types.ts` é gerado e não tem as colunas. O filtro `.is("deleted_at", null)`
tipa sem cast. Após aplicar a F2, regenerar tipos; colunas esperadas em `gastos.Row`:
`deleted_at: string | null; deleted_by: string | null; deletion_batch_id: string | null; deletion_source: string | null`.

## Rollout seguro (não executado)
1. Backup testado com restauração. 2. Revisar SQL não verificado acima. 3. Aplicar F2 aprovada.
4. Confirmar colunas/trigger/grants no schema real. 5. Só então publicar este código. 6. F4/F5 com nova aprovação.
