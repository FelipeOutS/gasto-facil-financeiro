# Anexo 4 — Agenda, Lembretes, Notificações, Contas, Pix, Extrato, Estorno, Undo, Soft-delete

Auditoria de código estático (read-only). Convenções: **APLICADA** = existe em `supabase/migrations/*`. **CANDIDATA** = existe apenas em `docs/migrations-candidate/*.sql`, não aplicada ao banco real. **HIPÓTESE** = não confirmado em código, inferência razoável. **NÃO VERIFICADO** = fora do escopo lido nesta rodada.

---

## 1. Visão geral da arquitetura

- Núcleo único da Agenda: `src/server/agenda.server.ts` (562 linhas, lido integralmente), usado tanto pelo site (`src/lib/agenda.functions.ts`) quanto pelo WhatsApp (`src/server/whatsapp-agenda.server.ts`).
- Vínculos financeiros (`source_type`/`source_id`) nunca gravam valor/vencimento "congelados" — `resolveFinancialSource` (agenda.server.ts:347-395) sempre lê a origem (`contas_a_pagar`, `cartoes`+fatura, `recorrencias`) na hora, inclusive no momento do disparo (`revalidateAgendaForDispatch`, linhas 495-548).
- Fila de avisos reaproveita `whatsapp_notifications` (categoria `agenda`), com gates compartilhados (`whatsapp-notification-gates.server.ts`, lido integralmente) para opt-in de canal, opt-in de categoria, quiet hours e janela de 24h/HSM.
- Dispatcher (`public.hooks.whatsapp-dispatcher.ts`, lido integralmente) tem **early-exit antes de qualquer leitura ao banco** quando `WHATSAPP_DISPATCH_ENABLED` ou `WHATSAPP_OUTBOUND_HTTP_ENABLED` não são exatamente a string `"true"` (parser estrito, `parseStrictBool`, linhas 56-65) — comportamento fail-closed correto.
- Soft-delete de `gastos` (coluna `deleted_at`) é **CANDIDATO, não aplicado**: `docs/migrations-candidate/gastos-soft-delete-f2.sql` ainda não está em `supabase/migrations/`. Já está **APLICADO** para `receitas.deleted_at` (migração `20260731181756_aca19664...sql`, grep confirmado).

---

## 2. Agenda — criar/listar/concluir/editar/cancelar/adiar

### 2.1 Paginação e limites (P1)
- `listAgenda` (agenda.server.ts:271-290) usa `.limit(opts.limit ?? 200)` e filtra `fromIso/toIso` **em memória, depois** de já ter aplicado o limite do banco. Se o usuário tiver mais de 200 itens ativos no período filtrado, itens relevantes podem ficar de fora silenciosamente — a função não sinaliza truncamento ao chamador (não há `hasMore`).
  - `src/lib/agenda.functions.ts:40` (site) chama com `limit: 500`, mitigando mas não eliminando o risco para usuários com histórico muito grande (lembretes + compromissos + vínculos financeiros acumulados).
- `listActivePage` (agenda.server.ts:292-313) é a página "estável" usada pelo cancelamento via WhatsApp (`cancelPage`, whatsapp-agenda.server.ts:485-505), com `CANCEL_PAGE_SIZE = 8` (linha 481) — bate com o requisito de paginação de 8 itens. Usa `.range()` no banco (não em memória) e tem checagem redundante `r.user_id === userId` (linha 312) — defesa em profundidade correta.
- **P2 — Dessincronia de fonte entre `listAgenda` (limit 200/500) e `listActivePage` (paginada por `.range`)**: duas implementações de paginação distintas para o mesmo recurso aumentam risco de drift comportamental futuro (ex.: ordenação secundária por `id` existe só em `listActivePage`, não em `listAgenda`, o que pode gerar itens duplicados/faltantes entre páginas se dois itens tiverem o mesmo `starts_at` em `listAgenda`).

### 2.2 Ownership (confirmado — sem achados)
- Toda query filtra `.eq("user_id", userId)` explicitamente, tanto em `agenda.server.ts` quanto em `contas-vencimento.server.ts` — defesa em profundidade sobre RLS, consistente com o padrão do restante do projeto.
- `assertSourceOwned` (agenda.server.ts:115-123) confere que o item financeiro vinculado (`conta_a_pagar`/`cartao`/`recorrencia`) pertence ao mesmo `user_id` **antes** de gravar o vínculo — e o `insert` ainda depende de um trigger de banco (`agenda_source_not_owned`, mencionado na linha 151) como segunda camada. **NÃO VERIFICADO**: não li a migração que cria esse trigger (`agenda_validate_source`, citado no cabeçalho do arquivo) — não localizada nos grep de `supabase/migrations` feitos nesta auditoria; marcar como pendência de verificação em auditoria de schema.

### 2.3 Concluir/cancelar — condição de corrida (confirmado, mitigação correta)
- `setAgendaStatus` (agenda.server.ts:224-270) usa **UPDATE condicional** (`.eq("status","ativo")`, e quando avança recorrência também `.eq("starts_at", cur.starts_at)`) e trata ausência de linha afetada como erro `"already"` (cliques duplicados/retries simultâneos) em vez de erro genérico. Isso evita dupla reconciliação da fila de avisos. **Ponto positivo, sem achado.**

