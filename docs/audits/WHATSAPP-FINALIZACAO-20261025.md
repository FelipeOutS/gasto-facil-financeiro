> Atualização pré-PR: bloqueios F2 e peers corrigidos nos commits 2f32b3c0 e 2e4c62aa. Consulte WHATSAPP-PRE-PR-20261025.md e o manifesto SHA-256 atual. O texto abaixo registra a rodada anterior; não autoriza produção nem ativação.

# WhatsApp — auditoria, correções e homologação local (25/10/2026)

## A. Visão executiva

Esta entrega é uma versão local para revisão, **não uma liberação comercial**. Não houve push, merge, deploy, migração compartilhada, alteração de segredos, envio Meta, submissão de templates, ativação de cron, Shopping ou exclusão mensal. Os controles Pluggy não foram alterados.

Base confirmada por fetch: `a1ea7ea283760657bc55a1e5c9d536281f977ef5`. Branch: `codex/whatsapp-finalizacao-20261025`. Checkout reutilizado: `E:\Projetos\APLICATIVO GASTO INTELIGENTE\pluggy-homologation-20261021`. Commit local de código/SQL/testes: `efe4b8ae61457e2426aa1201d0d0b8b934732aeb`. Consulte [validação](WHATSAPP-VALIDACAO-20261025.md) para resultados finais e [hashes SQL](WHATSAPP-SQL-SHA256-20261025.md).

Correções principais: versão Graph suportada; catálogo aprovado obrigatório no dispatcher; templates candidatos da Agenda; bloqueio de avisos antigos; mídia limitada a domínios Meta sem redirecionamento; limite de streaming no webhook; rate-limit indisponível bloqueia respostas; recuperação persistente criptografada e inativa; desfazer reversível com proteção de edição posterior; barreira conservadora para principal de empréstimos/devoluções; atualização do Seroval vulnerável.

Metodologia: leitura dos pontos de entrada, persistência, autorização e transporte; confronto com testes existentes; novos testes de regressão; instalação limpa; runner Bun com processo separado por arquivo; PGlite e cluster PostgreSQL 17 descartável com duas sessões reais. O inventário complementar registra arquivos, tabelas, RPCs, funções e nomes de configuração extraídos do código, sem ler segredos.

**Cobertura funcional percentual não pode ser confirmada:** não há instrumentação que ligue todos os cenários comerciais a um denominador de cobertura. Não confundir quantidade de testes aprovados com cobertura de todas as funções. A cobertura mensurável de execução dos arquivos e suas exclusões consta da seção E. Todos os grupos abaixo foram mapeados; vários continuam com homologação externa pendente.

A fotografia externa de banco fornecida na missão é contexto histórico, não foi reconfirmada nesta sessão. Portanto presença de estruturas, flags atuais, vínculos, tentativas antigas, templates aprovados e estado publicado são **não verificados no ambiente real**. Não interpretei `main` ou existência de migrations como evidência de instalação no Lovable Cloud.

## B. Matriz funcional

Colunas comuns a todas as linhas: banco real = não verificado; homologação Meta/celular = pendente; alterações desta branch = não publicadas. “Local” indica testes com fixtures/mocks/SQL descartável, não validação do serviço real.

