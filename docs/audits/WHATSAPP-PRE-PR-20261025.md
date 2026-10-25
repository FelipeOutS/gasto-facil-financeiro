# WHATSAPP — correção dos bloqueios pré-PR — 25/10/2026

**APTO PARA PR — não significa APTO PARA PRODUÇÃO.** Parecer local revisado após correções; substitui o NÃO APTO do commit f6f3bf0b. Não houve push, PR, merge, deploy, SQL real, alteração de segredos, mensagem Meta ou ativação de recursos.

Branch confirmada: codex/whatsapp-finalizacao-20261025. Base: a1ea7ea283760657bc55a1e5c9d536281f977ef5. Histórico preservado: efe4b8ae, e3760885, f6f3bf0b. Novos commits locais: 2f32b3c0 (correção financeira/SQL/testes) e 2e4c62aa (dependências). O commit documental posterior aparece no log Git.

## Causas e correções

1. **F2/desfazer v2:** o código anterior alterava só deleted_at. Agora a RPC v2 preenche os quatro marcadores F2, atualiza updated_at, usa o lock por titular do F2 e o guard original. A fonte `whatsapp` foi acrescentada à constraint de origem por candidata separada; o trigger e a constraint de coerência não foram enfraquecidos. O único corpo elevado do desfazer valida vínculo ativo, telefone, opt-in, plano, propriedade, expiração, ação, timestamps e série antes da escrita. Revalida plano e registra auditoria transacional. A assinatura legada continua INVOKER e delega ao v2 seguro, sem DELETE físico.
2. **Excluir/restaurar individual:** a nova `whatsapp_entry_mutate_v2` substitui patches isolados em gastos e receitas. Só service_role pode executar; search_path é pg_catalog,public, relações qualificadas, owner obrigatoriamente igual ao de gastos. Locks de linha/advisory, CAS updated_at, request_id estável derivado do nonce e journal com chave única protegem concorrência e replay. Receita usa seus próprios deleted_source/deleted_reason; não recebe marcadores fictícios de gastos.
3. **Restauração:** só a linha original, da própria conta, excluída por essa RPC, com snapshot completo ainda idêntico e até 30 dias. Não restaura exclusão de outra origem ou registro editado posteriormente; não recria linha. Journal sem grants de UPDATE/DELETE/INSERT para clientes ou service_role; inserção ocorre dentro da RPC. Não há importação de histórico nem restauração física legada.
4. **Tipos especiais:** exclusão/restauração individual mantém bloqueio de cartões, parcelas, recorrências, bens, extratos e conta a pagar. Edição antiga de importação agora é encaminhada ao site/app. Desfazer recente mantém o contrato próprio de ação/parcelas/recorrência; histórico não associado não é apagado. Controle otimista da edição e cancelamento de conversas preservados. Nenhuma implementação Pluggy alterada.
5. **Compatibilidade de publicação:** `WHATSAPP_FINANCIAL_MUTATIONS_VERSION` precisa ser explicitamente `2`. Ausente ou diferente, não chama as novas RPCs de exclusão/restauração/desfazer. Isso permite entregar a versão compatível desligada antes de ativar o contrato. RPC ausente retorna erro sem fallback direto. A candidata exige F2 integral e aborta atomicamente quando ausente/parcial; não instala F2 automaticamente.
6. **Dependências:** Cloudflare 1.37.1/Miniflare 4.20260515.0 corrigem o peer do env-runner sem trocar Nitro/TanStack. Correções transitivas conservadoras e pins de segurança para Undici 7.30.1, ws 8.22.0 e Sharp 0.35.5. Happy DOM/registrator 21.0.4 corrigem escape em testes. Vite permaneceu major 7 (lock 7.3.7). npm ci e npm ls passaram. Locks npm e Bun sincronizados por migração do package-lock, sem audit fix --force.

## Testes executados

