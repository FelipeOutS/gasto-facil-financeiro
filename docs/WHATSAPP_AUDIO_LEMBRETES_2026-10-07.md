# Áudio e lembretes — auditoria e implementação local

Branch: `feat/whatsapp-audio-reminders`, baseada em `origin/main` em `74805885` (PR #14 mergeado).
Checkout: `E:\Projetos\APLICATIVO GASTO INTELIGENTE\gasto-facil-financeiro`.
O checkout antigo no OneDrive não foi modificado. Arquivos locais de ferramentas foram preservados.
Nenhum commit, push, deploy, mensagem real ou operação no banco remoto foi realizado.

## Resultado e limites

Esta rodada implementa uma fundação testável e correções concretas. **Não conclui toda a evolução solicitada.**
Não há evidência de entrega em produção. As funcionalidades novas ficam atrás de flags desligadas por padrão.

| Funcionalidade | Classificação | Evidência/limite |
| --- | --- | --- |
| Validação de áudio, assinatura webhook, download, autorização, duração e normalização monetária | IMPLEMENTADO E TESTADO LOCALMENTE | Suítes existentes e testes de HTTP, mídia e duração |
| Timeout e limite de resposta da transcrição | IMPLEMENTADO E TESTADO LOCALMENTE | AbortController de 25s, resposta de 64KiB, falha segura |
| Download de mídia limitado durante leitura | IMPLEMENTADO E TESTADO LOCALMENTE | Antes arrayBuffer sem limite de leitura; agora streaming limitado, lookup de 16KiB, timeout 15s, HTTPS/CDN allowlist e redirects bloqueados |
| Qualidade real da transcrição PT-BR | IMPLEMENTADO, MAS DEPENDE DE INTEGRAÇÃO REAL | Modelo existente `openai/gpt-4o-mini-transcribe` via Lovable Gateway, `language=pt`; nenhum áudio real enviado ao provedor |
| Áudios de cinco minutos | AINDA NÃO IMPLEMENTADO | Limite inline máximo 120s e 10MiB; configuração pode somente reduzir |
| Separação conservadora de múltiplas instruções | IMPLEMENTADO E TESTADO LOCALMENTE | Exemplo com quatro instruções; não encaminha a concatenação ao parser financeiro |
| Lote com seleção, correção e cancelamento individuais | IMPLEMENTADO E TESTADO LOCALMENTE | Caixa durável temporária; seleção reaproveita handler/confirmador existente, RPC serializa itens e bloqueia replay; requer duas flags e nova migration |
| Datas faladas e recorrência mensal por dia numerado | IMPLEMENTADO E TESTADO LOCALMENTE | “às nove”, “daqui a duas horas”, “todo dia 5”; mensal preserva âncora em mês curto |
| Confirmação de novos lembretes comuns | IMPLEMENTADO E TESTADO LOCALMENTE | Fuso do perfil, data/hora explícitas, botão confirmar/cancelar, RPC com lock e idempotência |
| Novos lembretes comuns no Cloud | IMPLEMENTADO, MAS DEPENDE DE INTEGRAÇÃO REAL | Requer nova migration, schema real de Agenda e flag explícita |
| Confirmação de lembretes vinculados a fontes financeiras | IMPLEMENTADO E TESTADO LOCALMENTE | Proposta guarda referência, SQL revalida ownership e conta pendente; não muda status financeiro |
| Consulta/edição/cancelamento por nome e desambiguação | IMPLEMENTADO E TESTADO LOCALMENTE | Handlers anteriores; novas frases de consulta/recorrentes/cancelamento |
| Edição de um lembrete fixo por data (“sexta”) | IMPLEMENTADO E TESTADO LOCALMENTE | Um match edita; dois matches pedem esclarecimento, sem mutação |
| Contexto conversacional irrestrito e identificação por pronomes | AINDA NÃO IMPLEMENTADO | Não interpreta arbitrariamente “aquele”, “esse” ou relações implícitas entre instruções |
| Reparo da fila e lembrete atrasado após reinício | IMPLEMENTADO E TESTADO LOCALMENTE | Scheduler server-side usa a fila existente; revalidação compara ocorrência, não janela de 2 minutos |
| Cron externo executando continuamente | AINDA NÃO IMPLEMENTADO | Nenhum cron foi instalado; chamada do dispatcher depende de infraestrutura externa |
| Dispatcher, leases, quotas, backoff, quarantine e callbacks | IMPLEMENTADO E TESTADO LOCALMENTE | Suítes existentes; aceitação, entrega e leitura permanecem distintos |
| Agenda até transporte mockado | IMPLEMENTADO E TESTADO LOCALMENTE | Teste integrado de falha de enqueue, reparo, reinício, revalidação e aceitação HTTP mockada |
| Entrega real de lembrete com aplicativo fechado | BLOQUEADO PARA PRODUÇÃO | Cron, variáveis, schema, template aprovado e recebimento real não comprovados |
| Templates proativos novos | BLOQUEADO PARA PRODUÇÃO | Allowlist atual continua permitindo somente três eventos de contas; geração permanece desligada |
| Proteção de replay da geração proativa | IMPLEMENTADO E TESTADO LOCALMENTE | Timestamp/nonce no corpo assinado, rate_limit_hit atômico, falha de banco bloqueia, corpo limitado |

## Auditoria anterior à implementação

Áudio já entrava pelo webhook assinado da Meta, depois dos gates de vínculo/opt-in/plano, e reutilizava o pipeline textual. A mídia era validada por tamanho, magic bytes e duração real, com falha fechada quando não mensurável. Não havia divisão de bytes nem persistência dos bytes no pipeline. Valores monetários por extenso já eram normalizados conservadoramente.

A transcrição inline não tinha timeout explícito nem leitura limitada da resposta. Não havia separador de múltiplas intenções. Não foi comprovado orçamento de tempo/memória do runtime publicado; portanto elevar duração para 300s seria inadequado.
O download também não tinha timeout e conferia tamanho apenas depois de `arrayBuffer()`. Isso foi corrigido: o stream é cancelado quando excede o orçamento e URLs de mídia são restringidas a hosts HTTPS Meta conhecidos, sem encaminhar Bearer através de redirecionamentos. Essa validação também protege os demais tipos de mídia que reutilizam o downloader; seus testes de regressão precisam passar.

Agenda já tinha cadastro, vínculos financeiros vivos, recorrência, consultas e ações. O fluxo respondia “Vou te lembrar” mesmo sem prova de cron/template/entrega. A sincronização da fila era best-effort. Revalidação de lembrete comum usava relógio do worker menos dois minutos e podia invalidar um lembrete corretamente agendado após atraso. Reexecutar sincronização podia cancelar o próprio dedupe pendente e não reabrir a linha terminal.

O reconhecimento de “todo dia 5” caía no padrão diário antes do mensal. O handler usava São Paulo por padrão sem buscar perfil. O wrapper novo busca `profiles.timezone` e pede configuração quando ausente/inválido; não transforma falha de leitura em fallback silencioso. O fluxo anterior, desativada a flag nova, mantém seu comportamento.

Dispatcher já possui claim/lease, tentativas, reserva de quota, backoff e callbacks. A fila não deve ser substituída. Cadastro, enfileiramento, aceitação Meta e entrega são etapas diferentes.

Geração proativa tinha HMAC, porém sem freshness/replay específico. A proteção adicionada exige JSON assinado com `timestamp` (epoch segundos) e `nonce` único de 16–80 caracteres. A janela é ±120s; nonce reservado atomicamente por 300s; máximo duas chamadas por minuto. Clientes antigos precisam atualizar o corpo antes da ativação. Não foi adicionada compatibilidade que permita bypass.

## Arquivos alterados

- `src/lib/agenda/datetime.ts`, `intent.ts`, `recurrence.ts`.
- `src/routes/api/public.whatsapp.expense.ts`.
- `src/routes/api/public.hooks.whatsapp-dispatcher.ts`, `public.hooks.whatsapp-proactive-generate.ts`.
- `src/server/agenda.server.ts`, `whatsapp-agenda.server.ts`, `whatsapp.server.ts`.
- `src/server/whatsapp-audio.server.ts`, `whatsapp-transcription.server.ts`.
- `src/server/whatsapp-notifications.server.ts`, `whatsapp-dispatcher-outbound.server.ts` (removidos textos brutos de erro de banco nos logs relevantes).
- Novos: `src/server/whatsapp-audio-intents.server.ts`, `whatsapp-agenda-scheduler.server.ts`, `whatsapp-reminder-confirmation.server.ts`, `whatsapp-cron-preflight.server.ts`.
- Novos: `src/server/whatsapp-agenda-template.server.ts`, `whatsapp-media-download.server.ts`.
- Novos: `src/server/whatsapp-audio-batch.server.ts`; ajuste em `whatsapp-interactive.server.ts` para preservar IDs opacos dos botões.
- `tests/agenda-2026-10-01.test.ts`.
- Novos testes: `whatsapp-audio-reminders-foundation.test.ts`, `whatsapp-reminder-proposals-sql.test.ts`, `whatsapp-reminder-confirmation.test.ts`, `whatsapp-agenda-scheduler.test.ts`, `whatsapp-cron-preflight.test.ts`.
- Novos testes: `whatsapp-agenda-template.test.ts`, `whatsapp-media-download-bounds.test.ts`.
- Novos testes: `whatsapp-audio-batch.test.ts`, `whatsapp-audio-batch-sql.test.ts`.
- Nova migration e este relatório.

## Migration e ativação

Nova: `20261007120000_whatsapp_reminder_proposals.sql`, **não aplicada remotamente**.
Cria propostas, RLS sem acesso anon/authenticated, RPC service_role de confirmação/cancelamento com row lock, limpeza de drafts expirados e dois placeholders de templates Agenda inativos/sem nome Meta.
Não altera gastos, receitas, pagamentos ou os quatro arquivos pendentes de 04/10.
Confirmação insere apenas `agenda_items`; sincronização da fila ocorre depois e pode ser reparada pelo scheduler. **Não é uma transação única de item+fila.** Fontes financeiras guardam apenas IDs/antecedência, sem copiar valor/vencimento; SQL revalida ownership e status pendente da conta na confirmação. Fontes de mesmo nome e IDs diferentes não são deduplicadas silenciosamente.

Dependências: `auth.users`, `agenda_items` e suas colunas/tipos reais, `cartoes`, `contas_a_pagar`, `recorrencias`, `whatsapp_notification_templates`, constraint de categorias contendo `agenda` após planning_actions. O código também consulta `profiles.timezone`. Não foi encontrada migration de criação de `agenda_items` na história local: o schema real precisa de preflight. PGlite testa um schema mínimo tipado, não prova equivalência ao Cloud.
O arquivo não é seguro para reexecução integral porque CREATE TABLE/FUNCTION não usa IF NOT EXISTS/OR REPLACE. Aplicar uma única vez após preflight/backup. Rollback exige desligar flags, revogar/remover funções e arquivar/remover propostas; não apagar automaticamente Agenda ou registros financeiros existentes. Remover placeholders somente se não utilizados por filas/histórico e se comprovadamente criados por esta migration.

Flags novas, default desligado:
- `WHATSAPP_REMINDER_CONFIRMATION_ENABLED=true`: wrapper de confirmação de lembretes comuns.
- `WHATSAPP_AGENDA_SCHEDULER_ENABLED=true`: reparo da fila no tick do dispatcher; limpeza das propostas se ambas ligadas.
- `WHATSAPP_AUDIO_BATCH_ENABLED=true`: caixa de instruções e seleção, somente cria lotes quando a confirmação de lembretes também está ligada. “Meus itens de áudio” recupera o menu mais recente. “Cancela item 2” / “corrige item 2 para ...” só são resolvidos quando há um único lote ativo; havendo ambiguidade, não altera itens.

Segunda migration nova: `20261007130000_whatsapp_audio_batches.sql`, não aplicada remotamente. Cria inbox temporário (até 10 itens, sem arquivo de áudio), RLS service_role-only, RPC com row lock e transição pending → processing → routed/cancelled. Depende de auth.users e whatsapp_messages/status/recebida_em existentes; sua ordem é depois da migration de propostas. Não grava gastos/receitas nem troca handlers. Correção/cancelamento ocorrem antes do encaminhamento; após encaminhar, usar os botões da confirmação financeira existente, nunca cancelar lançamento salvo pelo menu do lote.
Reenvio Meta não sobrescreve o lote. Uma seleção em processamento não é reexecutada automaticamente se houve interrupção: exige conferir a confirmação existente, evitando duplicidade incerta. Isso privilegia segurança financeira e deixa recuperação de casos ambíguos como operação assistida. Drafts de itens routed/cancelled são limpos; expirados são limpos pelo tick quando as três flags necessárias e dispatcher estão ativos. TTL não elimina conteúdo sozinho sem execução de manutenção: verificar o cron antes de ativar.
A seleção usa advisory lock por proprietário/conversa, além do lock da linha. Bloqueia processamento simultâneo mesmo entre lotes diferentes e verifica confirmação financeira pendente; o teste SQL cobre esse conflito.
A migration não é reexecutável integralmente. Rollback: desativar a flag, arquivar inbox, revogar/remover funções e tabela sem tocar sessões financeiras ou lançamentos. Não apagar automaticamente históricos/filas.

Permanecer desligados em produção: essas flags, `WHATSAPP_13_ALERT_GENERATION_ENABLED`, `WHATSAPP_DISPATCH_ENABLED`, `WHATSAPP_OUTBOUND_HTTP_ENABLED`, até homologação operacional. Não alterar flags já reais sem decisão do operador.

Scheduler varre páginas de 100, até 5.000 itens/tick, e sinaliza truncamento. Acima disso exige cursor durável para evitar starvation. Repara lembrete comum único até 24h atrasado; mais antigo exige revisão, não envia surpresa. Terminais existentes não são reabertos. A recorrência ainda precisa de homologação integrada de múltiplos ticks e falhas perto da fronteira de execução.
Consentimento/plano são revalidados no envio pelos gates existentes; scheduler apenas restaura a fila. Cancelamento antes da revalidação impede envio; uma requisição Meta já em voo não pode ser desfeita.

## Meta e dependências externas

Política oficial consultada em 07/10/2026: https://whatsappbusiness.com/policy/ (atualizada em 23/09/2026).
Exige opt-in e respeito à revogação. Fora da janela de 24h, somente templates aprovados. A categoria e aprovação precisam corresponder ao uso; reminders solicitados são candidatos a utility, aprovação não é garantida.
Nenhum template foi consultado/submetido/ativado na conta real. Placeholder local não prova aprovação. Não fazer fallback para texto livre fora da janela.
O dispatcher de Agenda agora exige `whatsapp_meta_templates` sincronizado, ativo, aprovado, UTILITY/pt_BR, versão 1 e provider ID, além de nomes fechados `gi_agenda_lembrete_v1` / `gi_agenda_financeiro_v1`. A integração das ferramentas de gestão/sincronização do catálogo com esses novos eventos ainda precisa ser concluída: sua allowlist geral continua limitada aos três eventos de contas. Não considerar um nome configurado como aprovação suficiente.

Variáveis existentes a validar, sem revelar valores:
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_BUSINESS_ACCOUNT_ID`/`WHATSAPP_WABA_ID`, `WHATSAPP_DISPATCHER_SECRET`, `WHATSAPP_ENABLED`, flags outbound/runtime/plano, `LOVABLE_API_KEY`, URL/chaves Supabase server-side.
Nenhum OpenAI direto nem novo provedor pago foi adicionado. Transcrição usa o gateway já existente; seu custo/limite operacional precisa ser confirmado no Lovable. Templates e envio têm tarifas da Meta dependentes da categoria/país; não foi estimado preço.

Documentação primária consultada: [Lovable AI](https://docs.lovable.dev/features/ai) lista GPT-4o Mini Transcribe; [OpenAI Transcriptions](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) documenta OGG e o modelo de transcrição. Isso não comprova disponibilidade do endpoint específico do gateway nem acesso da conta real. Nenhuma chamada de transcrição real foi feita.

Notificações financeiras: contas a pagar têm pipeline/template existente, mas entrega real continua pendente. Faturas e recorrências financeiras podem ser fontes vivas de lembretes Agenda; não representam pagamento realizado. Metas, orçamento, resumos e demais alertas proativos continuam bloqueados pela allowlist incompleta e exigem homologação específica. Assinaturas do produto dependem dos gates de entitlement existentes e não devem ser confundidas com despesas recorrentes cadastradas pelo usuário.

Para áudio de 5min: usar fila durável dedicada à ingestão de áudio (não outra fila de notificações), ACK rápido do webhook, lease/idempotência, worker com tempo/memória comprovados e decodificação/transcodificação codec-aware (ex.: FFmpeg em runtime compatível). Se necessário dividir por tempo com sobreposição e timestamps, nunca cortar bytes comprimidos, reconciliar contexto/correções e encaminhar itens aos handlers existentes. Exige revisão de retenção temporária cifrada e custos antes de produção.

## Homologação real ainda necessária

1. Resolver instabilidade do Lovable; backup/preflight das quatro migrations anteriores e nova migration.
2. Confirmar schema Agenda, timezone, RLS, funções, dedupe, constraints e catálogo real.
3. Confirmar templates adequados e aprovação/status/idioma/parameters na Meta, sem ativar alertas proativos incompletos.
4. Instalar scheduler externo com segredo seguro, monitorar heartbeat, latência, queue age, falhas e truncamento; não basta existir endpoint.
5. Após autorização, testar um lembrete opt-in elegível com aplicativo fechado dentro/fora de 24h; observar accepted → sent → delivered/read ou failed em callbacks.
6. Testar revogação, plano inelegível, cancelamento, atualização, retry e indisponibilidade; verificar número correto e ausência de duplicatas.
7. Testar áudio real PT-BR/no speech/ruído/correção/transcrição parcial; nunca interpretar mock como evidência do provedor.
8. Homologar lote conversacional real, recuperação assistida, contexto por data e confirmação de reminders vinculados antes de declarar evolução completa.

## Validação

Validação final: 231 arquivos, **3.299 testes passaram, zero falhas, zero erros, 21 skips**. A rodada dedicada de WhatsApp teve 153 arquivos e 2.537 testes passando; a rodada global final também inclui o último ajuste de serialização SQL entre lotes. Os skips são cinco testes de bens/financiamentos dependentes de banco, 14 de contas conectadas dependentes de banco/QA/TODO e dois skips existentes de edição de contas pelo WhatsApp.
`bun run typecheck` passou. `bun run build` passou; permaneceram avisos de bundling sobre diretivas use client, opção platform e tamanho de chunks. `git diff --check` passou. Testes SQL são exclusivamente PGlite em memória; nenhum script foi enviado ao Cloud. Build é local, não deploy. `src/routeTree.gen.ts` não recebeu alteração. As quatro migrations pendentes foram preservadas sem alterações.
Teste integrado Agenda usa banco/fila em memória e transporte Meta mockado. Ele não é prova de entrega real nem cobertura integral do handler HTTP do dispatcher; os testes HTTP existentes cobrem o dispatcher separadamente.
Não há acesso ao consumo real de créditos por tarefa/conversa. Não foi estimado.