| Grupo / entrada e persistência | Código e controles | Evidência local | Estado / pendência |
|---|---|---|---|
| Webhook `/api/public/whatsapp/expense` | HMAC, Zod, limite de 64 KiB durante streaming, rate-limit e identidade server-side | `whatsapp-webhook-http`, `whatsapp-hardening-b3`, `whatsapp-final-security` | Implementado; homologar assinatura/timeout/reentrega Meta |
| Vínculo, confirmação e opt-out | `whatsapp-authz`, `whatsapp-link`, entitlement; vínculo ativo, consentimento, revogação e plano; Admin não troca o titular | `whatsapp-authz`, `whatsapp-optout`, testes de link e entitlement | Implementado; confirmar troca de telefone, plano e consentimento reais |
| Gastos texto e áudio | `whatsapp.server`, `gastos`, sessões em `whatsapp_messages`, quota e ID determinístico | valores/milhar, lote áudio, idempotência, quotas, validação final | Implementado; homônimos/datas e confirmação em celular pendentes |
| Receitas únicas/recorrentes | `whatsapp-receitas`, `receitas`, `recorrencias`, RPC recorrente e quota | receitas, períodos, serialização e `whatsapp-principal-no-write` | Implementado; bloqueio conservador novo de principal/devolução |
| Conciliação entre fontes | IDs idempotentes por operação WhatsApp; consultas compartilhadas | dedupe e leitura de importados existentes | **Parcial**: IDs por mensagem não provam dedupe entre relato manual e transação bancária já importada; não executar conciliação automática |
| Principal/adiantamentos | Guarda antes da persistência de gasto/receita e etapas de receita | frases de empréstimo, resgate, estorno, reembolso, cofrinho e exemplo fictício de 185 | Bloqueia classificação indevida; vínculo completo a Contas a Receber ainda depende de dados e confirmação; nenhum registro real criado |
| Edição/exclusão/restauração antiga | `whatsapp-editar-antigo`, usuário, nonce e CAS `updated_at`, soft-delete | testes P1 de edição antiga e F3 | Implementado; mantém restrições sobre importados, parcelas e vínculos |
| Desfazer recente | `whatsapp-postlaunch` chama exclusivamente RPC **v2**; SQL revalida vínculo/plano, bloqueia edição posterior e soft-delete | PGlite + duas sessões nativas | **Necessita migração**: sem v2 instalada falha fechado, não usa a RPC antiga |
| Exclusão/restauração mensal | `whatsapp-lote-mes`, lote por dono/período, locks e carimbo de exclusão | `whatsapp-lote-mes-p1` | Implementado, bloqueado por `LOTE_MES_RELEASE_AUTHORIZED=false`; candidata não aplicada |
| Cartões e cadastro Flow | `cartao-cadastro.server`, validador compartilhado, `cartoes`, escolha explícita e ID por pedido | cadastro, nomes iguais, listar cartões, Flow | Implementado; registro/publicação Flow e teste Meta pendentes |
| Compras/faturas/parcelas | Serviços compartilhados, competência e arredondamento, escolha de cartão | faturas, fechamento 29–31, virada de ano, parcelas | Implementado nos caminhos cobertos; estornos/conciliação de fontes exigem referência confiável, não inferida |
| Contas a pagar / baixa | `whatsapp-contas-pagar` → `whatsapp_baixa_conta_atomic`, readback e quota; conta + gasto atômicos | criação, baixa, pessoa, edição, lembretes e SQL existentes | Implementado; não executa pagamento bancário. Não confundir baixa contábil com transação bancária |
| Contas a receber | Módulo compartilhado e orientação de uso | limites de classificação, sem criar exemplo pessoal | **Parcial**: fluxo conversacional completo de adiantamento/devolução parcial não foi inventado; permanece fora da automação |
| Áudio | Download limitado, MIME/bytes/duração, timeout e pipeline financeiro comum | áudio/duração/voice-number, lote e falhas | Implementado; **não houve gravações reais de sotaques ou chamada paga de transcrição** |
| Foto/PDF/comprovante/boleto | Download Meta seguro, formato/limites, OCR e confirmação, números monetários | mídia, OCR, boleto, milhar e decimal | Implementado nos contratos locais; fidelidade OCR e qualidade de imagem precisam de amostras autorizadas |
| Agenda | `agenda.server` compartilhado; `agenda_items`, cancelar/re-enfileirar, revalidar origem, fuso e recorrência | Agenda, recorrência, cancelamento, fatura | Preparado; catálogo candidato dos dois eventos começa draft/inativo |
| Catálogo / gestão Meta | Allowlist de cinco eventos, pt_BR, UTILITY, versão e provider ID; não admite hello_world | resolver, management, catálogo, dispatcher | Configuração externa pendente: submissão, aprovação e sincronização real |
| Dispatcher / filas | HMAC, claim/lease, quotas, revalidação, quiet hours e callbacks; atraso >24h descartado | concorrência, recovery, backoff, ownership, freshness | Preparado; sem reenviar tentativas ambíguas; cron não ativado |
| Outbox de respostas | AES-256-GCM com AAD dono+mensagem, unicidade, claim atômico, callbacks, limites e recuperação restrita ao próprio titular/Admin Master | runtime 400/401/403/429/500/200, revogação, chave errada, falha de finish; SQL e duas sessões | Implementado **e bloqueado**. Ainda não é garantia transacional ponta a ponta; ver H/K |
| Alertas proativos | Geradores existentes e preferências/cotas; allowlist do envio não libera eventos sem catálogo | proactive, notifications e quotas | Parcial por evento: fatura/orçamento/metas/resumos não ganham aprovação só porque há gerador; bloqueados sem mapeamento aprovado |
| Shopping | Módulo isolado, reserva/finish RPC, 10 pesquisas por usuário/mês, 200 chamadas globais/mês no candidato | Shopping mocks, quotas e falhas SerpApi | Implementado, bloqueado por `SHOPPING_RELEASE_AUTHORIZED=false`; sem chamadas pagas |
| UI WhatsApp / Admin | Plano/consentimento, runtime, catálogo; aviso de homologação e consulta/recuperação das próprias respostas | typecheck/build, rotas HTTP locais, testes admin existentes | Preparado; responsividade visual e uso autenticado no celular ainda não homologados |