| Verificação | Resultado |
|---|---|
| npm ci, instalação limpa com lock final | exit 0; npm aplicou sua política de lifecycle scripts, com avisos de scripts não aprovados |
| npm ls --all --json | sem problems/ELSPROBLEMS |
| npm audit completo, incluindo dev | 0 críticos, 0 altos, 4 moderados, 2 baixos |
| Typecheck | aprovado, inclusive após novo teste de rollout |
| Build Vite/TanStack/Nitro | aprovado; avisos de depreciação/use client, sem falha |
| Runner canônico isolado, concorrência 2 | 288 arquivos, 4.234 pass, 0 fail, 2 skip, 0 errors |
| Complementos | 2 testes novos de rollout + 1 de edição importada aprovados; total único local 4.237, em 289 arquivos |
| Reexecução após última revisão SQL | 11 testes undo + 2 rollout e 21 de edição aprovados; cenários antigos não somados novamente |
| PostgreSQL 17 nativo descartável | F2 integral + candidatas individual/undo, reexecução idempotente e duas sessões aprovadas |
| PostgreSQL 17 F2/F4 | candidatos reais e testes 10,20,30,40 de exclusão/reversão/paridade/rollback aprovados |
| PostgreSQL TRUNCATE | cenário local de 84 tabelas, defaults, CRUD, service_role, herança e idempotência aprovados |
| Miniflare/Workerd + Sharp | worker local responde ok; Sharp 0.35.5 carrega corretamente |
| Diff | sem alteração em src/server/pluggy ou supabase/migrations; git diff --check sem erros |

A suíte inclui gastos, receitas, cartões/faturas, contas, agenda, dashboard/relatórios, extratos, F3/F4, WhatsApp e Pluggy. Não se eliminou teste para aprovar. Os dois skips permanecem nos testes legados de contas. Não executados os quatro testes dependentes de serviços externos: security-has-role-bypass, whatsapp-rpc-security-guard, bens-financiamentos-v1 e connected-accounts-viewer-policy-sec-ca-01b; nem tests/e2e/Preview/celular. Não é uma declaração de homologação de produção.

O runner nativo usa fresh cluster, loopback, senha aleatória, porta aleatória e remove apenas seu diretório temporário. Testou: gasto/receita individual, restauração, undo recente, duplicação/concorrência, outro usuário, ausência de EXECUTE, revogação, plano, registro importado, parcela/cartão bloqueados no fluxo individual, recorrência, edição posterior, rollback por erro após escrita e antes da auditoria, snapshot alterado e exclusão de outra origem. O teste que antes apenas reproduzia o erro F2 foi substituído por operações positivas com o guard real; atualização direta de marcadores continua negada. Duplicidade de mensagem Meta e cancelamento também permanecem cobertos nos testes de pipeline locais.

## Dependências e riscos restantes

A auditoria anterior de produção tinha 17 alertas, 13 altos. A atual inclui desenvolvimento e tem seis alertas agregados, não seis explorações independentes: esbuild e sua cadeia Drizzle (moderados), plugin Cloudflare/Wrangler (baixos herdados). A triagem por pacote, versões, origem, severidade, advisory, correção e exposição está em WHATSAPP-DEPENDENCIAS-20261025.md.

Não bloqueiam PR sob a condição de não publicar servidores de desenvolvimento/preview/tooling para terceiros. Não houve downgrade de Drizzle nem override global de esbuild 0.x incompatível. São risco real se essas ferramentas forem expostas ou executarem fontes não confiáveis. Validar runtime Node e binários nativos no destino continua necessário. O teste local usa Node 24.19, Bun 1.4.2 e PostgreSQL 17.11.

## SQL e compatibilidade F2/F3/F4

- `public-revoke-truncate.sql`: independente e inalterada; defaults postgres/supabase_admin e PUBLIC considerados. Sem auditoria geral refeita, sem consultar as tabelas reais. O número 84 foi reproduzido em fixture, não recontado em produção.
- `whatsapp-v2-preflight-readonly.sql`: inventário somente leitura de colunas, triggers/owners/definições e RPCs. Requer revisão do resultado; não foi executado remotamente.
- `whatsapp-entry-mutations-v2.sql`: candidata nova, requer F2/receitas soft-delete e owner correto; cria journal, RPC, grants mínimos e acrescenta origem whatsapp. Não habilita mês/outbox/Shopping.
- `whatsapp-undo-soft-delete.sql`: candidata revisada, requer a anterior; assinatura v2 elevada estritamente para acessar guard F2, com autorização e auditoria. Wrapper legado protegido.
- `gastos-soft-delete-f2.sql` e `gastos-delete-atomic-f4.sql`: implementação preservada. F3 e receitas seguem filtrando deleted_at nos leitores conforme regressões. Não aplicar F2/F4 automaticamente se o schema real divergir.
- `whatsapp-reply-outbox.sql` e `whatsapp-agenda-templates.sql`: permanecem candidatas inativas, sem ativação nesta missão.

