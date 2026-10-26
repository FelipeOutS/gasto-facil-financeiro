# PR #27 — revisão final e plano de homologação

## Parecer

**NÃO APTO PARA MERGE.** Revisão focada do HEAD remoto `5b28228554aed20693d3df8fdc152ef0ab73a41e`, base `a1ea7ea283760657bc55a1e5c9d536281f977ef5`. PR aberto, draft=true, mergeable=true: ausência de conflito Git não significa prontidão operacional. Seis commits preservados, 78 arquivos. Fetch confirmou a mesma main. Nenhum arquivo Pluggy, migration executável em supabase/migrations ou arquivo de ambiente alterado no diff.

Nenhum push, merge, publicação, mensagem real, SQL real, alteração de variável ou ativação foi realizado nesta revisão. As novas preparações permanecem locais, fora do PR. Os 4.237 testes pertencem à validação anterior, não são um novo resultado desta revisão.

## Bloqueios de promoção

1. **Schema real incompatível**, conforme informação do titular: faltam gastos.deleted_by/deletion_source e ambas as RPCs v2. Presença de deleted_at não comprova F2 integral. O candidato v2 exige guard, constraint validada, owner e demais campos. O preflight agora mostra ausências e diferenças de tipos explicitamente, além das definições, ACLs efetivas e políticas. Ainda falta executar e comparar a saída real autorizada com um clone homologado. Não houve inspeção do banco real nesta revisão.
2. **Degradação deliberada com flag desligada:** exclusão e restauração individuais de gastos E receitas, além de desfazer recente (inclusive parcelas/receita recorrente), deixam de executar. Não existe fallback de escrita. Leitura, cadastro e edição simples não dependem dessa flag; continuam sujeitos às outras autorizações e ao schema. Edição de importados é encaminhada ao site. Restauração v2 só admite exclusão feita pela própria RPC, snapshot intacto e prazo de 30 dias; exclusões legadas não ganham restauração automática.
3. **F2 não deve ser aplicado integralmente sem contenção adicional:** linhas finais concedem EXECUTE em gastos_soft_delete_periodo e gastos_restaurar_lote a authenticated/service_role. A trava do WhatsApp não impede chamada direta via RPC. Antes de qualquer aplicação, preparar e testar um pacote transacional que mantenha essas duas RPCs sem EXECUTE para PUBLIC/anon/authenticated/service_role, inclusive por herança. Owner administrativo continuará privilegiado. A revogação deve ocorrer na MESMA transação da instalação F2, antes do COMMIT; não aceitar uma janela entre scripts. Não alterei o candidato F2 auditado nem habilitei exclusão mensal. Esse pacote ainda é uma pendência impeditiva, não um SQL pronto para produção.
4. **Graph API:** o código aceita somente WHATSAPP_GRAPH_VERSION=v25.0; versão ausente ou diferente falha fechado. Publicar apenas código pode interromper respostas, mídia e operações Meta; trocar apenas variável também pode incompatibilizar código antigo. Preparar revisão imutável código+configuração e troca coordenada. Nenhuma variável foi lida ou alterada no servidor.
5. **CI ausente:** consulta ao HEAD retornou workflow_runs=[] e statuses=[]. A consulta de runs cobre eventos de PR/primeira página; não comprova ausência de verificações externas. Único workflow versionado era cortex.yml, manual, gera mapa e faz commit/push; não é teste nem deploy e não foi executado. Preparado localmente whatsapp-pr.yml: PR para main, token contents:read, checkout sem credenciais persistidas, npm ci, typecheck, build, nove arquivos de contratos/regressões isolados e três runners SQL descartáveis. Sem secrets, deploy ou pull_request_target. GitHub/Linux ainda não executou esse candidato; deve ser obrigatório na proteção de main após seu primeiro resultado válido. CI usa PostgreSQL 16 e a validação local usa 17; registrar ambos, não equiparar automaticamente ao schema real.
6. **Isolamento Lovable não comprovado:** documentação confirma sincronização da branch ativa para o projeto. Publicação é uma ação separada, mas não foi inspecionada a configuração privada de autoaprovação, integrações externas, deploy hooks ou compartilhamento de backend deste projeto. Não é seguro afirmar que merge não afeta produção. Preview não equivale a banco isolado.

## Segurança / RPCs / permissões

Os novos corpos elevados usam search_path fixo, service_role como único cliente executor, vínculo/telefone/opt-in/plano/titular, locks de usuário/linha, controle updated_at, idempotência e auditoria na mesma transação. A RPC individual bloqueia vínculos financeiros especiais e preserva a linha original. O journal tem RLS e não concede escrita direta ao cliente nem ao service_role. O owner deve coincidir com gastos; verificar DEFINER, ACL efetiva e definições completas, não só nomes. O wrapper legado do undo muda de implementação: testar consumidores antigos no clone.

F3 exige leitores ignorarem soft-deleted; F4 trata reversões atômicas do site e precisa de sua própria compatibilidade. Não substituir um por outro. TRUNCATE é correção independente: verificar grants efetivos, heranças e defaults globais e por schema de postgres/supabase_admin. A candidata aborta se a revogação não resolver o acesso efetivo. Não reabrir TRUNCATE num rollback.