Inventário detalhado: [WHATSAPP-INVENTARIO-20261025.md](WHATSAPP-INVENTARIO-20261025.md). Consultas literais extraídas não substituem análise de queries dinâmicas ou RLS instalado.

## C. Segurança e integridade

- Assinatura HMAC permanece obrigatória. O corpo é limitado em bytes durante streaming, antes de parse, em vez de alocar todo o payload e medir caracteres depois.
- Downloads de mídia não encaminham Bearer para localhost, host arbitrário, domínio com sufixo enganoso, URL com credenciais ou porta alternativa. Redirecionamentos são recusados nos dois passos. A lista admite hosts HTTPS Meta (`graph.facebook.com` para lookup; domínios Meta controlados para bytes).
- Resposta de “número não autorizado” não sai se o banco do rate-limit falhar. Telefone no limitador permanece hash.
- Outbox: ciphertext com AES-GCM; chave não foi criada nem lida; identificador Meta/código de estado sem texto financeiro em log. RLS forçada; anon/authenticated sem tabela/RPC; service_role com procedimentos controlados. Recovery exige sessão autenticada, Admin Master e filtro **do próprio usuário**, sem parâmetro de user_id no cliente.
- Desfazer v2 revalida vínculo/opt-in/revogação e `has_feature_access` no banco. Nulo também bloqueia. Locks + `updated_at` protegem registros editados depois da ação; ausência de coluna/valor bloqueia. Exclusão passa a ser lógica.
- Principal de empréstimos, devoluções e transferências não vira renda/despesa por classificação automática. A regra é conservadora e pode pedir análise de frases legítimas que mencionem esses termos. Não resolve conciliação bancária nem cria vínculo automaticamente.
- Consultas e operações financeiras continuam nos serviços/tabelas compartilhados. O caso dos 185 permanece somente em fixture fictícia, sem conta a receber real.
- Há uma janela inerente entre última verificação de consentimento e uma chamada HTTP externa; a fila não promete atomicidade distribuída com a Meta. Revalidar antes do envio reduz a janela, não a elimina.
- Auditoria de dependências confirmou Seroval vulnerável. Overrides e os dois lockfiles passam de 1.5.6 a 1.6.3; framework e Vite não foram atualizados em massa. O registro de validação inclui as vulnerabilidades remanescentes, sem tratá-las como resolvidas.

## D. Correções e prioridades