### 2.4 Recorrência mensal dia 31 e semanal (confirmado — correto)
- `recurrence.ts:17-33` (`stepOnce`): para `mensal`/`anual`, usa `Math.min(anchorDay, daysInMonth(y,m))` — dia 31 cai para o último dia de meses mais curtos **sem pular o mês seguinte automaticamente após o encolhimento** (ex.: 31/jan → 28 ou 29/fev, próxima ocorrência volta a tentar ancorar no dia 31 de março, não ficando "preso" em 28). Lógica validada por leitura; **não há teste de unidade localizado nesta auditoria** (fora do escopo — não vi arquivos `*.test.ts` para `recurrence.ts`). NÃO VERIFICADO empiricamente.
- Semanal usa `addDaysYmd(base, 7*n)` — correto e preserva o dia da semana da âncora.
- `nextOccurrence` tem **guarda de segurança de 7400 iterações** (linha 53) para não entrar em loop infinito com `interval` pequeno e `until` muito distante — ponto positivo.

### 2.5 Timezone América/São_Paulo e DST (confirmado)
- `localToUtc` (datetime.ts:60-66) faz dupla passada de correção de offset para cobrir transições de DST — padrão correto para zonas com histórico de horário de verão (Brasil não tem mais DST desde 2019, mas o código é genérico por IANA tz, então a lógica permanece útil para robustez/portabilidade).
- `whatsapp-notification-gates.server.ts` tem implementação **própria e duplicada** de conversão de wall-clock↔UTC (`localPartsInTimezone`, `zonedWallTimeToUtc`, linhas 150-202) ao invés de reusar `src/lib/agenda/datetime.ts`. **P2 — duplicação de lógica de timezone** entre dois módulos críticos (Agenda e Gates) aumenta risco de divergência de comportamento em casos de borda de DST se um for corrigido e o outro não.

### 2.6 Horários passados ao criar (confirmado — tratado)
- `handleAgendaIntent` caso `"criar"` (whatsapp-agenda.server.ts:301-309): se o horário resolvido já passou, tenta avançar pela recorrência (`nextOccurrence`); se não há recorrência, recusa com mensagem pedindo novo horário — **não cria item no passado**. Sem achado.

---

## 3. Lembretes financeiros (vínculo com contas/cartões/recorrências)

### 3.1 Leitura sempre ao vivo (confirmado — ponto forte)
- `resolveFinancialSource` nunca usa snapshot gravado; `computeNextAviso` e `revalidateAgendaForDispatch` recalculam tudo no momento do envio. Isso cobre corretamente o requisito "nunca enviar valor desatualizado".
- **P1 — custo de leitura cartão em cada avaliação**: para `source_type === "cartao"`, `resolveFinancialSource` chama `getFaturaAtualPorCartao` (import dinâmico, linha 374-377) a cada cálculo de próximo aviso. Em instalações com muitos lembretes de fatura, isso gera N consultas de fatura completa por ciclo de geração de lembretes. Não é um defeito de corretude, mas é um risco de desempenho/custo sob escala (HIPÓTESE, sem medição de carga nesta auditoria).

### 3.2 Revalidação no dispatcher (confirmado — ponto forte)
- `revalidateAgendaForDispatch` (agenda.server.ts:495-548): compara o horário de aviso **planejado no payload** (`n.payload.aviso_at`) com o **esperado recalculado agora** com tolerância de 60s (linha 511/536). Se divergir >60s, cancela o envio e resincroniza (`agenda_changed`), evitando enviar aviso com data errada se o vencimento mudou entre o enfileiramento e o disparo.
- Cobre corretamente conta paga (`payable_paid`), conta cancelada (`payable_cancelled`) e item/registro apagado (`agenda_inactive`).

### 3.3 Edição de antecedência / data (confirmado)
- `updateAgendaItem` para item com vínculo financeiro bloqueia alteração de `starts_at` nulo exigindo "Informe data e horário" apenas quando `!cur.source_type` (linha 210) — ou seja, itens financeiros não são obrigados a ter `starts_at` (correto, pois a data vem da origem).
- No WhatsApp, editar a data de um item financeiro é explicitamente recusado com mensagem de orientação ("altere o vencimento em Contas/Cartões") — `whatsapp-agenda.server.ts:402-403`. Sem achado.

---

## 4. Cancelamento com confirmação assinada (token de 30 min)