Outbox, Shopping e lote mensal mantêm constantes false. Não preparar cron/dispatcher como parte deste rollout. Outbox ainda tem risco residual de commit financeiro separado do enqueue; não liberar. As permissões do SQL F2 são uma superfície separada dessas constantes.

## Como impedir promoção prematura

Manter PR draft, main inalterada e publicação sem autoaprovação. Registrar na configuração Lovable a branch ativa e o SHA publicado, além de inventariar GitHub Apps/webhooks e qualquer hospedagem externa. Antes de testar, comprovar que Preview usa banco, storage, filas, callbacks e credenciais de teste separados. Se compartilhar produção, limitar a leitura e mocks; nenhum teste financeiro real. Não mudar a branch do projeto publicado para testar. Usar ambiente de homologação separado; não desconectar integrações às cegas.

Referências oficiais consultadas:
- https://docs.lovable.dev/integrations/github (sync da branch ativa)
- https://docs.lovable.dev/features/publish (snapshot publicado e aprovação de publish)
Essas regras gerais não substituem evidência da configuração particular do projeto.

## Autorizações e sequência mínima

1. Autorizar apenas push das preparações locais para este mesmo PR draft, após revisão do diff. Não inclui merge. Executar CI e corrigir falhas de ambiente/contrato; exigir aprovação e checks na main.
2. Autorizar preflight somente leitura no banco real, com acesso restrito. Capturar schema/ACL/defaults/owners/triggers/RPCs sem dados pessoais. Executar também public-truncate-prepost-readonly.sql. Não executar RPC financeira como teste de permissão. Comparar metadados com o clone e verificar dados legados incoerentes por contagens agregadas aprovadas; o preflight de catálogo sozinho não prova ausência de linhas incompatíveis.
3. Criar clone isolado e backup verificável: schema, funções/ACLs/defaults, dados protegidos e ponto de restauração/PITR. Fazer restauração de ensaio e registrar duração, retenção e responsável. Usar dados sintéticos ou anonimizados no clone; não copiar segredos. Confirmar versão PostgreSQL, extensões, donos e privilégios do executor (supabase_admin pode exigir operador da plataforma).
4. No clone, preparar a contenção F2 acima e validar código publicado atual contra schema expandido, depois código novo com flag off e on. Se o código antigo escrever apenas deleted_at, o guard F2 pode bloquear: não aplicar F2 em produção antes de eliminar essa incompatibilidade ou aprovar uma janela coordenada de manutenção. Validar leitores F3 e reversões F4 antes de soft-delete.
5. Ordem SQL candidata no clone: TRUNCATE independente; pacote F2 com contenção mensal atômica; whatsapp-entry-mutations-v2; whatsapp-undo-soft-delete; F4 conforme dependências e compatibilidade constatadas. Reaplicar para provar idempotência; abortar em divergência de constraint/owner ou dados legados, sem backfill improvisado. As candidatas entrada/undo têm transações próprias: não concatenar tudo sob uma transação externa presumindo atomicidade global. Preparar execução por fase, com checkpoints.
6. Outbox, lote mensal, Shopping e templates Agenda ficam fora da aplicação mínima. Templates exigem aprovação específica do catálogo Meta, idioma pt_BR, categoria, variáveis e status; SQL de catálogo não aprova template na Meta.
7. Homologar código/configuração v25.0 no ambiente isolado. Conferir permissões do token, WABA/telefone de teste, assinatura de callback, consentimento e templates aprovados. Nenhum token em log/PR. Primeiro transportes simulados; mensagens de teste reais exigem autorização posterior específica, destinatário e limite definidos.
8. Só depois aprovar separadamente SQL real por arquivo/hash, publicação coordenada código+Graph, merge e eventual flag financeira=2. Não tratar aprovação de CI/PR como aprovação dessas ações. Se não houver troca atômica de código/configuração, aprovar janela e procedimento que impeça ingestão concorrente sem perder eventos; não simplesmente descartar webhooks.
9. Celular: executar matriz abaixo em ambiente isolado, depois smoke test real restrito apenas com autorização expressa. Não abrir ativação geral por resultado local.

## Rollback

Antes de v2 escrever: retirar revisão candidata e voltar ao par código/configuração previamente comprovado compatível. NÃO voltar cegamente a uma versão Graph antiga sem confirmar suporte. Manter schema aditivo quando compatível; não derrubar campos, journal ou audit logs.

Depois de v2 escrever: desligar flag v2 para interromper as três operações, manter consultas/edições sob avaliação e preservar todos os marcadores/journal. Código de rollback precisa entender F2/F3; o código pré-F2 não é fallback seguro. Não restaurar backup sobre produção ativa nem limpar deleted_* em massa. Restaurar backup em instância separada, comparar ações posteriores e fazer reparo progressivo aprovado. Desligar v2 não desfaz transações já confirmadas nem restaura o serviço legado automaticamente.

