# Auditoria complementar F3 — somente leitura (nada alterado)

Fontes usadas: leitura do código do repositório e consultas de METADADOS read-only (definições de funções, gatilhos, políticas, dono e permissões). Nenhum lançamento real foi lido; nenhuma função foi chamada.
Status: F3 INCOMPLETA, F2 NÃO APLICADA, nada publicado. Agora a prévia pode falhar ao carregar gastos (a coluna ainda não existe). O site publicado continua igual.

## A) Matriz por caminho / função

Fatos do schema real (CONFIRMADO):
- `public.gastos` tem 0 colunas `deleted_*`. Dono: `postgres`.
- Gatilhos: só `free_ads_quota_gastos` (no INSERT) e `trg_gastos_updated_at` (no UPDATE).
- 8 políticas (own + connected, uma para cada operação). Nenhuma view usa `gastos`.

| Função / caminho | Origem | O que faz com `gastos` | Situação após F2/F3 | Risco |
|---|---|---|---|---|
| `assert_free_ads_quota` / `tg_free_ads_quota_gastos` | CONFIRMADO | conta gastos do mês sem filtro de exclusão; o gatilho dispara só no INSERT | excluídos continuam contando; restaurar não conta de novo | nenhum (decisão mantida). Obs.: para receitas a cota filtra `deleted_at`, ou seja, receita excluída libera cota. Divergência herdada, fora do escopo |
| `execute_data_deletion_atomic` | CONFIRMADO | confere `p_user_id = auth.uid()` e apaga TODOS os gastos, inclusive os marcados | LGPD preservada | baixo: EXECUTE liberado para `anon`, mas recusado sem login. Sugestão futura: revogar `anon` |
| `import_extrato_atomic` | CONFIRMADO (sem SECURITY DEFINER) | a checagem de duplicata lê `gastos` sem filtro | um excluído continua bloqueando a reimportação da mesma operação, logo não ressuscita nem duplica | UX: o usuário não consegue reimportar a linha excluída. Documentar |
| reverter lote de extrato (`store.ts`, DELETE por `import_batch_id`) | REPO | exclusão física | apaga também os soft-deleted do lote | médio: um lote de exclusão restaurável perde linhas |
| `whatsapp_undo_recent_action` | CONFIRMADO (sem SECURITY DEFINER) | lê o gasto sem filtro, apaga fisicamente e reabre a conta | apaga de verdade um gasto já marcado | ALTO: perda definitiva do que era restaurável. Correção futura: `deleted_at IS NULL`, senão responde `unavailable` |
| `whatsapp_edit_recent_action` | CONFIRMADO | lê sem filtro e dá UPDATE | após a F2 o gatilho bloqueia (42501) e vira erro genérico | médio: falha segura, mas a mensagem é ruim. Correção: filtrar e responder `unavailable` |
| `whatsapp_baixa_conta_atomic` | CONFIRMADO (exige service_role) | só INSERT; conta paga com `gasto_id` vira `noop` | não confere se o gasto está excluído | baixo: não duplica |
| `create_installment_purchase` | CONFIRMADO (exige service_role) | só INSERT | sem impacto | nenhum |
| `bens_prevent_destructive_delete` | CONFIRMADO | conta gastos por `bem_id`, incluindo excluídos | preserva o histórico | nenhum |
| `whatsapp_get_usage_snapshot` | CONFIRMADO | não lê `gastos` | — | nenhum |
| leitores F3 de site e WhatsApp (16 arquivos) | REPO | `.is("deleted_at", null)` | — | ok, com as exceções documentadas |
| `user-activity.functions` (painel admin, tabela dinâmica) | REPO | lê sem filtro | histórico | fora da guarda textual |
| dono e permissões das RPCs da F2 depois de aplicadas | NÃO VERIFICADO | — | — | a checagem de dono da F2 falha se divergir |

## B) Vínculo conta ↔ gasto: diagnóstico causal

Caminhos (confirmados no código):
- Site: `marcarContaComoPago` e `desmarcarContaComoPago` (`store.ts`) chamam `markContaAPagarPaid` / `unmarkContaAPagarPaid` (`src/lib/contas.functions.ts`). A ligação vem de `contas_a_pagar.gasto_id`, de `id_operacao_banco = op(conta.id)` ou de uma busca aproximada (origem + valor + nome + no máximo 3 dias).
- WhatsApp: `whatsapp_baixa_conta_atomic` liga por `gasto_id`.
- Desfazer: `whatsapp_undo_recent_action` liga por `gasto_id`.
- `upsertGastoVinculadoConta` (local, no `store.ts`) não é usado por ninguém.