### 4.1 Implementação do token (lido integralmente: `agenda-confirm-token.server.ts`)
- HMAC-SHA256 truncado a 22 chars base64url, chave derivada via HKDF do segredo `WHATSAPP_BOLETO_FINGERPRINT_SECRET` com domínio dedicado `"gi-agenda-cancel-confirm-v1"` — reuso de segredo com domínio separado (boa prática de *domain separation*).
- `verifyCancel` usa `timingSafeEqual` (proteção contra *timing attack*) e checa janela de validade `0 <= age <= CANCEL_TTL_MIN` (30 min, exato conforme requisito do escopo). **Confirmado: TTL = 30 minutos.**
- **P1 — fail-closed dependente de variável de ambiente ausente**: `key()` retorna `null` se `WHATSAPP_BOLETO_FINGERPRINT_SECRET` ausente ou < 16 chars; `signCancel` então retorna `null`, e `askCancel` (whatsapp-agenda.server.ts:517-518) responde "Não consigo confirmar cancelamentos agora. Nada foi alterado" — comportamento correto (fail-closed), mas **o secret usado é compartilhado com outro domínio de segurança não relacionado** (fingerprint de boleto). Se esse segredo for rotacionado por outro motivo (ex.: incidente de boleto), **todos os cancelamentos pendentes de Agenda no WhatsApp expiram silenciosamente e de forma simultânea** (reemissão necessária). Risco operacional, não de segurança.
- Formato legado sem assinatura (`AGENDA_CANCEL_OK_PREFIX` sem token) é tratado em `intent.ts:86-87` como `issuedMin: -1, sig: ""`, que sempre falha em `verifyCancel` (idade negativa/assinatura vazia) — não cancela nada. Comportamento correto e testável.

### 4.2 Fluxo de 2 passos (confirmado)
- `cancelPage` → `askCancel` → confirmação com botão assinado — cobre o requisito de fluxo guiado em 2 passos com paginação de 8. Mensagens deixam claro que cancelar aviso financeiro **não apaga** conta/fatura/lançamentos (whatsapp-agenda.server.ts:514, 490).

---

## 5. Notificações — gates, quiet hours, janela 24h/Meta

### 5.1 Quiet hours (lido integralmente `whatsapp-notification-gates.server.ts`)
- `isQuietHour` cobre corretamente janelas que cruzam meia-noite (`start > end`).
- `nextAllowedAfterQuietHours` tem guarda defensiva de até 5 tentativas de +1h para lidar com DST/horário inexistente, e fallback para `America/Sao_Paulo` se o timezone do perfil for inválido (linha 244-249) — fail-safe correto.
- **P2 — herança de preferências "antigas"**: `isCategoryEnabled` trata `category === "agenda"` com `prefs.agenda !== false` (linha 102-104) para que linhas antigas sem a coluna nova contem como "ligado" — é uma decisão de produto implícita (opt-out por padrão nunca foi pedido ao usuário para a categoria Agenda em contas pré-existentes). Deve ser confirmado como decisão intencional de produto, não é um bug de código, mas é um ponto de atenção para LGPD/opt-in explícito (ver seção 8).

### 5.2 Janela de 24h / templates Meta UTILITY pendentes (confirmado — fail-closed correto)
- `canDispatch` (linhas 305-334): se `requiresTemplateWindow` e não há sessão aberta de 24h **e** não há `hasMetaTemplate`, bloqueia com `no_session_window`. Isso está alinhado ao requisito "templates Meta UTILITY pendentes só avisam depois de aprovados".
- `whatsapp-approved-template-resolver.server.ts` (lido integralmente) é fail-closed em múltiplas dimensões: idioma (`pt_BR`), categoria (`UTILITY`), versão (`1`), status (`approved`), `active`, `provider_template_id` presente, e fingerprint opcional — qualquer divergência produz `ok:false` com motivo específico, **nunca** aprova por omissão. Comentário explícito no cabeçalho proíbe fallback para `hello_world`/`en_US`/texto livre — e o código cumpre essa promessa (não há `catch` que force `ok:true`).

### 5.3 Entregue apenas via webhook (confirmado parcialmente)
- `whatsapp-callback-quota-reconcile.server.ts` (lido integralmente) só reconcilia com `providerMessageId` presente — "sem PMID não há evidência Meta-side de aceite" (linha 88-97) — ou seja, o estado "delivered"/"sent" só é promovido mediante callback real da Meta, nunca por suposição local. Cumpre o requisito "delivered só via webhook". `failed` pós-aceite com PMID **não libera a quota** (a Meta já cobrou) — correto.
- **NÃO VERIFICADO**: não li `whatsapp-quota.server.ts` (fonte de `reconcileReservationFromCallback`/`commitOutboundQuota`) nem a rota webhook de callback de status da Meta (fora da lista explícita do escopo desta tarefa) — a validação de assinatura do callback e o RPC atômico de quota não foram auditados nesta rodada.

### 5.4 Canário e primeiro envio (lido integralmente `whatsapp-canary-notification.server.ts`)
- Múltiplas pré-condições fail-closed (`checkTemplate`, `checkAdminLink`, `checkNoResidualProcessing`, `checkNoActiveAttempt`) antes de inserir a notification canário, com idempotência garantida por `dedupe_key` fixa e tratamento de `23505` (conflito único) como `already_exists` (corrida tratada corretamente, linhas 258-265). Documentado como uso único em testes ("Único call site autorizado nesta fase: testes") — **P2**: não há proteção em tempo de execução (runtime) impedindo chamada acidental fora de testes (é apenas um comentário/convenção, não um gate técnico). Se alguém importar essa função num cron ou webhook futuro por engano, nada no código a impede de rodar contra o Admin Master em produção.