| Prioridade | Arquivo/área | Causa e correção | Teste |
|---|---|---|---|
| P0 | `whatsapp-graph-version.server.ts` | v20 expirada; centralização mantida, única versão autorizada candidata v25.0, sem fallback silencioso | graph-version-unification, transport, áudio |
| P0 | `whatsapp-dispatcher-outbound.server.ts` | Nome preenchido não provava aprovação; resolver aprovado agora é obrigatório antes de attempt/HTTP; recipient e elegibilidade relidos | wiring, hardening, catálogo, final-security |
| P0 | `whatsapp-undo-soft-delete.sql` + postlaunch | Desfazer apagava linhas e podia remover edição manual; soft-delete, verificação de modificação, auth no banco e RPC v2 sem fallback | undo PGlite + native race |
| P0 | package.json, package-lock.json, bun.lock | Overrides retinham Seroval vulnerável; atualização mínima para 1.6.3 | auditoria npm e serialização/TanStack |
| P1 | bounded-fetch e webhook | Download arbitrário com Bearer / corpo ilimitado durante leitura; allowlist, redirect:error, streaming e timeout | final-security, webhook-http, pacote2 |
| P1 | authz | Falha de rate-limit permitia resposta; falha passa a bloquear | authz DB-error |
| P1 | outbox SQL/TS/callback/admin | Respostas sem recuperação persistente; snapshot criptografado, claim/lease, estados e recovery manual | runtime, SQL, native |
| P1 | Agenda/mapping/candidato | Faltavam catálogo e data canônica de lembretes; dois templates draft/inativos | agenda-template-sql, Agenda |
| P1 | freshness/dispatcher | Avisos antigos podiam ser enviados após recuperação; política explícita de 24h | final-security |
| P1 | receitas/gastos | Principal/devolução podia seguir para renda/consumo; bloqueio antes de quota/escrita | income-reconciliation, principal-no-write |
| P2 | Admin | Flags eram insuficientes como prova operacional; aviso e estados reais, recovery limitado à própria conta | build/typecheck e revisão de acesso |

O teste legado que esperava `hello_world` no executor foi corrigido para esperar bloqueio **sem executor**, não apagado. Testes históricos que reproduzem a RPC antiga insegura continuam documentando a diferença para a candidata.

## E. Testes e limites de verificação

Resultados finais estão em `WHATSAPP-VALIDACAO-20261025.md`, gerado a partir dos logs. O runner oficial isola cada arquivo para evitar contaminação de mocks. `TEST_CONCURRENCY=2` reduz disputa de memória com PostgreSQL em memória.

Instalação: `npm ci --ignore-scripts --no-audit --no-fund`, com package-lock oficial. Scripts de instalação externos foram suprimidos; typecheck e build comprovam as dependências necessárias ao app. Bun 1.4.2 executa o runner; Node 24.19.0 e PostgreSQL 17.11 foram usados. Os lockfiles npm/Bun receberam apenas o ajuste de Seroval/plugins.

Exclusões explícitas da execução geral:
- `security-has-role-bypass`: pode consultar ambiente externo.
- `whatsapp-rpc-security-guard`: depende de conexão/segredo de banco compartilhado.
- `bens-financiamentos-v1`: integração com ambiente externo.
- `connected-accounts-viewer-policy-sec-ca-01b`: integração com banco externo.
- `tests/e2e`: não foi iniciada automação autenticada que possa gravar dados reais.

Esses arquivos não foram removidos nem considerados aprovados. Os dois skips reportados pelo runner também não são aprovações. Cobertura SQL das mudanças foi executada separadamente em banco descartável, não por essas conexões externas.

Casos novos: HTTP 400/401/403/429/500/200; timeout; falha de persistência pós-envio; preservação de snapshot criptografado; chave/AAD incorretos; revogação antes do HTTP; callback antes do finish; duplicado/fora de ordem; tentativa concorrente; acesso de outro titular; mídia host indevido; janela expirada; catálogo pendente/rejeitado/pausado/desabilitado; nomes herdados de prototype; empréstimo/adiantamento sem escrita; alteração manual antes de desfazer; rate-limit indisponível.

PostgreSQL nativo: o script `scripts/test-whatsapp-native.ts` cria cluster novo em diretório temporário, escuta só loopback em porta aleatória e remove apenas o diretório que criou. Não aceita DATABASE_URL; limpa variáveis PG herdadas. Duas sessões comprovam enqueue único, um único claim, callback preservado e desfazer aplicado uma vez com preservação física da linha.

