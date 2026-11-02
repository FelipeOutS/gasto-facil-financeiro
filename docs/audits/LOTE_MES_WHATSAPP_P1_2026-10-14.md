# P1 — Exclusão/restauração de um mês inteiro pelo WhatsApp (14/10/2026)

Não publicado. Nenhuma migração aplicada. Nada alterado em banco real, flags, segredos ou Meta.

## Estado
- Código: `src/server/whatsapp-lote-mes.server.ts` (novo), ligado em `whatsapp.server.ts` antes do fluxo individual; botões `wa_lm:` preservados em `whatsapp-interactive.server.ts`.
- TRAVADO: `LOTE_MES_RELEASE_AUTHORIZED = false` → o pedido responde "ainda não está disponível, nada foi alterado" (não cai no individual nem no cadastro).
- SQL candidato: `docs/migrations-candidate/whatsapp-lote-mes.sql` (tabela `whatsapp_lote_mes_acoes` só com IDs + RPCs `wa_lote_mes_excluir` / `wa_lote_mes_restaurar`, EXECUTE só service_role).

## Testes
- `tests/whatsapp-lote-mes-p1.test.ts`: 21/0.
- `scripts/test-whatsapp-lote-mes-sql.sh` (PostgreSQL 17 descartável): 29/0 (inclui rollback por falha no meio, corrida de 2 conexões, edição concorrente do site).
- Suíte oficial: 177 arquivos, 3.055 aprovados, 0 falhas. tsgo OK.

## Compatibilidade F2
A F2 candidata cria o gatilho `gastos_guard_soft_delete`, que recusa mudança de `deleted_at` fora das RPCs da própria F2. Se a F2 for aplicada, a exclusão em lote (e também a exclusão/restauração individual de gastos já em produção) passa a falhar com 42501 → rollback, nada alterado (fail closed). Não aplicar F2 sem revisar os três fluxos juntos.

## Ativação (somente com autorização)
1. Cópia de segurança confirmada.
2. Aplicar `whatsapp-lote-mes.sql` (idempotente).
3. Trocar `LOTE_MES_RELEASE_AUTHORIZED` para `true`, rodar suíte, publicar.
4. Teste real com mês de poucos lançamentos de teste.

## Revisão final P1 (14/10/2026)
- Prévia de restauração filtra `deleted_at = deleted_stamp` do lote (item restaurado e re-excluído por outra operação não aparece).
- `wa_lote_mes_excluir` com batch existente: parâmetros divergentes (tipo/ano/mês/IDs) → `lote_parametros_divergentes`; lote restaurado → `already_restored` (count 0); replay → count 0. App nunca diz "excluí" nesses casos.
- SQL candidato SHA-256: 9a87920d72e52a9d89d518c6f068e0831889e6717bea720cbc8fe4cb2a9e0153. Continua NÃO aplicado; `LOTE_MES_RELEASE_AUTHORIZED=false`.