### 5.5 Alertas proativos não interrompem financeiro (parcialmente confirmado)
- `whatsapp-proactive-alerts.server.ts` (lido integralmente) só gera candidatos e enfileira — nunca envia direto, nunca participa do roteamento de mensagens recebidas do usuário. Isolamento correto por design (arquivo não importa nada de `whatsapp.server.ts` nem de sessões).
- `generateProactiveAlerts` **não** enfileira nada quando não há mapeamento de template aprovado (`resolveAllowedMapping`) ou template inativo (linhas 168-171) — fila nunca populada com candidatos sem canal de envio aprovado.
- **NÃO VERIFICADO** diretamente nesta auditoria: a garantia de que o *dispatcher* (que efetivamente envia) não dispara durante uma sessão financeira ativa do usuário (expense/receipt/card) depende de `whatsapp-entitlement.server.ts` e do gate de sessão em `whatsapp.server.ts`, que **não foram lidos integralmente** nesta rodada (fora da lista de arquivos do escopo). A alegação do comentário de cabeçalho ("não interrompe fluxos") não foi verificada ponta a ponta — HIPÓTESE/NÃO VERIFICADO.

---

## 6. Contas a vencer (`contas-vencimento.server.ts`, lido integralmente)

- Toda consulta filtra `user_id` e `status='pendente'`, nunca mistura "pago" com "pendente" (comentário do cabeçalho reforça essa distinção e o código cumpre). Sem achado de lógica.
- `findVencimentoByTerm` tem prioridade de match (exato → palavra completa → substring) e **limita a 12 resultados** (linha 182, 201, 207) — evita escolha automática por substring curta (ex. "luz"), bom design anti-ambiguidade.
- **P2 — busca por `ILIKE`/substring feita em memória após carregar TODAS as contas pendentes do usuário** (`findVencimentoByTerm`, linha 190-196 faz `select` sem filtro de nome, filtra em JS). Para usuários com centenas de contas pendentes, isso é uma consulta completa de tabela por chamada — sem paginação nem limite de linhas no `select`. Risco de desempenho sob escala, não de corretude. Mesma observação vale para `resolveSourceByName` em `whatsapp-agenda.server.ts:273` (`limit(200)` ali, mitigado parcialmente, mas ainda filtra em memória).

---

## 7. Pix / Favorecidos / Pagamento a pessoa

### 7.1 P0 — Bug financeiro de 100x em código morto, mas exportado e invocável
**Arquivo: `src/server/whatsapp-pix-intents.server.ts:470-486` (função `handlePagarPessoaIntent`).**

```
478:      valor: parsed.valorCentavos,
```

`parsed.valorCentavos` é um inteiro em **centavos** (confirmado em `whatsapp-pix-parser.ts:465`, `parseBRLToCentavosPix`). O `insert` em `gastos.valor` grava esse inteiro **diretamente, sem dividir por 100**. Isso resulta em qualquer pagamento registrado por este caminho ficando **100x maior** do que o valor real falado pelo usuário (ex.: "paguei R$ 50 ao João" gravaria `valor = 5000`, interpretado pelo restante do sistema como R$ 5.000,00).

Evidência de que esse é de fato um bug e não uma convenção do schema: o fluxo substituto e atualmente ativo, `whatsapp-pagar-pessoa-flow.server.ts:190-194`, tem uma função dedicada **exatamente para corrigir esse problema**:
```
186: /**
 * WA-Q-PixInline-Valor-Fix — conversão única e explícita de centavos
 * (inteiro) para reais (numeric) na fronteira de persistência. ...
 * Nunca chame com valor já em reais.
 */
191: export function centavosParaReais(centavos: number): number { ... return Math.round(centavos) / 100; }
```
e usa `valor: valorReais` (linha 588) no `insert`.

**Mitigação confirmada por leitura do roteador**: em `src/server/whatsapp.server.ts:5670`, a função antiga é referenciada apenas como `void handlePagarPessoaIntent;` — **nunca é chamada** no fluxo de roteamento ativo (`processarPagarPessoaFlow` é o caminho real, linha 5648 e 5578). Ou seja, **o bug está em código morto, porém ainda exportado publicamente do módulo** (`export async function handlePagarPessoaIntent`) e referenciado por um `grep` só encontra esse único `void` como chamador.

**Classificação: P1 (rebaixado de P0 por estar morto no caminho ativo), mas tratar como P0 de processo**: código morto com bug financeiro de 100x que:
- pode ser reativado por engano em um refactor futuro (basta trocar `void handlePagarPessoaIntent;` por uma chamada condicional de fallback, como o comentário ao lado sugere ser intenção futura: "Mantemos o handler legado disponível apenas como fallback explícito");
- é importado por testes (**NÃO VERIFICADO** nesta auditoria se há testes que o exercitam e validam o valor, o que mascararia o bug como "comportamento esperado");
- não há nenhum teste de regressão/lint que impeça chamar uma função de inserção financeira sem o `centavosParaReais` equivalente.

**Recomendação**: remover fisicamente `handlePagarPessoaIntent` de `whatsapp-pix-intents.server.ts` (ou corrigi-la para `valor: centavosParaReais(parsed.valorCentavos)` e passar a reusá-la), já que hoje ela é 100% código morto no caminho de produção.