Limites: HTTP localhost 200 comprova renderização SSR das rotas, não login real, permissões remotas ou layout visual de todos os estados. Não houve envio Meta real, OCR/transcrição pagos, teste de sotaque gravado, plano real cancelado nem aparelho celular. O build mostra avisos de dependências (diretivas `use client`/anotações de pureza) sem que isso seja prova de defeito funcional. Lint semântico e dívida de formatação são separados no registro de validação.

## F. SQL candidato, dependências e aplicação

Hashes SHA-256 estão no arquivo `WHATSAPP-SQL-SHA256-20261025.md`, calculados sobre os bytes finais. Verificar hash novamente antes de aplicar; conversão LF/CRLF pode mudar o hash sem mudar a lógica.

| Arquivo em docs/migrations-candidate | Estado | Dependências / aplicação | Reversão segura |
|---|---|---|---|
| `whatsapp-reply-outbox.sql` | Revisado; NÃO aplicado | mensagens externas com user/telefone; links; has_feature_access; papéis Supabase. CREATE TABLE deliberadamente aborta se schema antigo já existe. Comparar schema antes de adaptar; não apagar tabela existente | Desligar env/release de envio; continuar callbacks; preservar tabela e histórico. Não reenfileirar ambiguous |
| `whatsapp-agenda-templates.sql` | Novo; NÃO aplicado | notification_templates C8 com categoria agenda (planning_actions) e meta_templates C11. Seeds idempotentes `ON CONFLICT DO NOTHING`, não sobrescrevem aprovação/estado do operador | Desativar só duas chaves; não excluir histórico referenciado |
| `whatsapp-undo-soft-delete.sql` | Revisado; NÃO aplicado | F2/F3: deleted_at/updated_at; recent_actions; links; has_feature_access; contas/receitas/recorrencias. Aplicação integral em transação cria v2 e protege função antiga | Suspender desfazer; não restaurar código SQL que apagava fisicamente. Registros excluídos logicamente não são restaurados em massa |
| `whatsapp-lote-mes.sql` | Candidato preexistente; inalterado | F2/F3/F4 e colunas de origem; piloto e revisão de estado instalado | Manter trava falsa; não restaurar registros fora do próprio lote |
| `whatsapp-shopping-quota.sql` | Candidato preexistente; inalterado | Tabelas/RPCs de quota; locks transacionais, mês São Paulo | Desligar Shopping; manter consumo auditável |

Todas as migrations do repositório relacionadas a WhatsApp/Agenda constam no inventário. **Aplicada/parcialmente aplicada/obsoleta no banco real: indeterminado** sem inspeção de schema. Não há autorização implícita para reaplicar migrations antigas ou substituir o schema real pelo fixture mínimo dos testes.

Ordem candidata: inventário read-only do schema real → dependências F2/F3/F4 compatíveis confirmadas → SQL de desfazer v2 em janela coordenada → outbox (ainda desligada) → seeds Agenda inativos → verificação de grants/RLS → código homologado. Não aplicar F2/F3/F4 automaticamente só porque foram citadas; requer revisão própria de impacto nos demais módulos.

## G. Meta e versão Graph

Escolha candidata: **v25.0**, suportada e fixada centralmente. A tabela oficial consultada indica v20 encerrada em 24/09/2026 e v25 válida até 29/07/2028. A versão mais nova disponível não é condição para esta correção; evitar mudar contrato sem homologação.

Fontes oficiais consultadas:
- https://developers.facebook.com/docs/graph-api/changelog/versions/
- https://developers.facebook.com/docs/graph-api/changelog/version25.0/
- https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api

A autorização de versão ainda falha fechada: ausência ou valor antigo de `WHATSAPP_GRAPH_VERSION` não escolhe uma versão automaticamente. A configuração de servidor para v25.0 precisa ser feita pelo operador autorizado na janela coordenada; não foi modificada nesta missão.

