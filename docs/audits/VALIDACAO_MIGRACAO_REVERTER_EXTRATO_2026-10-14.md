# Validação da migração `reverter_extrato_atomic` (14/10/2026)

Resultado: **APROVADA para implantação futura** (não aplicada). Nada publicado, nenhuma migração em produção, nenhum dado/flag/segredo/Meta alterado. Produção consultada só na estrutura (colunas, políticas), sem dados.

## Revisão do SQL (`docs/migrations-candidate/gastos-delete-atomic-f4.sql`)
- SECURITY INVOKER + `search_path=public`: a segurança por linha de cada tabela vale; `auth.uid()` nulo → `login_required`. EXECUTE revogado de PUBLIC/anon, concedido só a authenticated.
- `FOR UPDATE` no lote e nas 5 tabelas antes de decidir: serializa corridas; quem não tem permissão de edição não consegue travar → `extrato_not_found`.
- Lote com gasto excluído reversivelmente → bloqueia tudo. Receita excluída não é apagada.
- Toda divergência de contagem levanta exceção → rollback total da transação.
- Idempotente (`CREATE OR REPLACE`). Também cria `estornar_conta_gastos_atomic` (já não usada pela versão publicada; inofensiva).
- O cabeçalho cita "depende da F2"; a dependência real é só `gastos.deleted_at`, que **já existe** em produção. Colunas usadas conferidas em produção: `import_batch_id`, `created_at`, `updated_at` nas 5 tabelas; `deleted_at` em gastos/receitas; `status`/`reverted_at` em extratos_importados.

## Testes em PostgreSQL 16 descartável (sem rede, dados fictícios)
`PG_BIN=<postgresql16>/bin bash scripts/test-gastos-delete-atomic-sql.sh` → **44 verificações aprovadas, 0 falhas, "OK F4"**. Cobertura:
- normal, parcialmente editado (status `parcial`, editados mantidos, tolerância 5 s), replay idempotente;
- gasto excluído reversivelmente → bloqueado, nada apagado;
- falha injetada na 3ª tabela e no status → rollback total;
- 2 conexões simultâneas no mesmo lote → uma reverte, a outra idempotente;
- outro usuário, sem login, leitor sem permissão de edição → recusados, nada apagado;
- lançamento manual, parcelas de cartão e outro lote intactos (novo `30-complementar.sql`);
- versão publicada d1cda91b9 (DELETE sequencial, não usa a rotina) continua funcionando com a rotina instalada;
- rollback do banco `DROP FUNCTION` não toca dados (novo `40-rollback.sql`).

Outros: Agenda (4 arquivos, lembretes/recorrência/cancelamento) 90/0; prepub + RPC do extrato 15/0; suíte oficial 169 arquivos, 2.969/0; tsgo OK; build OK.

## Riscos restantes
- Stub ≠ produção: políticas de conta conectada (`can_admin_account`) e gatilhos reais não foram reproduzidos integralmente; os gatilhos da produção não ficaram visíveis com o acesso só de leitura.
- Um `DELETE` bloqueado por gatilho real faria o desfazer falhar inteiro (seguro, mas indisponível).
- Lotes antigos sem `import_batch_id` nos itens: nada a apagar → status `revertido` com 0 removidos.

## Ordem segura de implantação (requer autorização)
1. Aplicar **somente** `gastos-delete-atomic-f4.sql` (F2, UNDO e compras ficam fora).
2. Conferir que a rotina existe e que anon não a executa.
3. Com a versão publicada ainda no ar: nada muda (ela não chama a rotina).
4. Publicar a versão atual.
5. Pós-publicação: importar um extrato de teste numa conta de teste, editar um item, desfazer → `parcial`; desfazer um lote limpo → `revertido`.

## Reversão
- App: republicar d1cda91b9 (compatível com a rotina instalada).
- Banco (só se necessário): `DROP FUNCTION public.reverter_extrato_atomic(uuid);` — sem efeito em dados; o app atual volta a bloquear o desfazer sem apagar nada.

## Arquivos modificados
- `tests/sql/gastos-delete-atomic-f4/30-complementar.sql` (novo), `40-rollback.sql` (novo)
- `scripts/test-gastos-delete-atomic-sql.sh` (executa os dois novos)
- este relatório
