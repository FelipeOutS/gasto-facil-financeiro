# Pluggy — Fase 3, implementação conectada

## Validação posterior dos vínculos (19/10/2026)

Distribuição confirmada por leitura: **40 = 16 despesas bancárias + 15 compras de cartão + 5 receitas + 3 pagamentos de fatura ignorados + 1 boleto em revisão**. As 15 revisões adicionais não mudam a natureza dos movimentos: faltava vínculo de cartão confirmado. A prévia original permanece 16/5/16/3; a simulação com cada uma das duas opções próprias (Mercado pago: fecha 5/vence 11; Nubank: fecha 25/vence 5) retornou 31/5/1/3, sem salvar associações, sem duplicações candidatas detectadas nesse conjunto. Isso não confirma que algum desses cartões seja o Mastercard fictício 9437.

Ajustes reais desta validação: `src/lib/pluggy/import-preview.ts` (simulação pura validada contra cartões/contas do titular e motivos), `import.functions.ts` (simulação somente na prévia, metadados, desvínculo bloqueado), `PluggyImportPanel.tsx` (instituição/nome/final, opções, vínculo salvo, simulação identificada, destinos/categorias/fatura/matches das 40), rota Open Finance (instituição por item), `import-plan.ts` e adapter (cartão anterior preservado quando vínculo muda/some), SQL candidato e testes SQL (active, desvínculo sem DELETE, lock compartilhado, guard de compras anteriores), `tests/pluggy-import-preview.test.ts` (6 regras concretas), regras locais e roadmap.

Vínculo/desvínculo persistentes continuam bloqueados, dependentes de SQL e autorização; **somente simulação foi homologada no aplicativo**. SQL mantém três tabelas/cinco funções: `pluggy_link_card(..., NULL)` desativa vínculo, não exclui registro. Correção aplica-se a compras novas; compras anteriores não mudam de cartão/fatura e updates/removes via incremental entram em conflito/revisão. Movimentar compras antigas ou restaurar mutações incrementais não está implementado.

Validação desta continuação: 98 testes focados/0 falhas; 110 verificações SQL em banco descartável; Preview autenticado, duas opções próprias, original/simulação/retorno à original, importação e vínculo persistente desabilitados, nenhum erro JavaScript. Suíte oficial teve 4.122 aprovados/1 falha/9 skips (timeout do cofre); arquivo isolado passou 24/0. Harness registrou build OK. Leitura antes/depois: 278 gastos, 215 receitas, 11 cartões, 751 registros MP, zero despesas/receitas Pluggy, tabelas candidatas ausentes. Contagens são evidência complementar, não comparação byte a byte dos dados reais; nenhuma operação de escrita real foi chamada.

Créditos consultados: saldo 145,37; uso agregado do projeto desde 19/10 reportado 113,103966946 no momento da consulta. **Consumo exclusivo desta solicitação não confirmado** (não confundir agregado com custo da tarefa).

## Resultado e limite de autorização

Motor ligado à tela Open Finance e aos pontos de sincronização, mas **gravação financeira continua bloqueada** por `PLUGGY_IMPORT_RELEASE_AUTHORIZED = false`. Somente prévia read-only foi executada no aplicativo autenticado. Nenhuma migração, publicação, ativação de worker/Live/agendamento ou chamada de escrita financeira foi realizada nesta tarefa. Não houve alteração de secrets/flags de ambiente, envio Meta ou criação de backup.

As regras de `src/server/pluggy/AGENTS.md` continuam válidas. Os dois UUIDs e o papel owner são verificados novamente no servidor; os novos reads da interface usam cliente autenticado/RLS, sempre com `user_id`. O navegador não fornece userId, ações financeiras calculadas ou autorização de release.

## Arquivos efetivamente alterados/criados nesta continuação

