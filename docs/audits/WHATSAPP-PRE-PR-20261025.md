# WHATSAPP — revisão de riscos antes do PR — 25/10/2026

**NÃO APTO PARA PR.** Este parecer substitui qualquer interpretação de aprovação dos testes do relatório anterior. A revisão é local; não houve push, merge, deploy, envio de WhatsApp, alteração de segredos ou execução no banco real.

## Bloqueios encontrados

1. **Desfazer v2 incompatível com F2.** `whatsapp-undo-soft-delete.sql` altera somente `gastos.deleted_at`. A candidata `gastos-soft-delete-f2.sql` exige deleted_at/deleted_by/deletion_batch_id/deletion_source coerentes e protege esses campos por trigger. O teste nativo agora aplica as seções reais 1–3 de F2 (colunas, constraints, índices e trigger) e reproduz `gastos_soft_delete_fields_protected`. Não representa homologação das RPCs completas de F2. A transação malsucedida preserva o gasto. As fixtures anteriores não continham esse contrato e produziram uma confiança indevida.
2. **Exclusão/restauração individual também incompatíveis.** `whatsapp-editar-antigo.server.ts`, linhas 468 e 492, envia apenas deleted_at/updated_at. Reproduzidos ambos os patches contra o guard real de F2. Edição de descrição de gasto ativo segue permitida no ensaio. Não é possível afirmar ausência de regressões de gastos/receitas apenas com mocks: falta compatibilizar RPCs autorizadas, marcadores, CAS, autorizações, restauração e contratos reais de receitas. Não enfraqueci o trigger nem troquei indiscriminadamente SECURITY INVOKER por DEFINER.
3. **Árvore de dependências inválida:** `npm ls --all --json` retorna ELSPROBLEMS. Miniflare 4.20260410.0 é exigido exatamente por @cloudflare/vite-plugin 1.32.2 e wrangler 4.82.2, mas `nitro/node_modules/env-runner` 0.1.16 pede peer ^4.20260515.0. Não é uma alteração introduzida pelo diff Seroval; ainda assim precisa de resolução e validação antes de aprovar esta entrega. Não forcei atualização global ou audit fix.
4. `npm audit --omit=dev`: 0 críticos, 13 altos, 3 moderados e 1 baixo. Contagem de dependências/advisories, não prova de exploração. A atualização Seroval não torna toda a árvore livre de alertas.

## TRUNCATE — candidata independente

`public-revoke-truncate.sql` revoga TRUNCATE das tabelas públicas existentes para PUBLIC, anon e authenticated. Corrige defaults globais e no schema public para postgres e supabase_admin, com transação, timeouts e pós-condições. As revogações globais afetam futuras tabelas desses criadores também em outros schemas: necessário porque grants globais não são anulados por revogação apenas por schema. Não altera SELECT/INSERT/UPDATE/DELETE, RLS, dados ou service_role. A reexecução é idempotente. Se herança/ownership continuar dando acesso, aborta toda a transação; não modifica silenciosamente papéis herdados.

O número 84 é o achado informado pelo titular; não reconsultei produção. O teste cria exatamente 84 tabelas em um cluster novo de PostgreSQL 17, comprova acesso anterior dos dois papéis, aplica a candidata duas vezes, testa tabelas futuras de ambos os criadores, nega TRUNCATE efetivo, preserva CRUD/linha original/service_role e comprova aborto por grant herdado. O teste usa somente loopback/porta aleatória e apaga apenas seu próprio cluster temporário.

`public-truncate-prepost-readonly.sql` contém inventário e conferência para execução futura pelo operador autorizado. Resultado esperado: nenhum acesso efetivo desses papéis e nenhum default TRUNCATE indevido; agrupamentos sem ocorrências podem retornar zero linhas. Verificar TODOS os criadores reais além dos dois cobertos. Não foi executado remotamente.

Fonte: https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html

## Diff da branch

Base de comparação: a1ea7ea283760657bc55a1e5c9d536281f977ef5. Commits anteriores locais: efe4b8ae61457e2426aa1201d0d0b8b934732aeb e e37608852e675dd9cccf14fa9180bfe1efee3195.