Hashes dos bytes locais e dos blobs Git normalizados: WHATSAPP-SQL-SHA256-20261025.md. Manifesto de caminhos: WHATSAPP-PRE-PR-ARQUIVOS-20261025.txt.

## Implantação coordenada futura, com aprovações separadas

1. **Antes:** revisar PR/SHA, locks, runtime, backup, flags e jobs efetivos. Nada desta tarefa certifica configuração remota atual. Outbox, Shopping, exclusão mensal, cron e disparos automáticos devem permanecer bloqueados. Pré-verificação SQL somente leitura com operador autorizado; comparar guards/owners reais com candidata. F2 ausente/parcial ou leitores F3 divergentes: parar e preparar a adaptação específica, sem tentar compensar com UPDATE direto.
2. **Código compatível desligado (versão A):** após autorização futura de publicação, manter WHATSAPP_FINANCIAL_MUTATIONS_VERSION ausente/desligada em todas as instâncias. A nova versão não depende de RPC inexistente enquanto desligada. Confirmar bloqueio no Preview. Não basta o merge: evitar promoção automática pelo Lovable.
3. **Permissões:** aprovação independente de public-revoke-truncate.sql; pré/pós-check de ACL, defaults e acesso efetivo. Abortar se herança ainda permitir TRUNCATE. Não restaurar privilégios perigosos para fazer aplicativo funcionar.
4. **SQL funcional:** depois de validar o schema e aprovar explicitamente, F2 integral se necessária (revisão própria), depois whatsapp-entry-mutations-v2.sql, depois whatsapp-undo-soft-delete.sql. F4 só se pendente e separadamente autorizado. Conferir owner/ACL/search_path e teste de conta isolada autorizado. Não seguir a ordem antiga que omitia entry-mutations-v2.
5. **Ativação do contrato (versão B/config):** só após SQL e Preview aprovados, autorização específica para WHATSAPP_FINANCIAL_MUTATIONS_VERSION=2. Nenhum valor foi gravado no servidor nesta missão. Verificar telefone/opt-in/plano, edição e CAS, excluir/restaurar/desfazer com dados de homologação, totais antes/depois e no celular. Sem criar registros financeiros reais aqui.
6. **Meta:** v25.0 continua alvo deliberado. Configurar WHATSAPP_GRAPH_VERSION=v25.0 somente na janela aprovada, sem saída concorrente de instâncias antigas/novas e sem expor tokens. Validar WABA/permissões/mídia/callback em Preview/conta autorizada. Não retornar à v20 expirada em rollback. Templates são revisão/aprovação separada; rascunhos inativos não autorizam disparos.
7. **Outbox/Shopping/mês/cron:** não fazem parte desta ativação. Continuam bloqueados; outbox ainda exige resolver atomicidade commit financeiro/enqueue antes de habilitar. Templates e eventos não autorizam ativação automática.
8. **Depois:** conferir audit journal, counts/valores, rejeições de permissão, filas, duplicações e logs sanitizados. Homologação real/Preview/celular permanece externa e obrigatória antes de produção.

## Rollback seguro

Desligar a variável do contrato e suspender o recurso, preservando dados/journal/evidências. Reverter somente para código compatível e ainda bloqueado. Não reinstalar undo físico, não excluir tabelas/journal nem reverter marcadores em massa. Candidatas transacionais fazem rollback integral se falharem, inclusive na auditoria. Schema aditivo pode permanecer inativo. A revogação TRUNCATE permanece; nunca usar GRANT ALL como rollback. Não reenviar respostas ambíguas nem reimportar lançamentos. Alterações já autorizadas exigem análise pelo journal e restauração individual segura, não scripts genéricos.

## Limites e pendências externas

Ainda faltam inventário real autorizado, aprovação SQL específica, Preview/celular, E2E autenticado e eventual validação Meta com destinatário de teste autorizado. A aprovação é para revisão de PR; a configuração off e estas pendências impedem afirmar pronto para ativação em produção. Não consigo confirmar consumo real de créditos ou tokens.