Falha de SQL na transação: ROLLBACK dessa fase; revisar locks/timeouts. Fases anteriores confirmadas permanecem e exigem plano próprio. Não reatribuir GRANT ALL/TRUNCATE. Para incidente Meta, preservar fila/staging/status, interromper reenvios ambíguos e reconciliar por message id; não disparar replay automático.

## Matriz manual — ainda pendente, não executada

Todos os casos usam titulares e valores sintéticos em Preview isolado e no celular. Registrar SHA, schema, flag, resultado, logs sanitizados e estado antes/depois. Não usar conta real contra produção.

| Caso | Resultado exigido |
|---|---|
| Login, plano, vínculo revogado e segundo titular | Acesso correto, sem cruzamento de dados; revogação impede nova escrita |
| Gasto/receita simples: criar e editar no site e WhatsApp simulado | Um registro, total correto, leitura nos dois canais; edição concorrente preservada |
| Flag off: excluir, restaurar e desfazer gasto/receita | Aviso de indisponibilidade/bloqueio, zero chamadas v2 e zero alteração |
| Flag on com RPC ausente | Erro controlado, nenhum fallback UPDATE/DELETE |
| Exclusão v2 seguida de restauração | Mesma linha, quatro marcadores F2 coerentes, totais F3 corretos, journal |
| Exclusão antiga, snapshot editado, prazo excedido | Restauração bloqueada; nenhuma linha recriada |
| Botão repetido, nonce velho, duas sessões e edição no site | Uma mutação/auditoria, conflito seguro, sem sobrescrita |
| Desfazer gasto/receita/parcelas/recorrência | Contrato de ocorrência/série correto; nenhuma fatura ou histórico incoerente |
| Cartão vinculado, compra parcelada, fatura paga | Operações individuais proibidas bloqueadas; conferir estorno/undo e pagamento sem duplicação |
| Importado/Pluggy, bem e conta a pagar | Bloqueios e encaminhamento corretos, conciliação preservada |
| F4: reversão de extrato/conta, edição manual e falha intermediária | Atomicidade e preservação de registros alterados |
| Áudio válido, excedido, MIME inválido, timeout | Limites, erro amigável, nenhuma criação parcial/duplicada |
| Comprovante válido, ilegível, repetido e transferência própria | Revisão/confirmacão conforme contrato, sem receita fictícia |
| Graph ausente/diferente/v25.0 | Falha fechada nos dois primeiros; transporte simulado correto no terceiro |
| Template aprovado/rejeitado/idioma ou parâmetros errados | Envio somente válido; mensagens reais só após nova autorização |
| Callback duplicado/fora de ordem/assinatura inválida | Estado monotônico e deduplicado; inválido sem efeito |
| Outbox/Shopping/lote mensal/cron/lembretes | Permanecem inativos, inclusive chamada RPC direta de lote sob roles clientes |
| Mobile: rede cai/retorna, reabrir app e reenviar confirmação | Sem duplicação, estado consistente, feedback legível |

## Próxima autorização exata

Autorizar somente envio do CI, preflight e deste plano à branch do PR #27, mantendo rascunho e sem merge/deploy. Isso permite obter checks reais. Depois, autorização distinta para preflight read-only e homologação isolada. A contenção das RPCs mensais do F2 ainda precisa ser preparada/testada antes de pedir autorização de banco real.

Consumo real de créditos/tokens indisponível: não consigo confirmar.

## Resultados desta revisão

- 128 testes focados em nove arquivos: aprovados, zero falhas/skips/erros.
- PostgreSQL 17 descartável: preflight antes e depois de F2/v2, rejeição sem F2, reexecução de candidatas, undo e exclusão concorrentes: aprovados.
- O CI remove arquivos .env versionados somente no checkout efêmero e usa endpoints loopback fictícios; não recebe secrets. A execução Linux completa ainda depende de autorização de push.
- SHA-256 do preflight local, bytes atuais (misto CRLF/LF; não é o hash do arquivo remoto): f802b0d6dc1a01d73e8945ad48e1d8bd2a5a07f1a32dec33f1b7847fa6534a9b. Recalcular após normalização/commit antes de autorizar execução. Os demais candidatos não foram modificados; hashes remotos em WHATSAPP-SQL-SHA256-20261025.md.
- Typecheck aprovado nesta revisão; diff --check sem erros. Build e instalação limpa não repetidos: nenhum código de produção ou dependência mudou; resultados anteriores não equivalem a CI Linux.

## Preparação autorizada para envio

Envio autorizado pelo titular apenas para a branch do PR #27. A conexão GitHub consultada informa pull=true e push=false: envio impedido por permissão, sem tentativa de contorno. Commit local limitado aos quatro arquivos desta etapa; seis commits anteriores preservados. Nenhum resultado novo de CI remoto disponível. O workflow cortex.yml preexistente faz commit/push apenas sob workflow_dispatch e não foi acionado ou modificado.

SHA-256 do preflight normalizado no índice Git: a07c6531d6051110fbdf8540dd87e09be83fae7cf0ec053162d54c3ca80f8ec6. Este é o hash para comparar com o blob do commit desta preparação; substitui a referência aos bytes mistos do working tree acima.