Passos externos separados:
1. Conferir no painel Meta o app, WABA e número corretos, sem copiar tokens ao chat.
2. Conferir permissões `whatsapp_business_messaging`/`whatsapp_business_management`; `business_management` quando a operação de negócio exigir.
3. Validar leitura de conta/registro/assinatura em homologação. Não registrar número ou webhook automaticamente.
4. Conferir callback HTTPS, verify token e assinatura HMAC, com teste autorizado e fixture não financeira.
5. Revisar no Admin as prévias e exemplos dos cinco templates. Dois da Agenda começam draft/inativos. Não usar hello_world para lembrete financeiro.
6. Submeter apenas após autorização. Depois sincronizar o status real e confirmar idioma, categoria, nome, provider ID e qualidade. Só então ativar seletivamente catálogo e preferências.
7. Testar callback accepted/sent, delivered e read; ausência de read não é falha se o destinatário desativou confirmação.

O catálogo aprovado local não prova que a Meta não pausou o template depois da última sincronização. Manter rotina operacional de sincronização e tratar rejeição/pausa; não há promessa de monitoramento remoto contínuo instalado nesta entrega. HTTP 200 significa aceite, nunca entrega garantida. Timeout/429/5xx entram em caminho conservador de resultado incerto, sem reenvio cego.

## H. Agenda, notificações e recuperação

Caminho preparado: Agenda compartilhada → `whatsapp_notifications` → elegibilidade/claim → revalidação de origem → resolver de catálogo aprovado → tentativa Meta → callback autenticado → histórico.

Política de avisos antigos: `scheduled_at` inválido ou mais de 24h anterior ao relógio do dispatcher recebe `notification_expired`; não dispara mensagem atrasada. Até 24h, demais gates continuam necessários. Não restaurar automaticamente as três notificações históricas citadas pelo usuário. Examinar IDs, tipo, dono, lease, tentativas e callbacks com acesso read-only autorizado, sem exportar conteúdo financeiro.

Uma lease expirada depois de possível HTTP não autoriza novo envio. Tentativa ambígua fica em quarentena e precisa de evidência da Meta/callback. Conta paga/cancelada e lembrete alterado devem ser revalidados, não enviados pelo snapshot financeiro antigo. Sem preferência explícita/catalogo aprovado, não assumir consentimento para proativos.

Outbox candidata:
- Histórico imutável de transições em `whatsapp_reply_outbox_events`, sem telefone ou conteúdo; INSERT/SELECT somente service_role, sem UPDATE/DELETE.
- Identidade única `(user_id,inbound_external_id)` e conteúdo original criptografado, imutável em replay.
- `pending → sending → accepted/delivered/read`, ou `rejected/ambiguous/cancelled/expired`.
- Claim/lease de 60 s; no máximo três claims; janela de atendimento de 24h. Recovery de rejeição explícita sem provider ID exige espera mínima de 5 min e revalidação. Cada claim pode tentar o interativo e, somente após rejeição inequívoca, texto; não faz fallback após resultado incerto.
- Admin da própria conta pode consultar status e confirmar recuperação. Não existe recovery automático ativado. Recovery não executa parser financeiro.
- Desligar os envios não interrompe reconciliação de callbacks identificados como `wa_reply:<uuid>`; eventos já enviados continuam recebendo estado.
- **Limitação importante:** o efeito financeiro e o enqueue de resposta não estão na mesma transação. Uma queda depois de salvar finanças e antes de persistir o snapshot ainda exige análise. Não preencher automaticamente a outbox a partir de histórico antigo, pois pode já ter havido entrega. Isso impede chamar a solução de “entrega garantida”.
- Falha de banco após HTTP mantém resultado incerto; a consulta administrativa ou nova tentativa de claim leva a lease expirada à quarentena, não a reenvio. Não confundir ausência de registro de sucesso com prova de não envio.

## I. Recursos bloqueados

`REPLY_OUTBOX_RELEASE_AUTHORIZED=false`, `LOTE_MES_RELEASE_AUTHORIZED=false` e `SHOPPING_RELEASE_AUTHORIZED=false` permanecem. Não existe fallback que remova essas travas por configuração do cliente. Env novo de outbox e chave AES independente são requisitos futuros, não valores criados nesta missão.

O desfazer v2 depende do SQL candidato: até existir no ambiente, o usuário recebe falha controlada e nenhuma exclusão acontece por fallback antigo. Proativos adicionais sem mapeamento aprovado não são liberados. Aprovação local de template não foi fabricada.