### 7.2 LGPD — chave Pix (lido integralmente: `whatsapp-pix-secret.server.ts`, `whatsapp-pix-reveal-token.server.ts`, `whatsapp-favorecidos.server.ts`)
- `whatsapp-pix-secret.server.ts`: chave cifrada com AES-256-GCM (IV aleatório de 12 bytes por linha, `getAuthTag` validado), **nunca** fica em texto plano em `whatsapp_messages.parsed`/logs. `consumePendingPixKey` sempre apaga a linha (mesmo em erro de descriptografia, linha 143-145) — "usar uma vez e sumir" cumprido.
  - **P2 — mensagem de erro de env ausente não é fail-closed estrito em todos os call sites**: `getKey()` lança exceção se `WHATSAPP_PIX_KEY_ENC_SECRET` ausente/curta; `storePendingPixKey` captura isso em `catch` e retorna `null` (linha 81-83) — correto. Porém `hashPixKey` (linha 45-48) **não valida o secret antes de usar** (`process.env.WHATSAPP_PIX_KEY_ENC_SECRET ?? ""`), então se o secret estiver ausente, `hashPixKey("")` produz um HMAC determinístico e previsível (chave HMAC vazia) — usado apenas para comparação de igualdade, mas ainda é uma degradação silenciosa (sem exceção, sem log) caso o secret suma.
- `whatsapp-pix-reveal-token.server.ts`: token opaco de 32 bytes, armazenado como hash SHA-256, TTL 10 min, consumo atômico via `UPDATE ... WHERE consumed_at IS NULL` que detecta corrida de replay (linha 124-133, "corrida — outra requisição pegou primeiro"). Logs usam apenas `tokenPrefix` (hash truncado) — nunca o token nem a chave. Cumpre o requisito de "nunca expor chave Pix em log".
- `maskPixDisplay`/`rotuloTipoPix`: mascaramento para exibição textual, coerente com a política "nunca devolver chave completa em texto plano fora do link assinado".

### 7.3 Race conditions no pagamento a pessoa (fluxo ativo, parcialmente lido)
- `whatsapp-pagar-pessoa-flow.server.ts` (1788 linhas; **lidas integralmente apenas as linhas 1-250 e grep dirigido nas linhas 440-1790**; corpo conversacional completo **NÃO VERIFICADO linha a linha** por restrição de tempo/escopo desta rodada) implementa claim atômico via `gravarSessao`/`23505` antes de qualquer `insert` em `gastos`, com re-leitura em caso de conflito (`race_duplicate`/`race_in_progress`), e cobra quota financeira **somente depois** de vencer o claim (comentário explícito, linha 544-545) — ordem correta para evitar cobrar quota de um request perdedor da corrida.
- **NÃO VERIFICADO**: não confirmei neste arquivo se **todas** as transições de estado (`pp_aguardando_*`) respeitam o mesmo padrão de claim atômico e expiração de 30 min citada no cabeçalho — apenas as seções de persistência final e de entrada foram lidas em detalhe.

---

## 8. Hard delete / estorno / reversão de extrato — soft-delete

### 8.1 Status real no repositório (confirmado por grep)
| Mecanismo | Status |
|---|---|
| `receitas.deleted_at` + funções de soft-delete de receitas | **APLICADO** (`20260731181756_...sql`, `20260731185551_...sql`) |
| `gastos.deleted_at` + `gastos_soft_delete_periodo`/`gastos_restaurar_lote`/`gastos_preview_exclusao_periodo` | **CANDIDATO** (`gastos-soft-delete-f2.sql`) — não aplicado |
| `estornar_conta_gastos_atomic` / `reverter_extrato_atomic` (RPCs atômicas) | **CANDIDATO** (`gastos-delete-atomic-f4.sql`) — depende da F2, não aplicado |
| `whatsapp_undo_recent_action` (versão com checagem de `gastos.deleted_at`) | **CANDIDATO** (`whatsapp-undo-soft-delete.sql`) — substitui uma versão **já aplicada** sem essa checagem em `20261004130000_whatsapp_postlaunch_actions.sql` |
| `whatsapp_shopping_quota` | **CANDIDATO** (`whatsapp-shopping-quota.sql`) — não aplicado, **NÃO LIDO em detalhe nesta rodada** (fora do foco principal de Agenda/Contas) |