- `src/server/pluggy/pluggy-import-store.server.ts`: adaptador paginado, leituras scoped/RLS e escritores somente RPC; tabelas candidatas ausentes permitem prévia conservadora, não gravação.
- `src/lib/pluggy/import.functions.ts`: chamadas autenticadas de prévia, confirmação de histórico, vínculo, revisão auditada, reset de decisão, desfazer e consentimento automático individual. Todos os comandos mutantes falham antes de carregar o cliente privilegiado enquanto bloqueados.
- `src/components/PluggyImportPanel.tsx`: prévia, cartão existente, confirmação, fila com descrição/ID real, histórico, desfazer e consentimento automático, com trava derivada do servidor.
- `src/routes/app_.integracoes.open-finance.tsx`: painel integrado e correção de categoria com accountId+transactionId.
- `src/routes/api/integrations.pluggy.$action.ts`: categoria scoped por conta; revisão legada sem auditoria bloqueada.
- `src/server/pluggy/pluggy-import.server.ts`: hook incremental que retorna imediatamente enquanto bloqueado.
- `src/server/pluggy/pluggy-sync.server.ts`, `pluggy-webhook-queue.server.ts`: chamam hook após staging bem-sucedido e após marcação de transações removidas, antes de confirmar processamento; nenhuma ativação de worker.
- `src/lib/pluggy/import-plan.ts`: pendentes anteriormente importadas e mudança de data de cartão vão para revisão; timestamp protege outras edições manuais.
- `src/lib/types.ts`, `src/lib/store.ts`: preservam tipo de origem Pluggy no histórico e impedem sua reversão pelo fluxo genérico de extratos.
- `docs/migrations-candidate/pluggy-import-gi.sql`: SQL candidato reforçado, **não aplicado**.
- `scripts/test-pluggy-sql.sh`, `tests/sql/pluggy/40-import.sql`: fixtures temporárias fora do checkout e novos testes de segurança.
- `tests/pluggy-import-wiring.test.ts`: novos testes de adapter/isolamento/paginação/trava/pendência/edição.
- `src/server/pluggy/AGENTS.md`, `roadmap.md`: decisões e pendências atualizadas.

Motor, fixture de 40 movimentos e testes originais permanecem em `src/lib/pluggy/import-plan.ts`, `tests/fixtures/pluggy-sandbox-40.json` e `tests/pluggy-import-plan.test.ts`.

## Vínculo com módulos existentes

As RPCs candidatas criam despesas em `gastos`, entradas em `receitas` e lotes em `extratos_importados`. Origem `pluggy`, conta+ID original em `id_operacao_banco`, data/valor/descrição originais e batch ficam registrados; não há segundo livro financeiro. `pluggy_import_entries` é somente rastreabilidade e snapshot, não substitui os módulos financeiros.

Cartões devem ser escolhidos entre os cartões do titular; não são criados automaticamente. Fechamento e vencimento vêm do cartão existente, com competência calculada pelo helper compartilhado e revalidada no SQL. Compra no fechamento e alteração posterior de data do cartão vão para revisão. Parcelas fornecidas ficam como observação; nenhuma parcela futura é inventada. Pagamentos de fatura não viram despesa; estornos/créditos de cartão não viram receita automática.

## Deduplicação, conciliação e revisão

- Identidade composta usuário+conta+transação, lock por titular e replay por batch impedem duplicação entre tentativas.
- Mercado Pago continua conciliado pelo staging existente. Possíveis matches e coincidências com outras origens entram em revisão; nenhuma das 751 entradas é excluída nem descartada por mera data/valor.
- Adapter lê todo o ledger paginado, incluindo ±1 dia nas bordas; não trunca silenciosamente após 1000 registros.
- Correção manual de categoria prevalece. Sem categoria existente, revisão — nunca primeira opção da lista.
- Revisão usa RPC auditada, accountId+transactionId e permite decisão legítima/duplicada/reset. O reset de uma decisão anterior permanece acessível. Aprovação não força transação tecnicamente inelegível a virar despesa/receita.
- Transferências próprias/faturas com evidência permanecem ignoradas; ambiguidades e estornos continuam exigindo resolução conservadora/manual. Não foi implementado um editor que transforme arbitrariamente estorno/transferência em lançamento financeiro.