Package e ambos os locks mudam Seroval/seroval-plugins de 1.5.6 para 1.6.3. Sem mudança de Vite/TanStack nessa revisão. Sem arquivos Pluggy alterados, sem alterações em supabase/migrations; SQLs novos ficam em docs/migrations-candidate. Isso não elimina efeitos indiretos de dependências compartilhadas: testes financeiros/Pluggy fazem parte da reexecução. Inventário completo de caminhos desta branch acompanha este relatório em WHATSAPP-PRE-PR-ARQUIVOS-20261025.txt.

## Meta v25.0 e configuração

Código central autoriza somente v25.0 e falha fechado quando a variável está ausente/inválida. Reconsulta pública à página oficial em 25/10/2026 via HTTP retornou 200: v25 lançado em 18/02/2026, validade 29/07/2028; v26 é a versão mais recente. v25 é o alvo deliberado desta branch, não a versão mais recente. O navegador de pesquisa recebeu 429; a confirmação veio do HTML público, sem credenciais. Fonte: https://developers.facebook.com/docs/graph-api/changelog/versions/

A compatibilidade local de URL/transporte não substitui teste com WABA, permissões do token, número, mídia, callbacks e templates aprovados. Não alterei WHATSAPP_GRAPH_VERSION no servidor. Não registrar token em logs, comandos, relatórios ou screenshots.

## Plano coordenado — somente depois de resolver bloqueios e obter autorização

1. **Pré-condições:** novo parecer aprovado, SHA revisado, build reproduzível e árvore de dependências válida. Conferir flags e jobs efetivos com operador; preservar outbox, Shopping, exclusão mensal, cron e disparos automáticos desligados. Não alterei nem certifiquei remotamente o estado atual desses serviços.
2. **Segurança independente:** com aprovação SQL específica, capturar ACLs/defaults/owners e backup; executar pré-check somente leitura; aplicar apenas public-revoke-truncate.sql em transação; conferir acesso efetivo e operações CRUD legítimas depois. Se falhar, transação reverte. Não usar GRANT ALL como rollback nem restaurar TRUNCATE público. Investigar herança explicitamente.
3. **SQL funcional:** corrigir primeiro o contrato F2/v2 e testar esquema completo descartável com concorrência, receitas, séries, edições manuais e restauração. NÃO aplicar a atual candidata undo como solução pronta. Depois de nova aprovação, migração compatível deve preceder obrigatoriamente a promoção do código que chama v2. Conferir assinatura, ACL, owners, triggers e respostas da RPC no ambiente de homologação. Não existe fallback autorizado para exclusão física antiga.
4. **Outbox:** SQL separado, não implica ativação. Mesmo com tabelas prontas, manter código/flag/env bloqueados: commit financeiro e enqueue ainda não são atômicos. Aprovação específica futura para integração e canário. Nunca repetir entrega ambígua automaticamente.
5. **Templates:** candidata Agenda separada cria rascunhos inativos; revisão Meta de nome/idioma/categoria/variáveis e aprovação não equivale a permitir envio. Conferir catálogo aprovado sem habilitar scheduler ou disparar mensagens.
6. **Código e variável:** após aprovação futura de envio ao GitHub/PR e implantação, preparar release imutável; sem tráfego de saída durante a troca, configurar somente WHATSAPP_GRAPH_VERSION=v25.0 pelo painel seguro no mesmo ciclo da nova versão, reiniciar/recarregar todas as instâncias e verificar configuração efetiva sem segredos. Evitar instâncias antigas e novas emitindo simultaneamente. Não mudar versão global no painel Meta sem revisão separada. Não publicar código v2 antes do SQL corrigido.
7. **Pós-deploy/Preview/celular:** testar autenticação, vínculo, opt-in/plano, edição/CAS, desfazer e restauração com conta/dados de homologação autorizados; validar mídia, callback duplicado/fora de ordem, template e janela. Comparar quantidades/valores e audit trail antes/depois, sem operar dados reais nesta tarefa. Envios reais exigem autorização explícita e destinatário de teste. Só depois avaliar canário manual de cada recurso; os bloqueados permanecem desligados.
8. **Rollback:** suspender saída/recurso ao primeiro erro; preservar staging, filas e evidências. Reverter código apenas para SHA comprovadamente compatível com o schema/versão Graph suportada. Não retornar automaticamente a Graph v20 (expirada), ao undo físico, nem apagar tabelas/dados para reverter. SQL aditivo fica inativo; correção progressiva revisada. Permissões TRUNCATE continuam revogadas. Não reenviar respostas ambíguas ou reprocessar lançamentos durante rollback.

