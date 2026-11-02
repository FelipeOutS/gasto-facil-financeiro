# Preparação de publicação segura — Caminho B (14/10/2026)

Produção: d1cda91b9 · Base desta rodada: d369f4925. Nada publicado, nenhuma migração, banco/dados/flags/segredos/Meta intocados. Consultas ao banco: só estrutura (information_schema/pg_proc), nenhum dado.

## 1. Arquivos modificados
- `src/server/shopping/whatsapp-shopping.server.ts` — trava `SHOPPING_RELEASE_AUTHORIZED = false` + `deps.releaseAuthorized` (só testes).
- `tests/prepub-shopping-release-lock.test.ts` (novo, 5 casos).
- `tests/prepub-extrato-revert-failclosed.test.ts` (novo, 2 casos).
- Este relatório.

## 2. Correções
### Objetivo 1 — Assistente de Compras: CONCLUÍDO
- Interpretação anterior: ativo somente se `WHATSAPP_SHOPPING_ENABLED === "true"` **e** userId na allowlist `WHATSAPP_SHOPPING_PILOT_USER_IDS`. Ausente/inválida → desligado. No ambiente as três configurações estão definidas, e as RPCs `whatsapp_shopping_reserve`/`whatsapp_shopping_context_get` **existem** no banco → ao publicar, os usuários piloto teriam o recurso real (SerpApi paga).
- Agora: com o ambiente real (`process.env`), nada roda enquanto a constante for `false`, independente da flag. Única entrada é `handleWhatsAppShopping` (texto e botões `shopping_link_*`/follow-up passam por ela). Código preservado; ativar = trocar a constante, com autorização, em diff revisável.

### Objetivo 2 — Desfazer importação de extrato: BLOQUEADO (sem restauração)
Versão publicada (`revertExtratoImportadoSeguro`, d1cda91b9 store.ts:4841-4930) faz DELETEs sequenciais por tabela, sem transação:
- falha parcial: tabelas anteriores já apagadas, o status do lote não é atualizado (erro só logado);
- concorrência: decide "editado" pelo `updated_at` em memória — edição feita em outro aparelho depois do carregamento é apagada;
- apaga fisicamente gastos soft-excluídos do lote (impede restauração).
Essas propriedades não podem ser garantidas sem transação no banco. Pela regra da missão, o fluxo antigo **não** foi restaurado. Comportamento atual mantido: só RPC `reverter_extrato_atomic`; ausente → nada é apagado, tela mostra falha.
Alternativas (exigem autorização): (a) aplicar `docs/migrations-candidate/gastos-delete-atomic-f4.sql` após teste em banco descartável (`tests/sql/gastos-delete-atomic-f4/`); (b) aceitar temporariamente a indisponibilidade do desfazer.

## 3. Testes (números reais)
- Focados: `bun test tests/prepub-*.test.ts tests/whatsapp-shopping-*.test.ts tests/extrato-revert-atomic-rpc.test.ts` → 134 aprovados, 0 falhas (12 arquivos).
- Suíte oficial `node scripts/test-whatsapp.mjs` → 169 arquivos, 2.969 aprovados, 0 falhas, 72,96s (os 2 testes prepub ficam fora do glob do runner; rodados acima). P0 anteriores (1.950, Pix 100×, entrega sem reenvio, botões, timeouts) cobertos e verdes.
- `bunx tsgo --noEmit` OK; build OK.

## 4. Compatibilidade com o banco atual
Diff d1cda91b9..atual em `src`: novas variáveis lidas só `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BOLETO_FINGERPRINT_SECRET` (ambas configuradas). Tabelas referenciadas novas no diff existem (agenda_items, whatsapp_plan_quotas, recorrencias, whatsapp_messages, contas_a_pagar, cartoes). RPCs: `import_extrato_atomic` e shopping existem; `reverter_extrato_atomic` ausente (fail closed). Nenhuma migração necessária para publicar.

## 5. Ainda bloqueado
- Desfazer importação de extrato (depende da RPC candidata).
- Recuperação durável de respostas não entregues (outbox candidata).
- Reenvio automático: desativado por segurança.
- Assistente de Compras: travado em código.

## 6. Outros riscos nos 250 commits
- Nenhum arquivo de autenticação, pagamentos, planos, papéis ou `start.ts` alterado (`git diff --stat` filtrado).
- Agenda pelo WhatsApp mudou (agenda.server.ts, whatsapp-agenda.server.ts, agenda-confirm-token.server.ts, usa o segredo de assinatura já configurado) — mudança de comportamento real; validar no pós-publicação.
- Única regressão visível ao usuário: desfazer extrato passa de "funciona (inseguro)" para "indisponível".

## 7. Classificação
APTO COM RESTRIÇÕES — publicação integral possível **se** o dono aceitar a indisponibilidade temporária do desfazer de extrato; caso contrário, aplicar antes a migração candidata (autorização). Aguardando autorização explícita; não publicado.