## Histórico, incremental e desfazer

Histórico é recalculado no servidor após confirmação; nenhum plano financeiro enviado pelo cliente é executado. Um batch permanece estável na tela durante retries. Incremental exige liberação global e consentimento individual; após staging, o planner determina somente novas ações elegíveis e as RPCs aplicam tudo em uma transação. Falhas propagam para processamento com retry; identidade de origem evita recriação.

Desfazer é soft-delete, limitado aos registros criados por aquele batch, de origem Pluggy e não editados. Timestamp + snapshot protegem inclusive edição de observação/cartão. Outras origens, usuários e Mercado Pago são preservados. Replay não exclui outra vez.

**Limitação explícita:** desfazer não restaura valores anteriores de updates/removes de batches incrementais. Isso requer journal de mutações e uma nova aprovação de SQL; o botão não oferece desfazer para batches sem inserções. Antes de liberar F4 genérica futuramente, `reverter_extrato_atomic` também precisa rejeitar tipo Pluggy no servidor: hoje a proteção foi adicionada no fluxo do app, mas a candidata F4 foi deixada intacta por estar fora desta autorização.

## Verificação

- SQL descartável local: **107 verificações aprovadas**, incluindo 31 despesas/5 receitas, pagamentos de fatura ignorados, boleto fora, rollback integral em falha, replay, isolamento, competência adulterada, constraint Sandbox, updates pendentes recusados, remoções injustificadas recusadas e proteção de edições de observação. As 751 entradas de Mercado Pago e outras origens foram preservadas por comparação de hashes **no banco descartável**.
- Testes focados: **92 aprovados, zero falhas**.
- Suíte oficial final: **4.117 aprovados, zero falhas, 9 skips**, em 274 arquivos. Uma execução anterior teve 3 timeouts; os dois arquivos passaram separados (30/0) e a suíte completa posterior passou.
- Harness automático registrou `build OK` após os ajustes; nenhum build/typecheck manual foi executado.
- Fluxo real autenticado no localhost: prévia mostrou **16 gastos, 5 receitas, 16 revisões, 3 ignorados**, nenhum update/remove. As 15 compras de cartão estão em revisão por vínculo ausente; o boleto também permanece em revisão. Estrutura candidata ausente e gravação bloqueada foram mostradas; botão de importação desabilitado, sem erros JavaScript. No celular, sem overflow horizontal.
- Testes de gravação pelo app real não foram executados: seriam contrários à proibição de alterar finanças compartilhadas. Vínculo, revisão e histórico mutantes estão preparados, não homologados no banco compartilhado.

## SQL e pendências de ativação

SQL completo separado: `docs/migrations-candidate/pluggy-import-gi.sql` (3 tabelas de apoio, 5 funções, RLS/GRANT/revogações). Esta versão contém reforços de segurança adicionais e exige nova revisão/aprovação; não é autorização para aplicação.

1. Aprovar separadamente o SQL candidato e quaisquer correções de reversão antes de aplicar.
2. Confirmar vínculo de cartão e homologar as escritas em ambiente autorizado.
3. Autorizar release de gravação/consentimento automático separadamente.
4. Worker/agendamento/retry SQL e bancos Live seguem dependentes de autorização própria; nada foi ativado aqui.
5. Reversão de mutações incrementais e tratamento financeiro explícito de estornos/transferências ambíguas permanecem limitações, não funcionalidades prometidas.

Não consultei nem alterei diretamente o banco financeiro real por ferramentas nesta continuação; a leitura foi pelo aplicativo autenticado. Os números históricos 278/215/11/751 não foram recontados nesta tarefa. **Nenhuma escrita financeira foi executada e nada foi publicado.** Consumo exato de créditos não confirmado.