### 8.2 P0 — Reversão de extrato em `src/lib/store.ts` é multi-tabela e NÃO atômica (hoje, em produção)
`revertExtratoImportado` e `revertExtratoImportadoSeguro` (`src/lib/store.ts:4860-4976`, lidas as seções relevantes) fazem **DELETE sequencial por tabela a partir do cliente/servidor da aplicação** (`gastos`, `receitas`, `transferencias_internas`, `dinheiro_guardado`, `movimentacoes_meta`), não dentro de uma transação de banco. O próprio comentário do código reconhece isso:
```
4846: * Atomicidade total entre tabelas: RPC candidata `reverter_extrato_atomic`
 * (docs/migrations-candidate/gastos-delete-atomic-f4.sql).
```
Ou seja, a equipe já identificou o problema e propôs a correção (`reverter_extrato_atomic`), **mas essa RPC está em `docs/migrations-candidate/`, não aplicada**. Em produção hoje, se a conexão cair ou um `error` ocorrer **depois** de apagar `gastos` mas **antes** de apagar `receitas` (ou outra tabela da lista), o código trata isso como falha (`return {...falha, mantidos}`, linha 4924-4926) e **não reverte os deletes já efetuados** — ficando o extrato em estado inconsistente: `gastos` removidos, `receitas`/demais tabelas do mesmo lote ainda presentes, e o status de `extratos_importados` **não chega a ser atualizado** (o `update` de status só roda depois do loop completo, linha 4933). Resultado: lote fica com itens órfãos parcialmente apagados sem refletir isso em `status`.
- **Mitigação parcial existente**: `loteTemGastoExcluido` bloqueia a reversão inteira se **qualquer** gasto do lote já estiver soft-excluído (fail-closed quando há erro de leitura, linha 4847: `if (error || !Array.isArray(data)) return true;`) — isso é correto e documentado (não reverte lote com gasto soft-excluído, para permitir restauração futura). Mas essa proteção **não resolve a falta de atomicidade entre as 5 tabelas** no caminho feliz.

### 8.3 P1 — Soft-delete de `gastos` não está aplicado; risco de drift entre candidata e código já escrito para ela
Vários pontos do código já pressupõem `gastos.deleted_at` como se existisse:
- `src/lib/store.ts:4852` (`loteTemGastoExcluido`) consulta `.not("deleted_at", "is", null)` em `gastos` — se a coluna não existir, a consulta falha, cai no `catch`-equivalente (erro do Supabase) e retorna `true` (bloqueia a reversão) — **comportamento fail-closed aceitável enquanto a coluna não existe**, mas significa que, hoje, **toda chamada a `revertExtratoImportado`/`revertExtratoImportadoSeguro` pode estar silenciosamente sempre bloqueada** se o ambiente de produção não tiver a coluna, sem nenhuma mensagem de erro clara ao usuário além de "não foi possível reverter". **NÃO VERIFICADO nesta auditoria se a coluna já existe em produção** (não há acesso a banco real, conforme regras do ambiente) — ESTA é uma lacuna real de verificação que a equipe deveria confirmar antes de interpretar os resultados desta auditoria.
- `revertExtratoImportadoSeguro` já filtra `.is("deleted_at", null)` apenas para a tabela `gastos` no DELETE real (linha 4922) — coerente com a intenção de nunca apagar fisicamente um gasto soft-excluído, mas, de novo, depende da coluna existir.

### 8.4 Estorno de conta a pagar (RPC candidata `estornar_conta_gastos_atomic`)
- Lida integralmente (`gastos-delete-atomic-f4.sql`). Trava (`FOR UPDATE`) a conta e todos os gastos-alvo antes de decidir, rejeita se qualquer gasto do lote já estiver soft-excluído (`gasto_vinculado_excluido`), confere `ROW_COUNT` do DELETE contra o esperado e lança exceção (rollback total) em divergência — desenho correto de "tudo ou nada" **quando for aplicada**. Hoje, **não está aplicada**, então o estorno de conta em produção provavelmente ainda roda via caminho de aplicação não-atômico equivalente ao do extrato — **NÃO VERIFICADO diretamente nesta auditoria qual código de aplicação hoje chama o estorno de conta a pagar** (não estava na lista de arquivos deste escopo: `whatsapp-contas-pagar.server.ts`/`processarBaixaConta` foi apenas referenciado, não lido integralmente).

### 8.5 `whatsapp_undo_recent_action` — undo de 1 clique (parcialmente verificado)
- A versão **aplicada** (`20261004130000_whatsapp_postlaunch_actions.sql`) já filtra `deleted_at IS NULL` para `receitas` (linha 88 do grep) — ou seja, o undo de receitas já respeita soft-delete de receitas (coerente, pois essa coluna já existe).
- A versão **candidata** (`whatsapp-undo-soft-delete.sql`) adiciona a mesma proteção para `gastos.deleted_at` (retorna `'soft_deleted'` em vez de tentar `DELETE`, e também trava a série inteira de parcelas antes de contar — linha 49-56, "serializa com o soft-delete F2"). Até essa candidata ser aplicada, **a versão hoje ativa do `whatsapp_undo_recent_action` não tem nenhuma noção de `gastos.deleted_at`** (porque a coluna não existe) — consistente, mas significa que **o dia em que `gastos-soft-delete-f2.sql` for aplicada sem `whatsapp-undo-soft-delete.sql` na mesma janela**, o undo de gasto poderia tentar `DELETE` uma linha já soft-excluída por outro caminho, falhando silenciosamente ou com comportamento indefinido dependendo da ordem — **os comentários de cabeçalho dos dois arquivos candidatos exigem explicitamente aplicação na mesma janela** (`whatsapp-undo-soft-delete.sql` linha 1-3), o que é a mitigação correta **se for seguida operacionalmente**. Risco é de processo/deploy, não de código.

---

## 9. LGPD — observações transversais