Não há promoção automática executada por esta tarefa. A ordem acima é condição operacional, não garantia técnica de que um operador externo não publicará fora de ordem. GitHub/Lovable devem continuar sem promoção até nova aprovação.

## Pendência para novo parecer

Compatibilizar exclusão/restauração/desfazer com os contratos SQL reais; resolver peer inválido e triar os alertas restantes; repetir testes completos pertinentes e ensaio de implantação antes de declarar APTO. Os testes verdes abaixo não anulam os bloqueios reproduzidos. Não consigo confirmar consumo real de créditos.

## Reexecução e resultados

- `npm run typecheck`: concluído sem diagnósticos (pr-ready-typecheck.log).
- `npm run build`: concluído; avisos existentes de inputValidator depreciado e diretivas use client ignoradas, sem falha (pr-ready-build.log).
- Runner canônico em processos isolados, TEST_CONCURRENCY=2: **288 arquivos, 4.234 aprovados, 0 falhas, 2 skips, 0 erros** (pr-ready-tests.log). Inclui WhatsApp, finanças e Pluggy. Não é suíte de integração real/E2E: excluídos security-has-role-bypass, whatsapp-rpc-security-guard, bens-financiamentos-v1, connected-accounts-viewer-policy-sec-ca-01b e tests/e2e por dependerem de ambientes/serviços externos. Os dois skips estão nos testes legados de edição de contas.
- PostgreSQL nativo descartável, runner WhatsApp: enqueue/claim/undo com duas sessões concorrentes, callback fora de ordem e preservação física aprovados; nova sonda reproduz três incompatibilidades F2 (undo/excluir/restaurar). Exit 0 da sonda significa **reprodução confirmada**, não compatibilidade aprovada (pr-ready-native.log).
- PostgreSQL nativo descartável, runner TRUNCATE: cenário 84 tabelas, duas aplicações, papéis e futuras tabelas, CRUD/service_role e herança aprovados (pr-ready-truncate.log).
- `npm ls --all --json`: falhou ELSPROBLEMS conforme bloqueio acima; `npm audit --omit=dev --json`: 17 alertas. Não houve nova instalação limpa nesta rodada; usada a instalação limpa documentada na rodada anterior com o mesmo lockfile.
- `git diff --check`: sem erros. Não foi realizada migração real ou validação com credenciais de produção.

## SQL candidatos e SHA-256

Os hashes abaixo identificam os bytes locais revisados. Nenhum desses arquivos foi aplicado no ambiente real. A candidata undo está **reprovada para implantação**; outbox e templates permanecem inativos.
- docs/migrations-candidate/public-revoke-truncate.sql : 729e1e2353bb7f47008206db31ba94113a7dff096ba7230d34dcbcd661082dc2
- docs/migrations-candidate/public-truncate-prepost-readonly.sql : b838096812f480008f083369704f49e13017f3b3bfd51089062355ae73c89c00
- docs/migrations-candidate/whatsapp-undo-soft-delete.sql : 1491ffe4bad766c22526f2ff7d61135318f0ffb1a2d3d9421093dbfe3db06386
- docs/migrations-candidate/whatsapp-reply-outbox.sql : 6e8dbad609621c4041eb401b8b9f8fd30344b02cf0be032d42d3ff7a603b3885
- docs/migrations-candidate/whatsapp-agenda-templates.sql : bc27c37713175b1e7035b91192f7e0aa19bc1866f380f3dfa30e7f40f13c57db
- docs/migrations-candidate/gastos-soft-delete-f2.sql : 0b39af976003e99ddcb20528441644fdfb2f6ed98ee3f7fa820879ba8a61dcfb
