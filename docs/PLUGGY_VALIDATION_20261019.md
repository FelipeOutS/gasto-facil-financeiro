# Evidências locais — Pluggy — atualizado em 20/10/2026

- TypeScript: aprovado (tsc --noEmit).
- Build final: aprovado; avisos de tamanho/depreciação/empacotamento não impedem compilação.
- Pluggy: **156 aprovados, 0 falhas, 0 skips**, 12 arquivos isolados; mais 3 testes de interface de consentimento aprovados separadamente (159 no total, 13 arquivos).
- SQL: **21 etapas aprovadas** em PGlite descartável: estrutura, RLS/permissões, leases, primeira importação, lote fechado, desfazer parcial, automação restrita e vínculo real. Nenhum acesso a banco externo.
- Suíte geral de 20/10: **281 arquivos, 4.174 aprovados, 0 falhas, 21 skips e 0 errors**. Depois, 3 testes novos de interface passaram separadamente; não estão incluídos no total global. Alterações posteriores à partida da suíte foram revalidadas na suíte Pluggy e SQL.
- Primeira tentativa geral falhou por ausência local de @testing-library/dom; dependência peer instalada sem alterar manifest. A execução de 281 arquivos acima já inclui a correção.
- Lint geral: **reprovado**, 289.597 erros e 141 avisos, predominantemente Prettier/CRLF; não foram feitas alterações globais de formatação fora do escopo. Lint dos arquivos alterados, com a regra exclusivamente estética prettier/prettier desabilitada: **0 erros, 2 avisos**. Isso NÃO equivale a lint global aprovado.
- Não realizados: SQL nativo com sessões concorrentes; teste autenticado de interface/celular; entregas autenticadas do provedor; migrações/financeiro reais. Runner PGlite não executa 40-import/41-f4/42-race e não demonstra comportamento sob concorrência real.

## Migrações candidatas e SHA-256

Hashes dos bytes locais entregues; conferir novamente no artefato aprovado antes da aplicação, pois conversão de fim de linha altera SHA-256. Nenhuma aplicada em produção.

| Arquivo | SHA-256 bytes locais | SHA-256 normalizado LF |
|---|---|---|
| pluggy-real-batch-import.sql | `8cfc7f20b6803e62ab7563779152386046a915338134031808d849d03d341ea1` | `3038a110b183d1c5d6ca867172c0ab2eb51880a90a6dc18f0e37fe3865bdc2c0` |
| pluggy-real-batch-partial-undo.sql | `47fbc20fc73ed1394d386e076ea89388d71893378a2d6bc9872494869ed0fb84` | `a4b76f430d28f9641f28f864e0242ba38196eb580fdbc3ed16350291b5e9514e` |
| pluggy-real-automatic-closed-batch.sql | `1cfc2afb42b9816ae518872c7f1d474d2f1dbff82f10427026116d92050469e7` | `1cfc2afb42b9816ae518872c7f1d474d2f1dbff82f10427026116d92050469e7` |
| pluggy-real-card-links.sql | `07701e0c39bbe4359695e178cac86caee10917968bb3fd16d3f8108e40a05bab` | `e4ccdd6d843538887fdcc0188f530ee33d48470791a5cc94fb9a74d373d1d183` |
| pluggy-real-card-batch.sql | `26952baa5b642fbb5e02598d7183bf9be77262896e4fc402f9e88f36c670bec4` | `26952baa5b642fbb5e02598d7183bf9be77262896e4fc402f9e88f36c670bec4` |
| pluggy-webhook-claim-max-attempts.sql | `2ab0c695848002033e0cc52b5f0fa7c74d584d10f96bdf6c154a62d4eb76f223` | `91b28f33369f7a25d979882dd238f041f660b636ac442ee899d8f728f89245de` |

Ordem: verificar schema real/primeira importação já aplicada → lote fechado apenas se ausente → partial-undo e automatic-closed-batch → real-card-links → real-card-batch. max-attempts depende da fila original e pode ser homologada separadamente. A candidata real-card-links adiciona bill_id/bill_due_date e troca SOMENTE a validação do vínculo; não concede importação de compras reais. A candidata real-card-batch amplia a função de lote para cartão com grant exato; não cria grants. O SHA LF do lote original permanece 3038a110b183d1c5d6ca867172c0ab2eb51880a90a6dc18f0e37fe3865bdc2c0, igual ao conteúdo versionado; a diferença do hash local é CRLF. Nenhuma candidata cria autorização financeira literal.

## Arquivos da entrega

- `docs/PLUGGY_COMPLETION_20261019.md`
- `docs/PLUGGY_VALIDATION_20261019.md`
- `docs/migrations-candidate/pluggy-real-automatic-closed-batch.sql`
- `docs/migrations-candidate/pluggy-real-batch-partial-undo.sql`
- `docs/migrations-candidate/pluggy-real-card-batch.sql`
- `docs/migrations-candidate/pluggy-real-card-links.sql`
- `docs/pluggy-audit-readonly-20261019.sql`
- `scripts/test-pluggy-pglite.ts`
- `src/components/PluggyAutomatic.tsx`
- `src/components/PluggyRealCards.tsx`
- `src/components/PluggyRealPreview.tsx`
- `src/components/PluggyRealUndo.tsx`
- `src/lib/pluggy/automatic.functions.ts`
- `src/lib/pluggy/import-plan.ts`
- `src/lib/pluggy/import-preview.ts`
- `src/lib/pluggy/real-cards.functions.ts`
- `src/lib/pluggy/real-import.functions.ts`
- `src/lib/pluggy/real-preview.ts`
- `src/lib/pluggy/reconciliation.ts`
- `src/lib/pluggy/rules.ts`
- `src/routes/api/public/pluggy.worker.ts`
- `src/routes/app_.integracoes.open-finance.tsx`
- `src/server/pluggy/pluggy-api.server.ts`
- `src/server/pluggy/pluggy-import-store.server.ts`
- `src/server/pluggy/pluggy-import.server.ts`
- `src/server/pluggy/pluggy-real-automatic.server.ts`
- `src/server/pluggy/pluggy-store.server.ts`
- `src/server/pluggy/pluggy-sync.server.ts`
- `src/server/pluggy/pluggy-webhook-queue.server.ts`
- `tests/pluggy-automatic-ui.test.tsx`
- `tests/pluggy-completion.test.ts`
- `tests/pluggy-import-wiring.test.ts`
- `tests/pluggy-open-finance.test.ts`
- `tests/pluggy-real-automatic.test.ts`
- `tests/pluggy-webhook-queue.test.ts`
- `tests/sql/pluggy/70-partial-automatic.sql`
- `tests/sql/pluggy/80-real-cards.sql`
- `tests/sql/pluggy/90-real-card-batch.sql`