- Nenhum dos arquivos lidos nesta auditoria grava chave Pix, CPF/CNPJ, telefone, nome de favorecido ou texto de usuário em log (`console.info`/`console.error`) — todos os pontos verificados usam apenas `event`, `stage`, `result`, contagens, prefixos de hash e flags booleanas. Cumprimento consistente do princípio de minimização de dados em logs, conforme os próprios comentários de cabeçalho dos arquivos de Pix.
- `whatsapp_pix_pending_secrets` e `whatsapp_pix_reveal_tokens` têm TTL curto (30 min e 10 min) e rotina de *housekeeping* (`purgeExpiredPendingPixKeys`, `purgeExpiredRevealTokens`) — mas essas rotinas **dependem de serem chamadas por cron**; o comentário diz "Pode ser chamado por cron" (condicional). **NÃO VERIFICADO** nesta auditoria se existe de fato um cron agendado chamando essas funções — se não houver, linhas expiradas (já sem valor de uso, mas ainda ocupando espaço com ciphertext) persistem indefinidamente até deleção sob demanda (`consumePendingPixKey`/`consumeRevealToken` já apagam no consumo, mas segredos **nunca consumidos** — ex. usuário abandona o fluxo — dependem só do purge agendado).
- Observação de produto (não é bug de código): preferência de notificação "agenda" tratada como ligada por padrão para contas antigas sem a coluna (seção 5.1) é um ponto a confirmar com DPO/jurídico quanto a opt-in explícito por categoria.

---

## 10. Lista consolidada de achados por severidade

**P0 (crítico — correção prioritária)**
1. `src/lib/store.ts` `revertExtratoImportado`/`revertExtratoImportadoSeguro`: reversão de extrato multi-tabela **não atômica** em produção hoje (RPC atômica correta já desenhada mas apenas CANDIDATA, não aplicada). Falha no meio do loop deixa dados parcialmente apagados e `status` de extrato desatualizado.

**P1 (alto)**
2. `whatsapp-pix-intents.server.ts:478` — bug de 100x no valor de `gastos.valor` em `handlePagarPessoaIntent`. Hoje é código morto (não roteado), mas exportado e com comentário no roteador sugerindo reativação futura como "fallback". Recomenda-se remoção física da função.
3. Dependência indireta: soft-delete de `gastos` ainda não aplicado (`gastos-soft-delete-f2.sql`), mas várias partes do código (`store.ts`, candidatas de undo/estorno) já pressupõem sua existência — risco de comportamento fail-closed não comunicado claramente ao usuário final enquanto a coluna não existir, e risco de ordem de deploy entre as migrações candidatas interdependentes (F2 → undo → F4).
4. `agenda-confirm-token.server.ts` reusa segredo de outro domínio (`WHATSAPP_BOLETO_FINGERPRINT_SECRET`) para assinar confirmações de cancelamento da Agenda — rotação do segredo por motivo alheio à Agenda invalida todos os tokens de cancelamento pendentes simultaneamente (risco operacional, não de segurança).
5. `resolveFinancialSource` para `source_type === "cartao"` recalcula a fatura completa a cada avaliação de aviso — custo potencial sob escala (não medido).

**P2 (médio)**
6. `listAgenda` filtra período em memória após `.limit()` do banco — pode omitir itens silenciosamente para usuários com grande volume.
7. Duplicação de lógica de conversão timezone↔UTC entre `src/lib/agenda/datetime.ts` e `whatsapp-notification-gates.server.ts`.
8. `findVencimentoByTerm`/`resolveSourceByName` carregam todas as contas/fontes do usuário e filtram em memória — sem paginação, risco de desempenho sob escala.
9. `whatsapp-canary-notification.server.ts`: restrição "uso só em testes" é apenas documental/comentário, sem gate técnico de runtime.
10. `hashPixKey` não valida presença do secret antes de gerar HMAC — degrada silenciosamente para HMAC de chave vazia se `WHATSAPP_PIX_KEY_ENC_SECRET` sumir.
11. Preferência de notificação "agenda" assume `true` por padrão em linhas antigas sem a coluna — confirmar com produto/jurídico se é opt-in válido.

**NÃO VERIFICADO (fora do escopo efetivamente coberto nesta rodada, recomenda-se auditoria complementar)**
- Corpo completo de `whatsapp-pagar-pessoa-flow.server.ts` (apenas ~350 das 1788 linhas lidas linha a linha; grep dirigido no restante).
- `whatsapp-meta-template-management.server.ts`, `-mapping.server.ts`, `-placeholders.server.ts`, `-catalog.server.ts`, `-submission.server.ts`, `-sync.server.ts` — listados no escopo mas não lidos nesta rodada por restrição de tempo; apenas `whatsapp-approved-template-resolver.server.ts` foi lido integralmente.
- `whatsapp-quota.server.ts` (fonte de `reconcileReservationFromCallback`/`commitOutboundQuota`) e a rota de webhook de status da Meta.
- Migração/trigger `agenda_validate_source` citada em comentário de `agenda.server.ts` mas não localizada nos grep realizados.
- `docs/migrations-candidate/whatsapp-shopping-quota.sql` — identificado mas não lido em detalhe.
- Confirmação em produção se a coluna `gastos.deleted_at` já existe fisicamente (fora das regras do ambiente desta auditoria, que proíbem consulta ao banco real).
- `whatsapp-contas-pagar.server.ts` / `processarBaixaConta` (referenciado, não lido integralmente) — caminho de aplicação real do estorno de conta a pagar hoje.
- `whatsapp-entitlement.server.ts` e trechos de `whatsapp.server.ts` relativos a sessões financeiras ativas — necessários para confirmar com certeza que lembretes nunca interrompem fluxos de despesa/recibo/cartão em andamento.