## J. Ordem mínima de publicação/homologação

1. Revisar diff e este relatório, inclusive riscos remanescentes; aprovar envio da branch ao GitHub separadamente.
2. PR com testes e hashes; conferir o SHA efetivo no Lovable Preview. Sincronização não é publicação.
3. Inventariar banco/flags por acesso read-only e aprovar as migrations específicas, nunca o conjunto inteiro por associação.
4. Homologar SQL em cópia descartável compatível com schema real e preparar janela de desfazer v2; deixar outbox/Shopping/lote mensal bloqueados.
5. Aprovar configuração Graph v25.0 no servidor. Validar permissões e webhook sem expor credenciais.
6. Testar no Preview login/plano/consentimento e inbound autorizado. Validar duplicação, cancelamento, valor, datas, cartão e readback do site.
7. Autorizar mensagem outbound isolada para número do titular. Confirmar callbacks e estado real.
8. Revisar/submeter/sincronizar templates; piloto de Agenda com consentimento e quiet hours, cron ainda sob controle operacional.
9. Resolver a lacuna transacional da outbox e riscos restantes antes de autorizar ativação. Não ligar recovery em lote nem reenviar histórico.
10. Publicação somente após nova autorização; teste no celular com operações fictícias autorizadas em ambiente de homologação, depois ampliação gradual com plano de retorno. Não usar o caso pessoal dos 185 como teste real.

## K. Riscos e bloqueios remanescentes

- P0 histórico do banco: RPC antiga de desfazer pode existir sem correção. O código local usa v2 sem fallback; outras versões publicadas não foram alteradas.
- P1: deduplicação WhatsApp por mensagem não equivale a conciliação entre fontes. Relato manual de transação já importada requer vínculo confiável/confirmado. Pluggy não foi alterada.
- P1: crash entre transação financeira e snapshot da resposta; recuperação administrativa não pode reconstruir e reenviar histórico sem prova de não entrega. Outbox permanece bloqueada.
- P1: status remoto de templates, preferências, leases históricos, schema e flags atuais não confirmados. Aprovação comercial exige essa inspeção e envio autorizado.
- P1: auditoria npm ainda pode apresentar alertas altos de outras dependências; contagem final no registro. Atualização ampla do toolchain/transitivas requer avaliação própria para não misturar uma migração do framework a esta missão. Correção crítica do Seroval foi isolada e testada.
- P1: confirmação em celular, leitura OCR e sotaques/transcrição reais não testados. Testes de mocks não permitem prometer acurácia em documentos/áudios reais.
- P2: lint de arquivos legados contém dívida de formatação/CRLF. Não foi feito redesign nem reformatação massiva do pipeline de milhares de linhas.
- Parcial: conversa completa de adiantamentos e devoluções parciais, conciliação de estorno com compra original e todos os alertas comerciais não podem ser considerados concluídos apenas pelos bloqueios conservadores. Continuam exigindo modelagem/dados confirmados e homologação.

## L. Próximas autorizações

1. **GitHub/PR:** enviar somente a branch revisada; sem merge automático.
2. **Leitura operacional:** conferir schema, runtime, preferências, catálogo e IDs de tentativas históricas sem conteúdo privado nos relatórios.
3. **Banco:** aprovar separadamente cada SQL por nome/hash e dependências verificadas. Desfazer v2 precisa de coordenação com publicação.
4. **Servidor/Meta:** ajustar versão Graph e validar credenciais/permissões no painel; nenhum segredo deve ser enviado no chat.
5. **Templates:** aprovar submissão dos textos revisados e sincronização; não equivale a autorização de disparo.
6. **Homologação outbound/celular:** autorizar destinatário, tipos de teste e ambiente; confirmar callbacks antes do piloto de Agenda.
7. **Publicação:** decisão posterior, condicionada à resolução dos riscos comerciais. Outbox/Shopping/lote mensal exigem aprovação própria e continuam desligados.

Créditos/tokens reais e duração consolidada de toda a conversa não estão disponíveis; não consigo confirmá-los. Os tempos pontuais de ferramentas não constituem custo de créditos nem duração total.
