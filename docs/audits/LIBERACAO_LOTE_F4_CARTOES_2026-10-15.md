# Preparação de liberação: lote mensal, F2/F4 e cartões (15/10/2026)

Nada publicado e nenhuma migração aplicada. Nenhum dado, flag ou segredo de produção foi alterado. Nenhuma mensagem enviada à Meta.
Risco aceito pelo proprietário: existe uma exportação `.backup` anterior, mas ninguém testou restaurá-la. Não serve como garantia de recuperação.

## Produção (verificado só pela estrutura do banco, sem ler dados)
- Já existem: `gastos.deleted_at`, `receitas.deleted_at/deleted_source/deleted_reason`, `import_batch_id` nas 5 tabelas, `extratos_importados.reverted_at/status`, `contas_a_pagar.gasto_id/status/data_pagamento`, `has_feature_access`.
- Não existem: `wa_lote_mes_excluir`, `wa_lote_mes_restaurar`, `whatsapp_lote_mes_acoes`, `reverter_extrato_atomic`, `estornar_conta_gastos_atomic`, `tg_gastos_guard_soft_delete`.
- Gatilhos em gastos/receitas: apenas a cota free_ads, updated_at e validação de cliente.

## Diagnóstico
- O cabeçalho da F4 diz que ela "depende da F2". Isso está desatualizado: a F4 só usa `deleted_at`, que já existe em produção. Testada sem a F2: funciona.
- F2 continua INCOMPATÍVEL: o gatilho dela barraria a exclusão e a restauração (individuais e em lote) feitas pelo servidor. Ela não é necessária para o lote nem para a F4. Mantê-la pendente.
- Lote: `SECURITY INVOKER` com execução somente para service_role. O isolamento por usuário depende de `p_user_id`, que vem do vínculo verificado no servidor; toda consulta filtra por `user_id`. Há trava por usuário, conferência exata de IDs e `updated_at` e recusa de lote com parâmetros diferentes, e a restauração atinge só os IDs e o carimbo do lote.
- F4: `SECURITY INVOKER` mais RLS do chamador (authenticated). Sem a F4, desfazer extrato continua indisponível (falha fechada, sem apagar nada) e o estorno de conta segue sem a RPC atômica.

## Testes em PostgreSQL 17 descartável
- `scripts/test-whatsapp-lote-mes-sql.sh`: 33/0
- `scripts/test-gastos-delete-atomic-sql.sh` (F4 sobre F2): 44/0
- NOVO `scripts/test-combinado-lote-f4-sem-f2.sh` (formato atual da produção, lote + F4, sem F2, cada uma aplicada duas vezes): 40/0
- Limitações da simulação: tabelas e RLS reduzidas, `auth.uid()` simulado, sem os gatilhos de cota e sem a carga real.

## Hashes (inalterados)
- whatsapp-lote-mes.sql 9a87920d72e52a9d89d518c6f068e0831889e6717bea720cbc8fe4cb2a9e0153
- gastos-delete-atomic-f4.sql 559c8c2ddbac0c060ba3a5587865dec31a0dab0e2db6560d782fbf9e99fa1279

## Ordem proposta (cada passo exige autorização específica)
1. Aplicar `whatsapp-lote-mes.sql`. É aditiva; rollback = DROP das 2 funções e da tabela nova, sem tocar em lançamentos.
2. Aplicar `gastos-delete-atomic-f4.sql`. Rollback = DROP das 2 funções.
3. Publicar com `LOTE_MES_RELEASE_AUTHORIZED=false` e testar desfazer extrato com um extrato de teste.
4. Trocar a trava para `true`, rodar a suíte, publicar e testar com um mês que tenha só lançamentos de teste.
5. F2: não aplicar sem redesenhar o gatilho para aceitar as RPCs de lote e individuais.

## Cartões e faturas
- Inventário: cadastro por conversa e por Flow, limite, faturas atuais/futuras/detalhe, ciclo de fechamento, parcelamento atômico em centavos. Todos já tinham testes (354/0).
- Corrigido (P1): o cadastro de cartão escolhia uma linha qualquer de vínculo entre as variantes do telefone (com e sem 55). Uma linha antiga revogada podia recusar um usuário válido. Agora o cadastro exige um vínculo ativo deste usuário e falha fechado se o número estiver ativo também para outra pessoa. Teste: `tests/cartao-cadastro-vinculo-p1.test.ts` 3/0.
- Não refeito nesta rodada: auditoria completa, item por item, de todos os cenários pedidos (cartões homônimos, envio com 429/5xx, contas conectadas). A cobertura que já existia passa, mas não houve revisão nova desses pontos.