| Caso | Hoje (com a F2 aplicada e a exceção atual) | Risco | Comportamento seguro proposto |
|---|---|---|---|
| (a) conta paga gera X; (b) X é excluído em lote | a conta continua "paga" com `gasto_id=X`; X some das telas | o site mostra conta paga apontando para um gasto invisível | manter o vínculo; mostrar o aviso "gasto vinculado excluído — restaurar?" |
| (c1) pagar de novo a mesma conta | `findLinkedGastos` (sem filtro) acha X, tenta UPDATE e o gatilho bloqueia: erro, nada criado | sem duplicata, mas o erro é genérico | detectar X excluído e responder "restaure o gasto primeiro"; nunca recriar |
| (c1') se o filtro F3 fosse posto ali | não acha X, cria Y, `gasto_id=Y`; restaurar X dá dupla contagem | ALTO | por isso a exceção é correta |
| (c2) estornar (desmarcar) | `findLinkedGastos` acha X e o apaga fisicamente (o gatilho não cobre DELETE) | ALTO: destrói o que era restaurável; restaurar o lote volta com menos itens | recusar o estorno com gasto vinculado excluído, ou desvincular sem apagar; exige escolha explícita |
| (c3) editar o gasto X | bloqueado pelo gatilho | seguro | mensagem clara |
| (c4) desfazer pelo WhatsApp | a RPC apaga X fisicamente e reabre a conta | ALTO | filtro na RPC (precisa de mudança SQL com aprovação SEPARADA) |
| (d) X restaurado | volta a valer; vínculo intacto | ok se nada foi recriado | teste de não-duplicação |
| conta recorrente | cada ocorrência tem seu `gasto_id`; o gerador não lê `gastos` | NÃO VERIFICADO no gerador SQL/cron | o mesmo tratamento por ocorrência |
| fatura paga via conta | `faturas_cartao.valor_pago` é um snapshot que não depende dos gastos | a fatura pode mostrar pago maior que o total ativo | mostrar a diferença; não ajustar sozinho |
| parcela | a F2 bloqueia série cortada; o estorno da conta não envolve parcelas | baixo | — |

Recomendação: manter o vínculo mesmo com o gasto excluído. Nunca recriar, estornar ou apagar automaticamente. Bloquear pagar de novo e estornar com mensagem e ação explícita ("restaurar gasto" ou "desvincular sem apagar"). Corrigir `undo`/`edit` só por SQL aprovado separadamente.

## C) Lacunas bloqueantes, testes e sequência

Bloqueantes antes da F2 em produção:
1. Estorno de conta apaga gasto excluído (`contas.functions.ts`).
2. `whatsapp_undo_recent_action` apaga gasto excluído (SQL).
3. Reverter lote de extrato apaga excluídos.
4. `whatsapp_edit_recent_action` falha com erro genérico.
5. Site sem estado "gasto vinculado excluído".
6. Snapshot offline (`offline-snapshot.ts`) feito antes da exclusão pode mostrar o gasto até a próxima recarga.

Testes complementares (em ordem de prioridade, com dados fictícios):
- T-B1: pagar de novo uma conta com X excluído não cria gasto e o total não muda.
- T-B2: estornar com X excluído não apaga X e restaurar depois devolve X.
- T-B3: desfazer (fake da RPC) com X excluído responde `unavailable`.
- T-B4: restaurar X depois de pagar de novo não gera dupla contagem.
- T-C1: snapshot offline antigo é substituído na reconexão e o gasto excluído não reaparece.
- T-C2: reverter extrato não apaga excluídos de outro lote.
- T-C3: a guarda também cobre leitores dinâmicos (`from(table)`) e o painel admin.
- T-C4: exportação e relatórios a partir do cache filtrado.
- T-C5: fatura com `valor_pago` maior que o total ativo exibe a diferença.
- Teste SQL local: duas conexões concorrentes (exclusão contra restauração e contra estorno).

Checklist go/no-go (nada executado agora):
1. Backup real com teste de restauração comprovado.
2. Corrigir os itens 1–6 (código e SQL, cada um com autorização própria) e rodar os testes acima.
3. Validar dono, permissões, políticas e gatilhos reais compatíveis com a F2; teste concorrente local.
4. Aplicar a F2 só com nova autorização, em janela controlada.
5. Confirmar as colunas e gerar os tipos de novo.
6. Só então publicar a F3; fazer regressão do site e do WhatsApp; ter o plano de reversão (retirar os leitores antes de qualquer remoção de coluna).
7. F4 (fluxo autenticado no servidor, dupla confirmação) e F5 sob autorização.

## D) Declaração

AUDITORIA APENAS: nenhum código, documento, banco, dado, produção ou cliente foi alterado. Só houve leituras de metadados.

## E) Créditos

Não consigo confirmar.

Roadmap preservado: correções desta auditoria e F4/F5 só com nova autorização. Depois: cadastro conversacional de cartões; Assistente de Compras (SerpApi, 10 por pessoa/mês, 200 no total, renda média de 3 meses, alerta de parcela > 30% da folga, guardado intocado); templates Meta, cron e avisos por último. Botões depois de "Ajustar" e o teste com áudio real continuam pendentes.