---

## 11. Tabela de cobertura de leitura

| Arquivo | Linhas totais | Cobertura | Observação |
|---|---:|---|---|
| `src/server/agenda.server.ts` | 562 | Integral | Lido em 2 blocos (1-489, 489-562) |
| `src/server/agenda-confirm-token.server.ts` | 44 | Integral | — |
| `src/server/contas-vencimento.server.ts` | 217 | Integral | — |
| `src/lib/agenda.functions.ts` | 120 | Integral | — |
| `src/lib/agenda/datetime.ts` | 280 | Integral | — |
| `src/lib/agenda/recurrence.ts` | 87 | Integral | — |
| `src/lib/agenda/buckets.ts` | 20 | Integral | — |
| `src/lib/agenda/intent.ts` | 191 | Integral | — |
| `src/server/whatsapp-agenda.server.ts` | 577 | Integral | Lido em 3 blocos (1-434, 434-577 e trecho 290-434 revisitado) |
| `src/server/whatsapp-notification-gates.server.ts` | 337 | Integral | — |
| `src/server/whatsapp-proactive-alerts.server.ts` | 177 | Integral | — |
| `src/server/whatsapp-alert-preferences.server.ts` | 55 | Integral | — |
| `src/server/whatsapp-canary-notification.server.ts` | 270 | Integral | — |
| `src/server/whatsapp-approved-template-resolver.server.ts` | 134 | Integral | — |
| `src/server/whatsapp-callback-quota-reconcile.server.ts` | 167 | Integral | — |
| `src/server/whatsapp-meta-template-management.server.ts` | 433 | Não lido | Listado no escopo, não aberto nesta rodada |
| `src/server/whatsapp-meta-template-mapping.server.ts` | 78 | Não lido | idem |
| `src/server/whatsapp-meta-template-placeholders.server.ts` | 156 | Não lido | idem |
| `src/server/whatsapp-meta-templates-catalog.server.ts` | 107 | Não lido | idem |
| `src/server/whatsapp-meta-template-submission.server.ts` | 114 | Não lido | idem |
| `src/server/whatsapp-meta-template-sync.server.ts` | 216 | Não lido | idem |
| `src/server/whatsapp-pix-intents.server.ts` | 523 | Integral | Lido em 2 blocos (1-500, 500-523) |
| `src/server/whatsapp-pix-parser.ts` | 767 | Parcial | Apenas trechos relevantes a `valorCentavos`/estrutura de retorno via grep; não lido linha a linha integralmente |
| `src/server/whatsapp-pix-reveal-token.server.ts` | 172 | Integral | — |
| `src/server/whatsapp-pix-secret.server.ts` | 170 | Integral | — |
| `src/server/whatsapp-favorecidos.server.ts` | 153 | Integral | — |
| `src/server/whatsapp-pagar-pessoa-flow.server.ts` | 1788 | Parcial | Linhas 1-250 lidas integralmente; 251-1788 cobertas por grep dirigido (race/claim/deleted_at/timeout), não lidas linha a linha |
| `src/routes/api/public.hooks.whatsapp-contas-lembretes-generate.ts` | 89 | Integral | — |
| `src/routes/api/public.hooks.whatsapp-dispatcher.ts` | 356 | Integral | — |
| `src/routes/api/public.hooks.whatsapp-proactive-generate.ts` | 40 | Integral | — |
| `src/routes/api/public.whatsapp.expense.ts` | — | Não lido | Listado como rota pública candidata a `public.whatsapp-*`, não fazia parte estrita dos 4 hooks citados; não aberto |
| `src/lib/store.ts` (seções de soft-delete/estorno) | 5832 (total do arquivo) | Parcial | Lidas integralmente apenas as linhas 4840-4970 (`loteTemGastoExcluido`, `revertExtratoImportadoSeguro`, `revertExtratoImportado`); restante do arquivo fora do escopo desta tarefa |
| `docs/migrations-candidate/gastos-delete-atomic-f4.sql` | 67 | Integral | — |
| `docs/migrations-candidate/gastos-soft-delete-f2.sql` | 270 | Integral | — |
| `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` | 108 | Integral | — |
| `docs/migrations-candidate/wa-c92-e1e-canary-template.sql` | 80 | Não lido | Identificado, não aberto (fora do foco de Agenda/Contas) |
| `docs/migrations-candidate/whatsapp-shopping-quota.sql` | 174 | Não lido | idem |
| `supabase/migrations/*` (grep `deleted_at`/`whatsapp_undo`/`estornar`/`reverter`/`whatsapp_shopping`) | — | Parcial (grep) | 4 arquivos localizados e inspecionados via grep de trechos relevantes (`20260731181756...`, `20260731185551...`, `20260924120000_import_extrato_atomic.sql`, `20261004130000_whatsapp_postlaunch_actions.sql`); não lidos integralmente linha a linha nesta rodada |

